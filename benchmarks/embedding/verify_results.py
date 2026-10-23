"""Verify saved benchmark evidence against fixtures and independent metrics."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> None:
    raw = (HERE / 'dataset.json').read_bytes()
    dataset = json.loads(raw)
    docs = {d['id']: d for d in dataset['documents']}
    queries = {q['id']: q for q in dataset['queries']}
    lock = json.loads((HERE / 'models.lock.json').read_text())
    results = {}
    for model in ['bge', 'qwen']:
        for device in ['cpu', 'cuda']:
            key = f'{model}-{device}'
            result = json.loads((HERE / 'results' / f'{key}.json').read_text(encoding='utf-8'))
            assert result['dataset_sha256'] == hashlib.sha256(raw).hexdigest()
            assert result['model_lock'] == lock[model]
            assert result['model'] == model and result['device'] == device
            assert result['documents'] == len(docs) and result['queries'] == len(queries)
            assert result['truncated'] == 0 and result['max_actual_tokens'] <= 512
            assert len(result['query_ms_all']) == len(queries) * 3
            assert all(math.isfinite(v) and v > 0 for v in result['query_ms_all'])
            assert len(result['rows']) == len(queries)
            assert {row['id'] for row in result['rows']} == set(queries)
            for row in result['rows']:
                query = queries[row['id']]
                assert row['relevant'] == query['relevant'] and row['text'] == query['text']
                allowed = {
                    d['id'] for d in docs.values()
                    if d['scope'] == query['scope'] and (
                        d['deleted'] if query['mode'] == 'deleted'
                        else not d['deleted'] and (query['mode'] == 'history' or d['status'] == 'active')
                    )
                }
                assert row['candidate_count'] == len(allowed)
                for method in ['dense', 'bm25', 'hybrid']:
                    assert len(row[method]) == len(set(row[method]))
                    assert set(row[method]) <= allowed
                assert all(math.isfinite(x) and -1.0001 <= x <= 1.0001 for x in row['dense_top_scores'])
            answerable = [row for row in result['rows'] if row['relevant']]
            for method in ['dense', 'bm25', 'hybrid']:
                recall = sum(sum(doc in row[method][:5] for doc in row['relevant']) / len(row['relevant'])
                             for row in answerable) / len(answerable)
                assert math.isclose(recall, result['metrics'][method]['recall5'])
                assert result['metrics'][method]['n'] == len(answerable)
            results[key] = result
    for model in ['bge', 'qwen']:
        assert results[f'{model}-cpu']['metrics'] == results[f'{model}-cuda']['metrics']
    uplift = results['qwen-cpu']['metrics']['dense']['recall5'] - results['bge-cpu']['metrics']['dense']['recall5']
    fast_enough = results['qwen-cpu']['query_ms_p95'] <= 1000 or results['qwen-cuda']['query_ms_p95'] <= 100
    choice = 'qwen' if uplift >= 0.05 and fast_enough else 'bge'
    print(json.dumps({'validated_runs': len(results), 'documents': len(docs), 'queries': len(queries),
                      'selection': choice, 'qwen_recall_uplift_percentage_points': uplift * 100}, indent=2))


if __name__ == '__main__':
    main()
