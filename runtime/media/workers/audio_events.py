"""Bounded YAMNet worker; raw scores and exact window coverage, never speaker identity."""
from __future__ import annotations

import array
import csv
import hashlib
import json
import math
import sys
import wave
from pathlib import Path
from typing import Callable


def read_pcm(file: Path) -> list[float]:
    """Read only bounded, complete mono 16-kHz PCM16."""
    with wave.open(str(file), "rb") as source:
        if (source.getframerate(), source.getnchannels(), source.getsampwidth()) != (16000, 1, 2):
            raise ValueError("MEDIA_PCM_INVALID")
        count = source.getnframes()
        if not 0 < count <= 16000 * 120:
            raise ValueError("MEDIA_AUDIO_LIMIT")
        data = source.readframes(count)
        if len(data) != count * 2:
            raise ValueError("MEDIA_PCM_TRUNCATED")
    samples = array.array("h", data)
    if sys.byteorder != "little":
        samples.byteswap()
    return [value / 32768 for value in samples]


def classify(samples: list[float], labels: list[str], predict: Callable) -> list[dict]:
    """Classify overlapping windows with explicit tail coverage; prediction is injectable."""
    count, window, hop = len(samples), 15600, 7800
    if not 0 < count <= 16000 * 120 or not labels:
        raise ValueError("MEDIA_AUDIO_LIMIT")
    starts = list(range(0, max(1, count - window + 1), hop))
    final = max(0, count - window)
    if starts[-1] != final:
        starts.append(final)
    windows = []
    for start in starts:
        frame = samples[start:start + window]
        frame.extend([0.0] * (window - len(frame)))
        scores = list(predict(frame))
        if len(scores) != len(labels) or not all(math.isfinite(score) for score in scores):
            raise ValueError("MEDIA_EVENT_OUTPUT_INVALID")
        indices = sorted(range(len(labels)), key=lambda i: scores[i], reverse=True)[:3]
        windows.append({"startMs": start / 16, "endMs": min(count, start + window) / 16,
                        "scores": [{"label": labels[i], "score": float(scores[i])} for i in indices]})
    return windows


def verify(file: Path, expected: str) -> None:
    """Validate the configured immutable file before model loading."""
    with file.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != expected:
        raise ValueError("MEDIA_MODEL_HASH_CHANGED")


def main() -> None:
    """Run a single job under the parent Windows Job memory and lifetime limits."""
    import numpy as np
    import onnxruntime as ort

    spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if np.__version__ != spec["numpyVersion"] or ort.__version__ != spec["onnxruntimeVersion"]:
        raise ValueError("MEDIA_BACKEND_VERSION_CHANGED")
    for entry in (spec["model"], spec["labels"]):
        verify(Path(entry["path"]), entry["sha256"])
    verify(Path(spec["input"]), spec["inputSha256"])
    samples = read_pcm(Path(spec["input"]))
    if len(samples) != spec["samples"]:
        raise ValueError("MEDIA_PCM_CHANGED")
    with Path(spec["labels"]["path"]).open(encoding="utf-8", newline="") as stream:
        rows = list(csv.DictReader(stream))
    if len(rows) != 521 or any(int(row["index"]) != index for index, row in enumerate(rows)):
        raise ValueError("MEDIA_LABELS_INVALID")
    labels = [row["display_name"] for row in rows]
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(spec["model"]["path"], sess_options=options, providers=["CPUExecutionProvider"])

    def predict(frame: list[float]) -> list[float]:
        """Return the fixed model's per-class scores."""
        return np.asarray(session.run(None, {session.get_inputs()[0].name: np.asarray(frame, dtype=np.float32)})[0]).reshape(-1).tolist()

    windows = classify(samples, labels, predict)
    output = {"schemaVersion": 1, "kind": "events", "inputSha256": spec["inputSha256"], "samples": len(samples),
              "backend": "yamnet-onnx", "modelSha256": spec["model"]["sha256"], "labelsSha256": spec["labels"]["sha256"],
              "onnxruntimeVersion": ort.__version__, "numpyVersion": np.__version__, "windows": windows}
    print(json.dumps(output, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Process-boundary sanitization: no private filenames or backend tracebacks leave the worker.
        sys.stderr.write("MEDIA_EVENTS_WORKER_FAILED")
        sys.exit(1)
