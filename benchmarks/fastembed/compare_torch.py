"""Run in the earlier Torch venv after ONNX measurements finish."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer


def differences(a: np.ndarray, b: np.ndarray) -> dict:
    a64, b64 = a.astype(np.float64), b.astype(np.float64)
    cosines = np.sum(a64 * b64, axis=1) / (np.linalg.norm(a64, axis=1) * np.linalg.norm(b64, axis=1))
    return {'vectors': len(a), 'max_abs_difference': float(np.max(np.abs(a64-b64))),
            'mean_abs_difference': float(np.mean(np.abs(a64-b64))),
            'min_cosine': float(np.min(cosines)), 'mean_cosine': float(np.mean(cosines)),
            'within_1e_5_abs': bool(np.max(np.abs(a64-b64)) <= 1e-5)}


def main() -> None:
    raw = (ROOT / 'benchmarks/embedding/dataset.json').read_bytes()
    dataset = json.loads(raw)
    torch.set_num_threads(8)
    model_dir = ROOT / '.runtime/embedding-bench/models/bge'
    tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False)
    model = AutoModel.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False,
                                     use_safetensors=True, torch_dtype=torch.float32, attn_implementation='sdpa').eval()

    @torch.inference_mode()
    def encode(texts: list[str]) -> np.ndarray:
        outputs = []
        for offset in range(0, len(texts), 16):
            inputs = tokenizer(texts[offset:offset+16], padding=True, truncation=True, max_length=512, return_tensors='pt')
            vector = model(**inputs).last_hidden_state[:, 0]
            outputs.append(torch.nn.functional.normalize(vector, p=2, dim=1).numpy())
        return np.concatenate(outputs)

    torch_docs = encode([d['text'] for d in dataset['documents']])
    result = {'dataset_sha256': hashlib.sha256(raw).hexdigest(), 'comparison': {}}
    for mode in ['raw','prefixed']:
        prefix = '为这个句子生成表示以用于检索相关文章：' if mode == 'prefixed' else ''
        torch_queries = encode([prefix + q['text'] for q in dataset['queries']])
        onnx = np.load(ROOT / f'.runtime/fastembed-bench/{mode}-vectors.npz')
        result['comparison'][mode] = {'documents': differences(torch_docs, onnx['documents']),
                                       'queries': differences(torch_queries, onnx['queries'])}
    result['comparison_kind'] = 'Same input strings; original BAAI safetensors vs server-hash-matched Qdrant ONNX; sample equivalence only'
    path = HERE / 'results/torch-comparison.json'
    path.write_text(json.dumps(result, indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
