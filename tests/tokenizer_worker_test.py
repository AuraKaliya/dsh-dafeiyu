"""Explicit local contract test; run with the prepared FastEmbed Python environment."""
import importlib.util
import json
from pathlib import Path
import unittest
from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('memory_tokenizer_worker', ROOT / 'packages/memory/tokenizer.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class ChunkContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tokenizer = Tokenizer.from_file(str(ROOT / '.runtime/fastembed-bench/model/tokenizer.json'))
        cls.tokenizer.no_truncation()
        cls.tokenizer.no_padding()
        cls.profile = json.loads((ROOT / 'packages/memory/profiles/bge-onnx-v1.json').read_text(encoding='utf-8'))

    def check_text(self, text):
        chunks = worker.split_text(self.tokenizer, text, self.profile)
        self.assertEqual(''.join(item['text'] for item in chunks), text)
        end = 0
        for item in chunks:
            self.assertEqual(item['start'], end)
            self.assertEqual(text[item['start']:item['end']], item['text'])
            self.assertEqual(len(self.tokenizer.encode(item['text']).ids), item['tokens'])
            self.assertLessEqual(item['tokens'], 480)
            self.assertLessEqual(len(item['text']), 6000)
            end = item['end']
        self.assertEqual(end, len(text))
        return chunks

    def test_long_chinese_tail_is_preserved(self):
        chunks = self.check_text('普通背景。' * 500 + '最后的暗号是琉璃923。')
        self.assertGreater(len(chunks), 1)
        self.assertIn('琉璃923', chunks[-1]['text'])

    def test_unicode_codepoints_and_combining_marks(self):
        self.check_text(('🐟👩‍💻月舟 cafe\u0301，\r\n' * 180) + '尾部测试')

    def test_unknown_long_latin_word_respects_character_limit(self):
        self.assertGreaterEqual(len(self.check_text('a' * 7000)), 2)

    def test_whitespace_and_semantic_boundaries_do_not_lose_text(self):
        self.check_text('开始。' + ' ' * 6200 + '结束；\n保留原话。')


if __name__ == '__main__':
    unittest.main()
