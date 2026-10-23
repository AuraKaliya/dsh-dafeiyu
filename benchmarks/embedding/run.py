"""Reproducible synthetic retrieval benchmark; never connects to DSH or QQ."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import random
import re
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
RUNTIME = ROOT / '.runtime' / 'embedding-bench'
os.environ['HF_HOME'] = str(RUNTIME / 'hf-cache')
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'

import numpy as np
import psutil
import torch
from transformers import AutoModel, AutoTokenizer


class ResourceSampler:
    """Sample process working set; CUDA peaks are measured by PyTorch."""

    def __init__(self) -> None:
        self.process = psutil.Process()
        self.baseline = self.process.memory_info().rss
        self.peak = self.baseline
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._sample, daemon=True)

    def _sample(self) -> None:
        while not self.stop.wait(0.02):
            self.peak = max(self.peak, self.process.memory_info().rss)

    def __enter__(self) -> ResourceSampler:
        self.thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self.stop.set()
        self.thread.join()
        self.peak = max(self.peak, self.process.memory_info().rss)


def tokens(text: str) -> list[str]:
    """Simple frozen baseline: Latin identifiers and CJK uni/bigrams."""
    output = re.findall(r'[a-z0-9_]+', text.lower())
    for run in re.findall(r'[\u3400-\u9fff]+', text):
        output.extend(run)
        output.extend(run[i:i + 2] for i in range(len(run) - 1))
    return output


def lexical_scores(text: str, docs: list[dict]) -> np.ndarray:
    counts = [Counter(tokens(d['text'])) for d in docs]
    n = len(docs)
    avg = sum(sum(c.values()) for c in counts) / max(n, 1)
    scores = np.zeros(n, dtype=np.float64)
    for token in set(tokens(text)):
        df = sum(token in c for c in counts)
        idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
        for i, count in enumerate(counts):
            freq = count[token]
            denom = freq + 1.2 * (0.25 + 0.75 * sum(count.values()) / max(avg, 1))
            scores[i] += idf * freq * 2.2 / denom
    return scores


def eligible(doc: dict, query: dict) -> bool:
    if doc['scope'] != query['scope']:
        return False
    if query['mode'] == 'deleted':
        return doc['deleted']
    return not doc['deleted'] and (query['mode'] == 'history' or doc['status'] == 'active')


def metrics(rows: list[dict], method: str) -> dict:
    answerable = [row for row in rows if row['relevant']]
    values = {'hit1': [], 'hit5': [], 'recall5': [], 'mrr10': []}
    for row in answerable:
        gold = set(row['relevant'])
        ranked = row[method]
        values['hit1'].append(float(ranked[0] in gold))
        values['hit5'].append(float(bool(set(ranked[:5]) & gold)))
        values['recall5'].append(len(set(ranked[:5]) & gold) / len(gold))
        values['mrr10'].append(next((1 / (i + 1) for i, doc in enumerate(ranked[:10]) if doc in gold), 0.0))
    return {'n': len(answerable), **{key: float(np.mean(value)) for key, value in values.items()}}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=['bge', 'qwen'], required=True)
    parser.add_argument('--device', choices=['cpu', 'cuda'], required=True)
    args = parser.parse_args()
    torch.set_num_threads(8)
    torch.set_num_interop_threads(1)
    torch.manual_seed(20261023)
    if args.device == 'cuda' and not torch.cuda.is_available():
        raise RuntimeError('CUDA requested but unavailable; no silent CPU fallback')
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    raw = (HERE / 'dataset.json').read_bytes()
    data = json.loads(raw)
    docs, queries = data['documents'], data['queries']
    ids = [d['id'] for d in docs]
    assert len(ids) == len(set(ids))
    assert len({q['id'] for q in queries}) == len(queries)
    for q in queries:
        assert set(q['relevant']) <= {d['id'] for d in docs if eligible(d, q)}
    lock = json.loads((HERE / 'models.lock.json').read_text())
    model_dir = RUNTIME / 'models' / args.model

    def sync() -> None:
        if args.device == 'cuda':
            torch.cuda.synchronize()

    def query_text(text: str) -> str:
        if args.model == 'bge':
            return '为这个句子生成表示以用于检索相关文章：' + text
        return 'Instruct: Given a Chinese memory search query, retrieve relevant passages that answer the query\nQuery:' + text

    started = time.perf_counter()
    with ResourceSampler() as resource:
        tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False,
                                                   padding_side='left' if args.model == 'qwen' else 'right')
        model = AutoModel.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False,
                                         use_safetensors=True, torch_dtype=torch.float32,
                                         attn_implementation='sdpa').to(args.device).eval()
        if args.model == 'qwen':
            model.config.use_cache = False
        sync()
        load_seconds = time.perf_counter() - started
        parameter_count = sum(p.numel() for p in model.parameters())
        load_rss = resource.process.memory_info().rss

        @torch.inference_mode()
        def encode(texts: list[str]) -> np.ndarray:
            batch = tokenizer(texts, padding=True, truncation=True, max_length=512, return_tensors='pt').to(args.device)
            hidden = model(**batch).last_hidden_state
            pooled = hidden[:, 0] if args.model == 'bge' else hidden[:, -1]
            normalized = torch.nn.functional.normalize(pooled, p=2, dim=1)
            return normalized.float().cpu().numpy()

        doc_texts = [d['text'] for d in docs]
        query_texts = [query_text(q['text']) for q in queries]
        lengths = [len(x) for x in tokenizer(doc_texts + query_texts, truncation=False)['input_ids']]
        assert max(lengths) <= 512, 'Dataset would be truncated; revise protocol before measuring'
        # Warm both query and batch paths before measuring, without using labels.
        for _ in range(3):
            encode([query_texts[0]])
        encode(doc_texts[:16])
        sync()
        if args.device == 'cuda':
            torch.cuda.reset_peak_memory_stats()
        cpu_before = resource.process.cpu_times()
        begin = time.perf_counter()
        document_vectors = np.concatenate([encode(doc_texts[i:i + 16]) for i in range(0, len(docs), 16)])
        sync()
        index_seconds = time.perf_counter() - begin
        query_vectors = {}
        durations = []
        for repeat in range(3):
            order = list(range(len(queries)))
            random.Random(20261023 + repeat).shuffle(order)
            for i in order:
                sync()
                begin = time.perf_counter()
                vector = encode([query_texts[i]])[0]
                sync()
                durations.append((time.perf_counter() - begin) * 1000)
                query_vectors[i] = vector
            print(f'{args.model}/{args.device}: query repetition {repeat + 1}/3 complete', flush=True)
        cpu_after = resource.process.cpu_times()
        measured_cpu = (cpu_after.user + cpu_after.system) - (cpu_before.user + cpu_before.system)
        steady_rss = resource.process.memory_info().rss
        cuda = None if args.device == 'cpu' else {
            'allocated_peak_mib': torch.cuda.max_memory_allocated() / 2**20,
            'reserved_peak_mib': torch.cuda.max_memory_reserved() / 2**20,
            'device': torch.cuda.get_device_name(),
        }
        rows = []
        search_ms = []
        for i, q in enumerate(queries):
            selected = [j for j, d in enumerate(docs) if eligible(d, q)]
            begin = time.perf_counter()
            dense = document_vectors[selected] @ query_vectors[i]
            search_ms.append((time.perf_counter() - begin) * 1000)
            subset = [docs[j] for j in selected]
            lexical = lexical_scores(q['text'], subset)
            dense_order = np.argsort(-dense, kind='stable').tolist()
            lex_order = np.argsort(-lexical, kind='stable').tolist()
            fused = np.zeros(len(selected))
            for order in [dense_order, lex_order]:
                for rank, position in enumerate(order, 1):
                    fused[position] += 1 / (60 + rank)
            hybrid_order = np.argsort(-fused, kind='stable').tolist()
            rows.append({
                'id': q['id'], 'category': q['category'], 'text': q['text'], 'relevant': q['relevant'],
                'candidate_count': len(selected),
                'dense': [subset[j]['id'] for j in dense_order[:10]],
                'bm25': [subset[j]['id'] for j in lex_order[:10]],
                'hybrid': [subset[j]['id'] for j in hybrid_order[:10]],
                'dense_top_scores': [float(dense[j]) for j in dense_order[:5]],
            })
    result = {
        'timestamp_utc': datetime.now(timezone.utc).isoformat(),
        'dataset_sha256': hashlib.sha256(raw).hexdigest(),
        'model': args.model, 'model_lock': lock[args.model], 'device': args.device,
        'dtype': 'float32', 'threads': 8, 'batch_size': 16, 'repetitions': 3,
        'max_length': 512, 'max_actual_tokens': max(lengths), 'truncated': 0,
        'query_instruction': query_text(''), 'parameters': parameter_count,
        'dimensions': document_vectors.shape[1], 'documents': len(docs), 'queries': len(queries),
        'weight_mib': sum(p.stat().st_size for p in model_dir.rglob('*.safetensors')) / 2**20,
        'load_seconds': load_seconds, 'index_seconds': index_seconds,
        'index_docs_per_second': len(docs) / index_seconds,
        'query_ms_p50': float(np.percentile(durations, 50)), 'query_ms_p95': float(np.percentile(durations, 95)),
        'query_ms_all': durations, 'exact_vector_search_ms_p50': float(np.percentile(search_ms, 50)),
        'process_rss_baseline_mib': resource.baseline / 2**20,
        'process_rss_loaded_mib': load_rss / 2**20, 'process_rss_steady_mib': steady_rss / 2**20,
        'process_rss_peak_mib': resource.peak / 2**20,
        'encode_cpu_seconds': measured_cpu, 'cuda': cuda,
        'metrics': {method: metrics(rows, method) for method in ['dense', 'bm25', 'hybrid']},
        'by_category': {category: metrics([r for r in rows if r['category'] == category], 'dense')
                        for category in sorted({r['category'] for r in rows}) if category != 'no_answer'},
        'rows': rows,
        'environment': {'python': platform.python_version(), 'platform': platform.platform(),
                        'packages': {p: importlib.metadata.version(p) for p in ['torch','transformers','numpy','psutil','huggingface-hub']}},
    }
    output = HERE / 'results' / f'{args.model}-{args.device}.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: result[k] for k in ['model', 'device', 'metrics', 'query_ms_p50', 'query_ms_p95', 'process_rss_peak_mib', 'cuda']}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
