"""Test actual window/PCM logic with scripted scores, never a real model."""
import importlib.util
import io
import json
import sys
import unittest
import wave
from pathlib import Path

spec = importlib.util.spec_from_file_location("audio_worker", sys.argv.pop(1))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class AudioWorkerTests(unittest.TestCase):
    """Exercise tail coverage, score shape and PCM rejection."""

    def test_tail_and_padding(self):
        """Short and non-aligned inputs are covered exactly through the last sample."""
        for count in (1, 16000, 45001, 1920000):
            windows = worker.classify([0.0] * count, ["Speech", "Silence"], lambda frame: [0.0, 0.8])
            self.assertEqual(windows[0]["startMs"], 0)
            self.assertEqual(windows[-1]["endMs"], count / 16)
            self.assertLessEqual(len(windows), 256)

    def test_invalid_scores(self):
        """NaN and wrong class dimensions do not become sound events."""
        for scores in ([float("nan")], [], [0.1, 0.2]):
            with self.assertRaises(ValueError):
                worker.classify([0.0], ["Speech"], lambda frame: scores)

    def test_pcm(self):
        """Read a real synthetic WAV and reject a different rate."""
        file = Path.cwd() / "fixture.wav"
        for rate in (16000, 8000):
            with wave.open(str(file), "wb") as output:
                output.setparams((1, 2, rate, 0, "NONE", "not compressed"))
                output.writeframes(b"\x00\x00" * 160)
            if rate == 16000:
                self.assertEqual(len(worker.read_pcm(file)), 160)
            else:
                with self.assertRaises(ValueError):
                    worker.read_pcm(file)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(AudioWorkerTests)
    result = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
    print(json.dumps({"passed": result.wasSuccessful(), "tests": result.testsRun}))
    sys.exit(0 if result.wasSuccessful() else 1)
