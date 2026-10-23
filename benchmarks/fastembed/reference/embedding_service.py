"""Loopback-only OpenAI-compatible embeddings endpoint backed by FastEmbed.

The service exposes the subset of the OpenAI embeddings API that AstrBot's
``openai_embedding`` provider uses.  It loads one FastEmbed model from an
explicit local directory and serializes inference through a single worker.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import gc
import json
import logging
import os
import struct
import sys
import time
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Protocol

import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

LOGGER = logging.getLogger("embedding-service")

MODEL_NAME = "BAAI/bge-small-zh-v1.5"
MODEL_SOURCE = "Qdrant/bge-small-zh-v1.5"
DIMENSION = 512
MAX_TEXTS = 8
MAX_TEXT_CHARS = 6_000
MAX_TOTAL_CHARS = 24_000
MAX_BODY_BYTES = 512 * 1024
MODEL_FILENAME = "model_optimized.onnx"
REQUIRED_MODEL_FILES = (
    MODEL_FILENAME,
    "tokenizer.json",
    "tokenizer_config.json",
)
FORBIDDEN_MODEL_SUFFIXES = {".py", ".pyc", ".pth", ".pt", ".ckpt", ".pkl", ".pickle"}

DEFAULT_MODEL_DIR = Path(__file__).resolve().parent / "models" / "bge-small-zh-v1.5"


class ModelLoadError(RuntimeError):
    """Raised when the local model directory cannot be used safely."""


def validate_model_dir(model_dir: Path) -> None:
    """Validate a local FastEmbed snapshot without reading remote content."""
    if not model_dir.is_dir():
        raise ModelLoadError(f"model directory does not exist: {model_dir}")

    missing = [
        name for name in REQUIRED_MODEL_FILES if not (model_dir / name).is_file()
    ]
    if missing:
        raise ModelLoadError(
            f"model directory is incomplete: missing {', '.join(missing)}; "
            f"expected a verified {MODEL_SOURCE} snapshot"
        )

    model_path = model_dir / MODEL_FILENAME
    if model_path.stat().st_size < 1_000_000:
        raise ModelLoadError(
            f"{MODEL_FILENAME} is too small to be an ONNX model; "
            "a Git LFS pointer or truncated download is likely"
        )

    forbidden = sorted(
        path.name
        for path in model_dir.iterdir()
        if path.is_file() and path.suffix.lower() in FORBIDDEN_MODEL_SUFFIXES
    )
    if forbidden:
        raise ModelLoadError(
            "model directory contains executable or pickle artifacts, refusing to "
            f"load: {', '.join(forbidden)}"
        )


class EmbeddingBackend(Protocol):
    """Minimal interface used by the HTTP layer (also useful for contract tests)."""

    dimension: int

    @property
    def ready(self) -> bool: ...

    async def load(self) -> None: ...

    async def close(self) -> None: ...

    async def embed(self, texts: Sequence[str]) -> tuple[list[list[float]], int]: ...


class EmbeddingRuntime:
    """One FastEmbed model, one inference lock, one ONNX CPU thread."""

    dimension = DIMENSION

    def __init__(
        self,
        model_dir: Path,
        *,
        model_name: str = MODEL_NAME,
        max_batch: int = MAX_TEXTS,
    ) -> None:
        self.model_dir = model_dir.resolve()
        self.model_name = model_name
        self.max_batch = max_batch
        self._model = None
        self._lock = asyncio.Lock()

    @property
    def ready(self) -> bool:
        return self._model is not None

    async def load(self) -> None:
        async with self._lock:
            if self._model is not None:
                return
            await asyncio.to_thread(self._load_sync)

    def _load_sync(self) -> None:
        validate_model_dir(self.model_dir)
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["TOKENIZERS_PARALLELISM"] = "false"
        os.environ.setdefault("OMP_NUM_THREADS", "1")

        try:
            from fastembed import TextEmbedding
        except ImportError as exc:  # pragma: no cover - exercised by install failures
            raise ModelLoadError(
                "fastembed is not installed in this environment; "
                "run scripts\\install_staging.ps1"
            ) from exc

        LOGGER.info("Loading %s from %s", self.model_name, self.model_dir)
        model = TextEmbedding(
            model_name=self.model_name,
            specific_model_path=str(self.model_dir),
            local_files_only=True,
            threads=1,
            providers=["CPUExecutionProvider"],
            lazy_load=False,
        )
        if int(model.embedding_size) != self.dimension:
            raise ModelLoadError(
                f"model dimension is {model.embedding_size}, expected {self.dimension}"
            )
        self._model = model
        LOGGER.info("Model loaded: dimension=%d, threads=1", self.dimension)

    async def close(self) -> None:
        async with self._lock:
            self._model = None
        gc.collect()

    async def embed(self, texts: Sequence[str]) -> tuple[list[list[float]], int]:
        async with self._lock:
            return await asyncio.to_thread(self._embed_sync, list(texts))

    def _embed_sync(self, texts: list[str]) -> tuple[list[list[float]], int]:
        model = self._model
        if model is None:
            raise RuntimeError("embedding model is not loaded")

        started = time.perf_counter()
        arrays = list(
            model.embed(texts, batch_size=min(self.max_batch, len(texts)), parallel=None)
        )
        if len(arrays) != len(texts):
            raise RuntimeError(
                f"model returned {len(arrays)} vectors for {len(texts)} inputs"
            )

        vectors: list[list[float]] = []
        for array in arrays:
            values = np.asarray(array, dtype=np.float32).reshape(-1)
            if values.size != self.dimension:
                raise RuntimeError(
                    f"model returned dimension {values.size}, expected {self.dimension}"
                )
            finite = np.isfinite(values)
            if not bool(finite.all()):
                raise RuntimeError("model returned a non-finite embedding value")
            vectors.append([float(value) for value in values])

        prompt_tokens = int(
            model.token_count(texts, batch_size=min(self.max_batch, len(texts)))
        )
        elapsed = time.perf_counter() - started
        LOGGER.info(
            "Embedded %d text(s), %d token(s) in %.3fs",
            len(texts),
            prompt_tokens,
            elapsed,
        )
        return vectors, prompt_tokens


class EmbeddingRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    input: str | list[str]
    model: str
    encoding_format: Literal["float", "base64"] | None = None
    dimensions: int | None = None
    user: str | None = None


def _validated_texts(request: EmbeddingRequest) -> list[str]:
    if request.model != MODEL_NAME:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported model {request.model!r}; expected {MODEL_NAME!r}",
        )
    if request.dimensions is not None and request.dimensions != DIMENSION:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported dimensions {request.dimensions}; expected {DIMENSION}",
        )

    texts = [request.input] if isinstance(request.input, str) else request.input
    if not texts:
        raise HTTPException(status_code=400, detail="input must not be empty")
    if len(texts) > MAX_TEXTS:
        raise HTTPException(
            status_code=400,
            detail=f"at most {MAX_TEXTS} input texts are accepted per request",
        )

    total_chars = 0
    for index, text in enumerate(texts):
        if not isinstance(text, str) or not text.strip():
            raise HTTPException(
                status_code=400,
                detail=f"input[{index}] must be a non-empty string",
            )
        if len(text) > MAX_TEXT_CHARS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"input[{index}] is {len(text)} characters; "
                    f"the limit is {MAX_TEXT_CHARS}"
                ),
            )
        total_chars += len(text)

    if total_chars > MAX_TOTAL_CHARS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"inputs total {total_chars} characters; "
                f"the limit is {MAX_TOTAL_CHARS}"
            ),
        )
    return texts


def _encode_vector(vector: Sequence[float], encoding_format: str) -> list[float] | str:
    if encoding_format == "base64":
        payload = struct.pack(f"<{len(vector)}f", *vector)
        return base64.b64encode(payload).decode("ascii")
    return [float(value) for value in vector]


def create_app(runtime: EmbeddingBackend | None = None) -> FastAPI:
    """Create the ASGI app; tests may inject a deterministic backend."""
    backend = runtime or EmbeddingRuntime(
        Path(os.environ.get("LMEMBED_MODEL_DIR", DEFAULT_MODEL_DIR))
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        await backend.load()
        try:
            yield
        finally:
            await backend.close()

    app = FastAPI(
        title="LivingMemory local embeddings",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.backend = backend
    created = int(time.time())

    @app.middleware("http")
    async def reject_oversize_bodies(request: Request, call_next):
        if request.method == "POST":
            content_length = request.headers.get("content-length")
            if content_length is not None:
                try:
                    declared = int(content_length)
                except ValueError:
                    return JSONResponse(
                        status_code=400,
                        content={"detail": "invalid Content-Length header"},
                    )
                if declared > MAX_BODY_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": f"request body exceeds {MAX_BODY_BYTES} bytes"},
                    )
        return await call_next(request)

    @app.get("/health")
    async def health() -> JSONResponse:
        payload = {
            "status": "ok" if backend.ready else "unavailable",
            "model": MODEL_NAME,
            "dimension": backend.dimension,
            "model_loaded": backend.ready,
        }
        return JSONResponse(status_code=200 if backend.ready else 503, content=payload)

    @app.get("/v1/models")
    async def models() -> dict:
        return {
            "object": "list",
            "data": [
                {
                    "id": MODEL_NAME,
                    "object": "model",
                    "created": created,
                    "owned_by": "local-fastembed",
                }
            ],
        }

    @app.post("/v1/embeddings")
    async def embeddings(request: EmbeddingRequest) -> dict:
        if not backend.ready:
            raise HTTPException(status_code=503, detail="embedding model is not loaded")

        texts = _validated_texts(request)
        vectors, prompt_tokens = await backend.embed(texts)
        encoding_format = request.encoding_format or "float"

        return {
            "object": "list",
            "data": [
                {
                    "object": "embedding",
                    "embedding": _encode_vector(vector, encoding_format),
                    "index": index,
                }
                for index, vector in enumerate(vectors)
            ],
            "model": MODEL_NAME,
            "usage": {
                "prompt_tokens": prompt_tokens,
                "total_tokens": prompt_tokens,
            },
        }

    return app


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model-dir",
        type=Path,
        default=Path(os.environ.get("LMEMBED_MODEL_DIR", DEFAULT_MODEL_DIR)),
        help=f"verified local FastEmbed snapshot directory (default: {DEFAULT_MODEL_DIR})",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        choices=["127.0.0.1"],
        help="loopback interface only (default: 127.0.0.1)",
    )
    parser.add_argument("--port", type=int, default=6190)
    parser.add_argument(
        "--log-level",
        default="info",
        choices=["debug", "info", "warning", "error"],
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="load and validate the model, then exit without serving",
    )
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    if args.check:
        runtime = EmbeddingRuntime(args.model_dir)

        async def run_check() -> None:
            await runtime.load()
            print(
                json.dumps(
                    {
                        "status": "ok",
                        "model": MODEL_NAME,
                        "dimension": runtime.dimension,
                        "model_dir": str(runtime.model_dir),
                    }
                )
            )
            await runtime.close()

        try:
            asyncio.run(run_check())
        except (ModelLoadError, OSError, ValueError) as exc:
            LOGGER.error("Model check failed: %s", exc)
            return 1
        return 0

    app = create_app(EmbeddingRuntime(args.model_dir, max_batch=MAX_TEXTS))
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level=args.log_level,
        access_log=False,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
