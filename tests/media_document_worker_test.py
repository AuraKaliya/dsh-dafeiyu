"""Exercise actual local document formats with synthetic content only."""
import importlib.util
import io
import json
import sys
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("document_worker", sys.argv.pop(1))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class DocumentTests(unittest.TestCase):
    """Text, OOXML and PDF parsing under the real bounded worker."""

    def read(self, name, **options):
        """Read one test-owned file with default bounded cursor."""
        settings = {"name": name, "offset": 0, "text_offset": 0, "limit": 5000, "pdf_version": "6.10.0"}
        settings.update(options)
        return worker.parse(Path(name), **settings)

    def archive(self, name, entries):
        """Build an in-workspace synthetic archive without extraction."""
        with zipfile.ZipFile(name, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path, text in entries:
                archive.writestr(path, text)

    def test_text_csv_json_and_continuation(self):
        """UTF BOM and long units preserve a resumable character position."""
        Path("text.txt").write_bytes(("蓝鱼" * 100).encode("utf-16"))
        first = self.read("text.txt", limit=40)
        self.assertEqual(first["next"], {"offset": 0, "textOffset": 40})
        second = self.read("text.txt", text_offset=40, limit=160)
        self.assertEqual(first["units"][0]["text"] + second["units"][0]["text"], "蓝鱼" * 100)
        Path("emoji.txt").write_text("🐟" * 100, encoding="utf-8")
        emoji = self.read("emoji.txt", limit=40)
        self.assertEqual(emoji["units"][0]["text"], "🐟" * 20)
        self.assertEqual(emoji["next"]["textOffset"], 20)
        with self.assertRaisesRegex(ValueError, "TEXT_BUDGET_TOO_SMALL"):
            self.read("emoji.txt", limit=1)
        Path("table.csv").write_text('a,"b,c"\n1,2', encoding="utf-8")
        self.assertEqual(json.loads(self.read("table.csv")["units"][0]["text"]), ["a", "b,c"])
        Path("valid.json").write_text('{"x":1}', encoding="utf-8")
        self.assertEqual(self.read("valid.json")["kind"], "json")
        Path("binary.bin").write_bytes(b"\xff\x00\x80")
        with self.assertRaises(ValueError):
            self.read("binary.bin")

    def test_docx_order_and_table_locations(self):
        """Paragraphs and cells retain their actual document order and locators."""
        document = f'<w:document xmlns:w="{worker.W[1:-1]}"><w:body><w:p><w:r><w:t>正文</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>单元格</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
        self.archive("word.docx", [("word/document.xml", document)])
        units = self.read("word.docx")["units"]
        self.assertEqual([unit["text"] for unit in units], ["正文", "单元格"])
        self.assertEqual(units[1]["locator"], "table:1/row:1/cell:1")

    def test_xlsx_cached_values_and_external_relationship(self):
        """Formulas remain passive cached values and external sheets are skipped."""
        ns, rel = worker.S[1:-1], worker.R[1:-1]
        self.archive("sheet.xlsx", [
            ("xl/workbook.xml", f'<workbook xmlns="{ns}" xmlns:r="{rel}"><sheets><sheet name="Local" r:id="r1"/><sheet name="External" r:id="r2"/></sheets></workbook>'),
            ("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="https://invalid.example/private" TargetMode="External"/></Relationships>'),
            ("xl/worksheets/sheet1.xml", f'<worksheet xmlns="{ns}"><sheetData><row><c r="A1" t="inlineStr"><is><t>缓存表</t></is></c><c r="B1"><f>2+2</f><v>4</v></c></row></sheetData></worksheet>')])
        result = self.read("sheet.xlsx")
        self.assertEqual([u["text"] for u in result["units"]], ["缓存表", "4"])
        self.assertTrue(result["units"][1]["cachedFormula"])
        self.assertIn("外部工作簿关系未读取", result["gaps"])

    def test_archive_path_macro_ratio_and_entities(self):
        """Traversal, macro payloads, expansion bombs and UTF-16 entities are rejected."""
        cases = [([("../bad", "x")], "PATH_INVALID"), ([("word/vbaProject.bin", "x")], "MACRO_REJECTED"),
                 ([("word/document.xml", "x" * 30000)], "EXPANSION_LIMIT")]
        for index, (entries, code) in enumerate(cases):
            name = f"bad{index}.docx"
            self.archive(name, entries)
            with self.assertRaisesRegex(ValueError, code):
                self.read(name)
        entity = '<!DOCTYPE document [<!ENTITY hidden "bad">]><document>&hidden;</document>'
        for encoding in ("utf-8", "utf-16"):
            self.archive("entity.docx", [("word/document.xml", entity.encode(encoding))])
            with self.assertRaisesRegex(ValueError, "XML_ENTITY"):
                self.read("entity.docx")

    def test_real_pdf_text_layer_and_blank_page(self):
        """Read actual PDF text; a page without a text layer is not fabricated OCR."""
        from pypdf import PdfWriter
        from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

        writer = PdfWriter()
        page = writer.add_blank_page(200, 200)
        font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
        content = DecodedStreamObject()
        content.set_data(b"BT /F1 12 Tf 20 100 Td (Synthetic PDF text) Tj ET")
        page[NameObject("/Contents")] = writer._add_object(content)
        writer.add_blank_page(200, 200)
        with Path("sample.pdf").open("wb") as stream:
            writer.write(stream)
        result = self.read("sample.pdf")
        self.assertIn("Synthetic PDF text", result["units"][0]["text"])
        self.assertEqual(result["units"][1]["text"], "")
        self.assertIn("第2页没有文本层，未做OCR", result["gaps"])


if __name__ == "__main__":
    result = unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromTestCase(DocumentTests))
    print(json.dumps({"passed": result.wasSuccessful(), "tests": result.testsRun,
                      "errors": [text for _, text in result.errors + result.failures]}))
    # The managed TypeScript test checks this structured verdict and reports any synthetic traceback.
