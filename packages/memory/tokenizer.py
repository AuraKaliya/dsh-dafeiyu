"""Bounded JSON-lines tokenizer worker. No model, network, archive or database access."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import sys


def file_hash(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def split_text(tokenizer, text: str, profile: dict) -> list[dict]:
    """Keep exact Unicode codepoint offsets; re-encode each slice to prove its budget."""
    pieces = []
    start = 0
    while start < len(text):
        rest = text[start:]
        encoding = tokenizer.encode(rest, add_special_tokens=False)
        capacity = profile['chunkTokens'] - tokenizer.num_special_tokens_to_add(False)
        proposed = encoding.offsets[capacity-1][1] if len(encoding.ids) > capacity else len(rest)
        end = min(len(rest), max(1, proposed), profile['chunkChars'])
        boundaries = [m.end() for m in re.finditer(r'[。！？；\n]', rest[:end]) if m.end() >= end // 2]
        if boundaries:
            end = boundaries[-1]
        # WordPiece [UNK] and boundary changes can invalidate an offset-based token estimate.
        if len(tokenizer.encode(rest[:end]).ids) > profile['chunkTokens']:
            low, high = 1, end
            best = 0
            while low <= high:
                middle = (low + high) // 2
                if len(tokenizer.encode(rest[:middle]).ids) <= profile['chunkTokens']:
                    best = middle
                    low = middle + 1
                else:
                    high = middle - 1
            if not best:
                raise ValueError('unencodable_slice')
            end = best
        fragment = rest[:end]
        count = len(tokenizer.encode(fragment).ids)
        if count > profile['chunkTokens']:
            raise ValueError('over_budget')
        pieces.append({'start': start, 'end': start + end, 'text': fragment, 'tokens': count})
        start += end
    return pieces


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--service-file', required=True)
    parser.add_argument('--packages')
    args = parser.parse_args()
    if args.packages:
        sys.path.insert(0, args.packages)
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    tokenizer = None
    profile = None
    for line in sys.stdin:
        request_id = None
        try:
            if len(line) > 150_000:
                raise ValueError('oversized_request')
            request = json.loads(line)
            request_id = request['id']
            operation = request['op']
            if operation == 'hello':
                profile = request['profile']
                model_dir = Path(args.model_dir)
                for asset in profile['assets']:
                    if Path(asset['file']).name != asset['file'] or file_hash(model_dir / asset['file']) != asset['sha256']:
                        raise ValueError('profile_mismatch')
                if file_hash(Path(args.service_file)) != profile['serviceSha256']:
                    raise ValueError('profile_mismatch')
                for name, version in profile['software'].items():
                    if importlib.metadata.version(name) != version:
                        raise ValueError('profile_mismatch')
                distribution = importlib.metadata.distribution('fastembed')
                for relative, expected in profile['fastembedSources'].items():
                    if file_hash(Path(distribution.locate_file(relative))) != expected:
                        raise ValueError('profile_mismatch')
                from tokenizers import Tokenizer
                tokenizer = Tokenizer.from_file(str(model_dir / 'tokenizer.json'))
                tokenizer.no_truncation()
                tokenizer.no_padding()
                result = {'ready': True, 'workerHash': file_hash(Path(__file__))}
            else:
                if tokenizer is None or profile is None:
                    raise ValueError('not_ready')
                text = request['text']
                if not isinstance(text, str) or len(text) > 8000:
                    raise ValueError('invalid_text')
                if operation == 'chunks':
                    result = split_text(tokenizer, text, profile)
                elif operation == 'query':
                    prepared = profile['queryPrefix'] + text
                    count = len(tokenizer.encode(prepared).ids)
                    if count > profile['maxTokens'] or len(prepared) > 6000:
                        raise ValueError('query_too_long')
                    result = {'text': prepared, 'tokens': count}
                else:
                    raise ValueError('invalid_operation')
            response = {'id': request_id, 'ok': True, 'result': result}
        except (ValueError, KeyError, TypeError, OSError, ImportError):
            # Never return input fragments or raw file/provider errors over the protocol.
            code = 'profile_mismatch' if request_id is not None and request.get('op') == 'hello' else 'tokenizer_unavailable'
            if request_id is not None and request.get('op') == 'query':
                code = 'query_too_long'
            response = {'id': request_id, 'ok': False, 'error': code}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
