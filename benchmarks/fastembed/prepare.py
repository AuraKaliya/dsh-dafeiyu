"""Pin public ONNX artifacts and reproduce a read-only server code snapshot."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
RUNTIME = ROOT / '.runtime' / 'fastembed-bench'
os.environ['HF_HOME'] = str(RUNTIME / 'hf-cache')
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['HF_HUB_DISABLE_XET'] = '1'

from huggingface_hub import HfApi, snapshot_download


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def main() -> None:
    manifest_path = HERE / 'server-manifest.json'
    if not manifest_path.exists():
        capture = json.loads((ROOT / '.runtime/embedding-bench/server-contract.json').read_text(encoding='utf-8-sig'))
        source = next(s for s in capture['publicSources'] if s['name'] == 'embedding_service.py')
        source_bytes = source['content'].encode('utf-8')
        assert digest(source_bytes) == source['sha256'], 'Capture differs from original server source bytes'
        reference = HERE / 'reference'
        reference.mkdir(exist_ok=True)
        (reference / source['name']).write_bytes(source_bytes)
        manifest = {
            'checked_at': capture['checkedAt'], 'versions': capture['versions'],
            'model_files': capture['modelFiles'],
            'service_sha256': source['sha256'],
            'fastembed_source_hashes': {s['name']: digest(s['content'].encode('utf-8')) for s in capture['fastembedSources']},
            'source': {'repo': 'Qdrant/bge-small-zh-v1.5', 'revision': HfApi(token=False).model_info('Qdrant/bge-small-zh-v1.5').sha},
        }
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    manifest = json.loads(manifest_path.read_text())
    spec = manifest['source']
    target = RUNTIME / 'model'
    snapshot_download(repo_id=spec['repo'], revision=spec['revision'], token=False,
                      local_dir=target, allow_patterns=[f['name'] for f in manifest['model_files']], max_workers=3)
    for entry in manifest['model_files']:
        data = (target / entry['name']).read_bytes()
        assert len(data) == entry['bytes'] and digest(data) == entry['sha256'], f'Model mismatch: {entry["name"]}'
    print(json.dumps({'verified_model_files': len(manifest['model_files']), 'source': spec,
                      'service_snapshot_sha256': manifest['service_sha256']}, indent=2))


if __name__ == '__main__':
    main()
