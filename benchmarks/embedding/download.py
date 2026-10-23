"""Download public safetensors to a project-local cache, pinning revisions."""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / '.runtime' / 'embedding-bench'
os.environ['HF_HOME'] = str(RUNTIME / 'hf-cache')
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
os.environ['HF_HUB_DISABLE_XET'] = '1'

from huggingface_hub import HfApi, snapshot_download


def main() -> None:
    lock_path = Path(__file__).with_name('models.lock.json')
    if lock_path.exists():
        lock = json.loads(lock_path.read_text(encoding='utf-8'))
    else:
        api = HfApi(token=False)
        lock = {
            key: {'repo': repo, 'revision': api.model_info(repo).sha}
            for key, repo in {
                'bge': 'BAAI/bge-small-zh-v1.5',
                'qwen': 'Qwen/Qwen3-Embedding-0.6B',
            }.items()
        }
        lock_path.write_text(json.dumps(lock, indent=2) + '\n', encoding='utf-8')
    for key, spec in lock.items():
        print(f'Downloading {key} at {spec["revision"]}', flush=True)
        snapshot_download(
            repo_id=spec['repo'], revision=spec['revision'], token=False,
            local_dir=RUNTIME / 'models' / key,
            allow_patterns=['*.json', '*.safetensors', '*.txt', '*.model'],
            ignore_patterns=['onnx/*', 'openvino/*', '*.bin'], max_workers=3,
        )
        print(f'Ready: {key}', flush=True)


if __name__ == '__main__':
    main()
