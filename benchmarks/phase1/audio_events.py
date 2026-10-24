"""Offline YAMNet probe on synthetic speech and tone fixtures, not a production media service."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import time
import wave
from pathlib import Path

import numpy as np
import onnxruntime as ort


def read_pcm(file: Path) -> np.ndarray:
    """Read only the declared 16-kHz mono signed-16-bit probe format."""
    with wave.open(str(file), "rb") as audio:
        if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (16000, 1, 2):
            raise ValueError("UNSUPPORTED_PROBE_AUDIO")
        if audio.getnframes() > 16000 * 30:
            raise ValueError("PROBE_AUDIO_TOO_LONG")
        return np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float32) / 32768


def create_tone(file: Path) -> None:
    """Create a known on/off sine tone; no recorded person or external clip is used."""
    seconds = np.arange(16000 * 6, dtype=np.float64) / 16000
    active = (seconds >= 0.5) & (seconds < 5.5) & ((seconds % 0.5) < 0.25)
    pcm = (np.sin(2 * np.pi * 1000 * seconds) * active * 0.25 * 32767).astype("<i2")
    with wave.open(str(file), "wb") as audio:
        audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        audio.writeframes(pcm.tobytes())


def infer(session: ort.InferenceSession, labels: list[str], file: Path) -> dict:
    """Classify overlapping windows and explicitly include the final source interval."""
    waveform = read_pcm(file)
    count, window, hop = len(waveform), 15600, 7800
    starts = list(range(0, max(1, count - window + 1), hop))
    final_start = max(0, count - window)
    if starts[-1] != final_start:
        starts.append(final_start)
    results, timeline = [], []
    started = time.perf_counter()
    for start in starts:
        frame = waveform[start:start + window]
        frame = np.pad(frame, (0, max(0, window - len(frame))))
        score = np.asarray(session.run(None, {session.get_inputs()[0].name: frame})[0]).reshape(-1)
        if len(score) != len(labels) or not np.isfinite(score).all():
            raise ValueError("INVALID_EVENT_MODEL_OUTPUT")
        results.append(score)
        index = int(score.argmax())
        timeline.append({"start": start / 16000, "end": min(count, start + window) / 16000,
                         "label": labels[index], "score": float(score[index])})
    mean = np.stack(results).mean(axis=0)
    ranked = np.argsort(-mean)[:5]
    return {"fixture": file.name, "sha256": hashlib.sha256(file.read_bytes()).hexdigest(),
            "durationSeconds": count / 16000, "processedEndSeconds": timeline[-1]["end"],
            "durationMs": round((time.perf_counter() - started) * 1000),
            "top": [{"label": labels[int(index)], "score": float(mean[index])} for index in ranked],
            "timeline": timeline}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    models, fixtures = args.root / "models", args.root / "fixtures"
    manifest = json.loads((models / "yamnet-manifest.json").read_text(encoding="utf-8"))
    for entry in manifest["files"]:
        if hashlib.sha256((models / entry["name"]).read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError("EVENT_MODEL_HASH_CHANGED")
    with (models / "yamnet_class_map.csv").open(encoding="utf-8", newline="") as stream:
        labels = [row["display_name"] for row in csv.DictReader(stream)]
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(models / "yamnet.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
    create_tone(fixtures / "tone.wav")
    samples = [infer(session, labels, fixtures / name) for name in ["speech-zh.wav", "speech-en.wav", "tone.wav"]]
    speech_passed = all(any(item["label"] == "Speech" and item["score"] >= 0.25 for item in sample["top"]) for sample in samples[:2])
    tone_passed = any(item["label"] in {"Beep, bleep", "Sine wave"} and item["score"] >= 0.25 for item in samples[2]["top"])
    report = {"kind": "real-local-onnx-inference-synthetic-audio", "model": manifest,
              "onnxruntime": ort.__version__, "numpy": np.__version__, "samples": samples,
              "checks": {"speechDetected": speech_passed, "knownToneDetected": tone_passed,
                         "sourceTailCovered": all(s["processedEndSeconds"] == s["durationSeconds"] for s in samples)}}
    (args.root / "events-result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"checks": report["checks"], "topLabels": [sample["top"] for sample in samples]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
