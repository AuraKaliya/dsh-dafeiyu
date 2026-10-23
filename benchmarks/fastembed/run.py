"""Exercise the unchanged server ASGI implementation with local synthetic data."""
from __future__ import annotations

import argparse
import base64
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import random
import re
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
RUNTIME = ROOT / '.runtime/fastembed-bench'
for name in ['OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'NUMEXPR_NUM_THREADS']:
    os.environ[name] = '1'
os.environ['HF_HOME'] = str(RUNTIME / 'hf-cache')
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'

import numpy as np
import psutil
from fastapi.testclient import TestClient

PREFIX = '为这个句子生成表示以用于检索相关文章：'


class ResourceSampler:
    def __init__(self) -> None:
        self.process = psutil.Process()
        self.stop = threading.Event()
        self.rss_peak = 0
        self.private_peak = 0
        self.thread = threading.Thread(target=self.sample_loop, daemon=True)

    def sample(self) -> None:
        info = self.process.memory_info()
        self.rss_peak = max(self.rss_peak, info.rss)
        self.private_peak = max(self.private_peak, getattr(info, 'private', info.vms))

    def sample_loop(self) -> None:
        while not self.stop.wait(0.02):
            self.sample()

    def __enter__(self) -> ResourceSampler:
        self.sample()
        self.thread.start()
        return self

    def summary(self) -> dict:
        self.sample()
        info = self.process.memory_info()
        return {'rss_peak_mib': self.rss_peak / 2**20, 'private_peak_mib': self.private_peak / 2**20,
                'rss_current_mib': info.rss / 2**20, 'private_current_mib': getattr(info, 'private', info.vms) / 2**20,
                'os_lifetime_peak_rss_mib': getattr(info, 'peak_wset', self.rss_peak) / 2**20,
                'os_lifetime_peak_commit_mib': getattr(info, 'peak_pagefile', self.private_peak) / 2**20}

    def __exit__(self, *_args: object) -> None:
        self.stop.set()
        self.thread.join()
        self.sample()


def tokens(text: str) -> list[str]:
    result = re.findall(r'[a-z0-9_]+', text.lower())
    for run in re.findall(r'[\u3400-\u9fff]+', text):
        result.extend(run)
        result.extend(run[i:i + 2] for i in range(len(run) - 1))
    return result


def lexical_scores(query: str, docs: list[dict]) -> np.ndarray:
    counts = [Counter(tokens(doc['text'])) for doc in docs]
    average = sum(sum(c.values()) for c in counts) / max(len(counts), 1)
    scores = np.zeros(len(counts))
    for word in set(tokens(query)):
        df = sum(word in c for c in counts)
        idf = math.log(1 + (len(counts) - df + 0.5) / (df + 0.5))
        for i, count in enumerate(counts):
            frequency = count[word]
            scores[i] += idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * sum(count.values()) / max(average, 1)))
    return scores


def eligible(doc: dict, query: dict) -> bool:
    if doc['scope'] != query['scope']:
        return False
    if query['mode'] == 'deleted':
        return doc['deleted']
    return not doc['deleted'] and (query['mode'] == 'history' or doc['status'] == 'active')


def evaluate(rows: list[dict], method: str) -> dict:
    valid = [row for row in rows if row['relevant']]
    return {
        'n': len(valid),
        'hit1': sum(row[method][0] in row['relevant'] for row in valid) / len(valid),
        'hit5': sum(bool(set(row[method][:5]) & set(row['relevant'])) for row in valid) / len(valid),
        'recall5': sum(len(set(row[method][:5]) & set(row['relevant'])) / len(row['relevant']) for row in valid) / len(valid),
        'mrr10': sum(next((1 / (i + 1) for i, value in enumerate(row[method][:10]) if value in row['relevant']), 0) for row in valid) / len(valid),
    }


def fingerprint(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--query-mode', required=True, choices=['raw', 'prefixed'])
    args = parser.parse_args()
    manifest = json.loads((HERE / 'server-manifest.json').read_text())
    model_dir = RUNTIME / 'model'
    for item in manifest['model_files']:
        assert fingerprint(model_dir / item['name']) == item['sha256']
    service_path = HERE / 'reference/embedding_service.py'
    assert fingerprint(service_path) == manifest['service_sha256']
    for version in manifest['versions']:
        assert importlib.metadata.version(version['name']) == version['version']
    dist = importlib.metadata.distribution('fastembed')
    for relative, expected in manifest['fastembed_source_hashes'].items():
        assert fingerprint(Path(dist.locate_file(relative.replace('\\', '/')))) == expected

    raw = (ROOT / 'benchmarks/embedding/dataset.json').read_bytes()
    dataset = json.loads(raw)
    docs, queries = dataset['documents'], dataset['queries']
    doc_texts = [d['text'] for d in docs]
    query_texts = [(PREFIX if args.query_mode == 'prefixed' else '') + q['text'] for q in queries]
    assert all(set(q['relevant']) <= {d['id'] for d in docs if eligible(d, q)} for q in queries)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    with ResourceSampler() as resource:
        spec = importlib.util.spec_from_file_location('server_embedding_reference', service_path)
        assert spec and spec.loader
        service = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = service
        spec.loader.exec_module(service)
        runtime = service.EmbeddingRuntime(model_dir)
        with TestClient(service.create_app(runtime)) as client:
            load_seconds = time.perf_counter() - started
            health = client.get('/health').json()
            assert health['model_loaded'] and health['dimension'] == 512
            assert runtime._model is not None

            def embed(texts: list[str], encoding: str = 'float') -> tuple[np.ndarray, dict]:
                response = client.post('/v1/embeddings', json={'model': service.MODEL_NAME, 'input': texts, 'encoding_format': encoding})
                assert response.status_code == 200, response.text
                payload = response.json()
                assert payload['model'] == service.MODEL_NAME
                assert [item['index'] for item in payload['data']] == list(range(len(texts)))
                arrays = [np.frombuffer(base64.b64decode(item['embedding']), dtype='<f4') if encoding == 'base64'
                          else np.asarray(item['embedding'], dtype=np.float32) for item in payload['data']]
                values = np.stack(arrays)
                assert values.shape == (len(texts), 512) and np.isfinite(values).all()
                assert np.max(np.abs(np.linalg.norm(values, axis=1) - 1)) < 1e-4
                assert payload['usage']['prompt_tokens'] > 0
                assert payload['usage']['prompt_tokens'] == payload['usage']['total_tokens']
                return values, payload['usage']

            for _ in range(3):
                embed([query_texts[0]])
            embed(doc_texts[:8])
            start = time.perf_counter()
            document_vectors = np.concatenate([embed(doc_texts[i:i + 8])[0] for i in range(0, len(docs), 8)])
            index_seconds = time.perf_counter() - start
            durations, vectors = [], {}
            for repeat in range(3):
                order = list(range(len(queries)))
                random.Random(20261023 + repeat).shuffle(order)
                for index in order:
                    begin = time.perf_counter()
                    values, _ = embed([query_texts[index]])
                    durations.append((time.perf_counter() - begin) * 1000)
                    vectors[index] = values[0]
                print(f'{args.query_mode}: repetition {repeat + 1}/3 complete', flush=True)
            normal_memory = resource.summary()
            query_vectors = np.stack([vectors[i] for i in range(len(queries))])
            np.savez(RUNTIME / f'{args.query_mode}-vectors.npz', documents=document_vectors, queries=query_vectors)

            batch, _ = embed(doc_texts[:8])
            singles = np.concatenate([embed([text])[0] for text in doc_texts[:8]])
            batch_difference = float(np.max(np.abs(batch - singles)))
            assert batch_difference <= 1e-5
            b64, _ = embed(doc_texts[:8], 'base64')
            assert np.max(np.abs(batch - b64)) <= 1e-5
            string_response = client.post('/v1/embeddings', json={'model': service.MODEL_NAME, 'input': doc_texts[0], 'dimensions': 512})
            assert string_response.status_code == 200
            assert np.max(np.abs(np.asarray(string_response.json()['data'][0]['embedding']) - singles[0])) <= 1e-5
            direct = np.stack(list(runtime._model.embed(doc_texts[:8], batch_size=8, parallel=None)))
            direct_difference = float(np.max(np.abs(direct - batch)))
            assert direct_difference <= 1e-5

            bad_requests = {
                'empty_array': {'input': []}, 'blank_string': {'input': '  '},
                'wrong_model': {'input': '虚构测试', 'model': 'different'},
                'wrong_dimension': {'input': '虚构测试', 'dimensions': 256},
                'too_many': {'input': ['虚构测试'] * 9}, 'too_long': {'input': '甲' * 6001},
                'too_many_chars': {'input': ['甲' * 4000] * 7},
                'invalid_encoding': {'input': '虚构测试', 'encoding_format': 'unknown'},
            }
            error_status = {}
            for name, extra in bad_requests.items():
                response = client.post('/v1/embeddings', json={'model': service.MODEL_NAME, **extra})
                assert response.status_code == (422 if name == 'invalid_encoding' else 400)
                error_status[name] = response.status_code
            oversize = client.post('/v1/embeddings', content='x', headers={'content-length': str(512 * 1024 + 1)})
            assert oversize.status_code == 413
            error_status['oversize_body'] = oversize.status_code

            # A shared >512-token prefix makes the final facts unreachable after truncation.
            long_prefix = '甲乙丙丁戊己庚辛壬癸' * 80
            tails = [long_prefix + '结论是允许发布。', long_prefix + '结论是禁止发布。']
            long_vectors, long_usage = embed(tails)
            truncation_difference = float(np.max(np.abs(long_vectors[0] - long_vectors[1])))
            stress_texts = [('甲乙丙丁戊己庚辛壬癸' * 100) + f'虚构片段{i}' for i in range(8)]
            stress_durations = []
            with ResourceSampler() as stress:
                for _ in range(20):
                    begin = time.perf_counter()
                    embed(stress_texts)
                    stress_durations.append((time.perf_counter() - begin) * 1000)
                stress_memory = stress.summary()
            overall_memory = resource.summary()

    rows = []
    for i, query in enumerate(queries):
        selected = [j for j, doc in enumerate(docs) if eligible(doc, query)]
        subset = [docs[j] for j in selected]
        dense = document_vectors[selected] @ query_vectors[i]
        lexical = lexical_scores(query['text'], subset)
        orders = {'dense': np.argsort(-dense, kind='stable').tolist(), 'bm25': np.argsort(-lexical, kind='stable').tolist()}
        fusion = np.zeros(len(selected))
        for order in orders.values():
            for rank, position in enumerate(order, 1):
                fusion[position] += 1 / (60 + rank)
        orders['hybrid'] = np.argsort(-fusion, kind='stable').tolist()
        rows.append({'id': query['id'], 'category': query['category'], 'text': query['text'], 'relevant': query['relevant'],
                     'candidate_count': len(selected), **{method: [subset[j]['id'] for j in order[:10]] for method, order in orders.items()},
                     'dense_top_scores': [float(dense[j]) for j in orders['dense'][:5]]})
    result = {
        'timestamp_utc': datetime.now(timezone.utc).isoformat(), 'query_mode': args.query_mode,
        'dataset_sha256': hashlib.sha256(raw).hexdigest(), 'model_source': manifest['source'],
        'model_sha256': next(x['sha256'] for x in manifest['model_files'] if x['name'].endswith('.onnx')),
        'service_sha256': manifest['service_sha256'], 'server_package_versions_matched': True,
        'fastembed_source_hashes_matched': True, 'threads': 1, 'batch': 8, 'repetitions': 3,
        'load_seconds': load_seconds, 'index_seconds': index_seconds, 'index_docs_per_second': len(docs) / index_seconds,
        'query_ms_p50': float(np.percentile(durations, 50)), 'query_ms_p95': float(np.percentile(durations, 95)), 'query_ms_all': durations,
        'memory_normal': normal_memory, 'memory_stress': stress_memory, 'memory_overall': overall_memory,
        'stress_batch_ms_p50': float(np.percentile(stress_durations, 50)), 'stress_batches': 20,
        'contract': {'health': health, 'dimension': 512, 'max_norm_error': float(np.max(np.abs(np.linalg.norm(document_vectors, axis=1)-1))),
                     'single_batch_max_abs_difference': batch_difference, 'direct_http_max_abs_difference': direct_difference,
                     'base64_float_match': True, 'string_array_match': True, 'error_status': error_status,
                     'long_tail_max_abs_difference': truncation_difference, 'long_usage': long_usage},
        'metrics': {method: evaluate(rows, method) for method in ['dense','bm25','hybrid']},
        'rows': rows, 'environment': {'python': platform.python_version(), 'platform': platform.platform(),
                                     'packages': {item['name']: importlib.metadata.version(item['name']) for item in manifest['versions']}},
    }
    output = HERE / 'results' / f'{args.query_mode}.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({key:result[key] for key in ['query_mode','metrics','query_ms_p95','memory_normal','memory_stress','contract']},ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
