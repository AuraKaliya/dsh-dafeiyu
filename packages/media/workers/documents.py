"""Read bounded passive document content; never execute macros, formulas or PDF actions."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import posixpath
import stat
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath
from typing import Iterator

MAX_INPUT = 16 * 1024 * 1024
MAX_MEMBER = 8 * 1024 * 1024
MAX_EXPANDED = 32 * 1024 * 1024
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def xml_member(archive: zipfile.ZipFile, name: str) -> ET.Element:
    """Parse a size-limited member with no DTD or entity declarations."""
    with archive.open(name) as stream:
        data = stream.read(MAX_MEMBER + 1)
    if len(data) > MAX_MEMBER:
        raise ValueError("MEDIA_DOCUMENT_MEMBER_LIMIT")
    markup = data.replace(b"\x00", b"").upper()
    if b"<!DOCTYPE" in markup or b"<!ENTITY" in markup:
        raise ValueError("MEDIA_DOCUMENT_XML_ENTITY")
    return ET.fromstring(data)


def validate_archive(archive: zipfile.ZipFile) -> None:
    """Validate all names and declared sizes before opening any content; never extract files."""
    entries = archive.infolist()
    if len(entries) > 1024:
        raise ValueError("MEDIA_DOCUMENT_MEMBER_COUNT")
    names, total = set(), 0
    for entry in entries:
        name = entry.filename
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name or name.casefold() in names:
            raise ValueError("MEDIA_DOCUMENT_PATH_INVALID")
        names.add(name.casefold())
        if stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1:
            raise ValueError("MEDIA_DOCUMENT_MEMBER_INVALID")
        if "vbaproject" in name.lower() or "macrosheets/" in name.lower():
            raise ValueError("MEDIA_DOCUMENT_MACRO_REJECTED")
        total += entry.file_size
        if entry.file_size > MAX_MEMBER or total > MAX_EXPANDED or entry.file_size > max(1, entry.compress_size) * 100:
            raise ValueError("MEDIA_DOCUMENT_EXPANSION_LIMIT")


def word_units(archive: zipfile.ZipFile) -> Iterator[dict]:
    """Yield body paragraphs and table cells in document order."""
    body = xml_member(archive, "word/document.xml").find(W + "body")
    if body is None:
        raise ValueError("MEDIA_DOCUMENT_INVALID")
    paragraph, table = 0, 0
    for block in body:
        if block.tag == W + "p":
            paragraph += 1
            yield {"kind": "paragraph", "locator": f"paragraph:{paragraph}", "text": "".join(block.itertext())}
        elif block.tag == W + "tbl":
            table += 1
            for row_index, row in enumerate(block.findall(W + "tr"), 1):
                for cell_index, cell in enumerate(row.findall(W + "tc"), 1):
                    text = "\n".join("".join(p.itertext()) for p in cell.findall(W + "p"))
                    yield {"kind": "row", "locator": f"table:{table}/row:{row_index}/cell:{cell_index}", "text": text}


def sheet_units(archive: zipfile.ZipFile, gaps: list[str]) -> Iterator[dict]:
    """Return shared/inline strings and cached cell values; never recalculate formulas."""
    workbook = xml_member(archive, "xl/workbook.xml")
    relationships = xml_member(archive, "xl/_rels/workbook.xml.rels")
    targets = {}
    for relation in relationships:
        if relation.get("TargetMode") == "External":
            gaps.append("外部工作簿关系未读取")
            continue
        target = relation.get("Target", "")
        name = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target))
        if name.startswith("xl/worksheets/") and name.endswith(".xml"):
            targets[relation.get("Id")] = name
    strings = []
    if "xl/sharedStrings.xml" in archive.namelist():
        strings = ["".join(item.itertext()) for item in xml_member(archive, "xl/sharedStrings.xml").findall(S + "si")]
    for sheet in workbook.findall(f"{S}sheets/{S}sheet"):
        target = targets.get(sheet.get(R + "id"))
        if target is None:
            gaps.append("工作表关系不受支持或指向外部")
            continue
        for cell in xml_member(archive, target).iter(S + "c"):
            value = cell.findtext(S + "v", "")
            kind = cell.get("t")
            if kind == "s":
                index = int(value)
                if not 0 <= index < len(strings):
                    raise ValueError("MEDIA_DOCUMENT_SHARED_STRING_INVALID")
                value = strings[index]
            elif kind == "inlineStr":
                value = "".join(cell.find(S + "is").itertext())
            formula = cell.find(S + "f") is not None
            if formula and "公式只显示已有缓存值，未计算" not in gaps:
                gaps.append("公式只显示已有缓存值，未计算")
            yield {"kind": "row", "locator": f"sheet:{sheet.get('name', '')}/cell:{cell.get('r', '')}", "text": value, "cachedFormula": formula}


def pdf_units(data: bytes, gaps: list[str], version: str) -> Iterator[dict]:
    """Extract the text layer only, with pinned parser and bounded stream decompression."""
    import pypdf
    from pypdf import filters

    if pypdf.__version__ != version:
        raise ValueError("MEDIA_PDF_VERSION_CHANGED")
    filters.ZLIB_MAX_OUTPUT_LENGTH = MAX_MEMBER
    filters.LZW_MAX_OUTPUT_LENGTH = MAX_MEMBER
    filters.RUN_LENGTH_MAX_OUTPUT_LENGTH = MAX_MEMBER
    filters.MAX_ARRAY_BASED_STREAM_OUTPUT_LENGTH = MAX_MEMBER

    def deny_filter(*args, **kwargs):
        """Do not invoke external image decoders while reading a text layer."""
        raise ValueError("MEDIA_PDF_IMAGE_FILTER_REJECTED")

    filters.JBIG2Decode.decode = staticmethod(deny_filter)
    reader = pypdf.PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted:
        raise ValueError("MEDIA_DOCUMENT_ENCRYPTED")
    if len(reader.pages) > 500:
        raise ValueError("MEDIA_DOCUMENT_PAGE_LIMIT")
    gaps.append("仅PDF文本层；图片、版面细节、附件、链接及动作未读取或执行")
    for index, page in enumerate(reader.pages, 1):
        text = page.extract_text(extraction_mode="plain") or ""
        if not text.strip():
            gaps.append(f"第{index}页没有文本层，未做OCR")
        yield {"kind": "page", "locator": f"page:{index}", "text": text}


def text_units(data: bytes, name: str) -> tuple[str, Iterator[dict]]:
    """Decode UTF-8 or explicit UTF-16 BOM; retain exact textual JSON/CSV values."""
    encoding = "utf-16" if data.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
    try:
        text = data.decode(encoding, errors="strict")
    except UnicodeError as error:
        raise ValueError("MEDIA_DOCUMENT_ENCODING_UNSUPPORTED") from error
    if "\x00" in text or any(ord(char) < 32 and char not in "\n\r\t" for char in text):
        raise ValueError("MEDIA_DOCUMENT_BINARY_UNSUPPORTED")
    suffix = Path(name).suffix.lower()
    if suffix == ".json":
        json.loads(text)
    if suffix == ".csv":
        csv.field_size_limit(MAX_MEMBER)
        units = ({"kind": "row", "locator": f"row:{index}", "text": json.dumps(row, ensure_ascii=False)}
                 for index, row in enumerate(csv.reader(io.StringIO(text)), 1))
        return "csv", units
    units = ({"kind": "paragraph", "locator": f"line:{index}", "text": line} for index, line in enumerate(text.splitlines(), 1))
    return ("json" if suffix == ".json" else "text"), units


def collect(units: Iterator[dict], *, offset: int, text_offset: int, limit: int) -> dict:
    """Bound text and unit counts, returning a resumable position even within long units."""
    selected, remaining, next_position = [], limit, None
    total = 0
    for index, unit in enumerate(units):
        total = index + 1
        if index >= 100000:
            raise ValueError("MEDIA_DOCUMENT_UNIT_LIMIT")
        if index < offset:
            continue
        start = text_offset if index == offset else 0
        if start > len(unit["text"]):
            raise ValueError("MEDIA_DOCUMENT_CURSOR_INVALID")
        if remaining == 0 or len(selected) >= 64:
            next_position = {"offset": index, "textOffset": start}
            break
        # The public string budget is UTF-16 units; cursor offsets remain Unicode characters.
        candidates, used = [], 0
        for char in unit["text"][start:start + remaining]:
            width = 2 if ord(char) > 0xFFFF else 1
            if used + width > remaining:
                break
            candidates.append(char)
            used += width
        text = "".join(candidates)
        if not text and start < len(unit["text"]) and not selected:
            raise ValueError("MEDIA_DOCUMENT_TEXT_BUDGET_TOO_SMALL")
        selected.append({**unit, "index": index, "text": text, "textStart": start, "textEnd": start + len(text)})
        remaining -= used
        if start + len(text) < len(unit["text"]):
            next_position = {"offset": index, "textOffset": start + len(text)}
            break
    return {"units": selected, "next": next_position, "totalUnits": total if next_position is None else None}


def parse(file: Path, *, name: str, offset: int, text_offset: int, limit: int, pdf_version: str) -> dict:
    """Read passive source bytes into bounded, located fragments and explicit gaps."""
    if not 0 <= offset <= 100000 or not 0 <= text_offset <= MAX_MEMBER or not 1 <= limit <= 5000:
        raise ValueError("MEDIA_DOCUMENT_CURSOR_INVALID")
    if file.stat().st_size > MAX_INPUT:
        raise ValueError("MEDIA_DOCUMENT_SIZE_LIMIT")
    data = file.read_bytes()
    gaps = []
    if data.startswith(b"%PDF-"):
        kind = "pdf"
        content = collect(pdf_units(data, gaps, pdf_version), offset=offset, text_offset=text_offset, limit=limit)
    elif data.startswith(b"PK"):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            validate_archive(archive)
            names = set(archive.namelist())
            if "word/document.xml" in names:
                kind, units = "docx", word_units(archive)
                gaps.append("仅正文段落和表格；图片、嵌入对象、页眉页脚及外部关系未读取")
            elif "xl/workbook.xml" in names:
                kind, units = "xlsx", sheet_units(archive, gaps)
                gaps.append("仅已有单元格值；未执行公式、宏或外部链接")
            else:
                raise ValueError("MEDIA_DOCUMENT_ARCHIVE_UNSUPPORTED")
            content = collect(units, offset=offset, text_offset=text_offset, limit=limit)
    else:
        kind, units = text_units(data, name)
        content = collect(units, offset=offset, text_offset=text_offset, limit=limit)
    if content["next"] is not None:
        gaps.append("本次读取有界，按next位置可继续")
    if not any(unit["text"].strip() for unit in content["units"]):
        gaps.append("本次没有可返回的正文；不代表已理解文档")
    return {"schemaVersion": 1, "kind": kind, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
            **content, "gaps": list(dict.fromkeys(gaps))[:20]}


def main() -> None:
    """Read one program-created request; emit a stable sanitized result envelope."""
    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    try:
        result = parse(Path(request["input"]), name=request["name"], offset=request["offset"],
                       text_offset=request["textOffset"], limit=request["limit"], pdf_version=request["pypdfVersion"])
        output = {"ok": True, "result": result}
    except Exception as error:
        message = str(error)
        output = {"ok": False, "code": message if message.startswith("MEDIA_") and message.replace("_", "").isalnum() else "MEDIA_DOCUMENT_PARSE_FAILED"}
    print(json.dumps(output, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
