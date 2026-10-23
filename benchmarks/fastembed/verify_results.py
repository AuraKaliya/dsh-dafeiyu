"""Independent validation of saved ONNX evidence; requires only stdlib."""
import hashlib
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def main() -> None:
    raw = (ROOT / 'benchmarks/embedding/dataset.json').read_bytes()
    dataset = json.loads(raw)
    docs = {d['id']: d for d in dataset['documents']}
    queries = {q['id']: q for q in dataset['queries']}
    manifest = json.loads((HERE / 'server-manifest.json').read_text())
    source = (HERE / 'reference/embedding_service.py').read_bytes()
    assert hashlib.sha256(source).hexdigest() == manifest['service_sha256']
    results = {}
    for mode in ['raw', 'prefixed']:
        result = json.loads((HERE / 'results' / f'{mode}.json').read_text(encoding='utf-8'))
        assert result['query_mode'] == mode
        assert result['dataset_sha256'] == hashlib.sha256(raw).hexdigest()
        assert result['service_sha256'] == manifest['service_sha256']
        assert result['model_source'] == manifest['source']
        assert result['server_package_versions_matched'] and result['fastembed_source_hashes_matched']
        assert len(result['query_ms_all']) == len(queries) * 3
        assert len(result['rows']) == len(queries)
        assert {r['id'] for r in result['rows']} == set(queries)
        for row in result['rows']:
            q = queries[row['id']]
            assert row['relevant'] == q['relevant']
            allowed = {d['id'] for d in docs.values() if d['scope'] == q['scope'] and
                       (d['deleted'] if q['mode'] == 'deleted' else not d['deleted'] and
                        (q['mode'] == 'history' or d['status'] == 'active'))}
            assert len(allowed) == row['candidate_count']
            for method in ['dense', 'bm25', 'hybrid']:
                assert set(row[method]) <= allowed and len(row[method]) == len(set(row[method]))
        answered = [r for r in result['rows'] if r['relevant']]
        for method in ['dense', 'bm25', 'hybrid']:
            score = sum(sum(d in r[method][:5] for d in r['relevant']) / len(r['relevant']) for r in answered) / len(answered)
            assert math.isclose(score, result['metrics'][method]['recall5'])
        contract = result['contract']
        assert contract['dimension'] == 512 and contract['max_norm_error'] < 1e-4
        assert contract['single_batch_max_abs_difference'] <= 1e-5
        assert contract['direct_http_max_abs_difference'] <= 1e-5
        assert contract['base64_float_match'] and contract['string_array_match']
        assert len(contract['error_status']) == 9
        assert contract['long_tail_max_abs_difference'] == 0
        assert contract['long_usage']['prompt_tokens'] == 1024
        assert result['memory_stress']['os_lifetime_peak_commit_mib'] < 512
        results[mode] = result
    old = json.loads((ROOT / 'benchmarks/embedding/results/bge-cpu.json').read_text(encoding='utf-8'))
    for method in ['dense', 'bm25', 'hybrid']:
        for metric in ['hit1', 'hit5', 'recall5', 'mrr10']:
            assert math.isclose(results['prefixed']['metrics'][method][metric], old['metrics'][method][metric])
    comparison = json.loads((HERE / 'results/torch-comparison.json').read_text())
    assert comparison['dataset_sha256'] == hashlib.sha256(raw).hexdigest()
    assert all(math.isfinite(v['max_abs_difference']) for m in comparison['comparison'].values() for v in m.values())
    print(json.dumps({'validated_modes': 2, 'answerable_queries': len(answered),
                      'model_file_fingerprints': len(manifest['model_files']),
                      'invalid_request_cases_per_mode': 9,
                      'retrieval_matches_previous_prefixed_bge': True,
                      'within_embedding_512_mib_commit_envelope': True}, indent=2))


if __name__ == '__main__':
    main()
