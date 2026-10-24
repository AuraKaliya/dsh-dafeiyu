import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const directory = resolve('.runtime/phase1-probes/audio/models');
const sources = [
  { repository: 'ggerganov/whisper.cpp', revision: '5359861c739e955e79d9a303bcbc70fb988958b1',
    remote: 'ggml-tiny.bin', name: 'ggml-tiny.bin', bytes: 77691713,
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21' },
  { repository: 'niobures/YAMNet', revision: '080fce0c9e69a9a6da1c1c141c6fcb0b33d0c465',
    remote: 'yamnetonnx/yamnet.onnx', name: 'yamnet.onnx', bytes: 16124200,
    sha256: '04e27fca08e7a3aea2630d1a63a51e6b437c803e0ff6e26399f80870ac251dda' },
  { repository: 'niobures/YAMNet', revision: '080fce0c9e69a9a6da1c1c141c6fcb0b33d0c465',
    remote: 'yamnetonnx/yamnet_class_map.csv', name: 'yamnet_class_map.csv', bytes: 14096,
    sha256: 'cdf24d193e196d9e95912a2667051ae203e92a2ba09449218ccb40ef787c6df2' },
];
await mkdir(directory, { recursive: true });
for (const source of sources) {
  const file = join(directory, source.name);
  let bytes;
  try { bytes = await readFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (bytes && (bytes.length !== source.bytes || createHash('sha256').update(bytes).digest('hex') !== source.sha256)) throw new Error('EXISTING_MODEL_MISMATCH');
  if (!bytes) {
    const response = await fetch(`https://huggingface.co/${source.repository}/resolve/${source.revision}/${source.remote}`, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error('MODEL_DOWNLOAD_FAILED');
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== source.bytes || createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error('MODEL_CHECKSUM_FAILED');
    await writeFile(file, bytes, { flag: 'wx' });
  }
  console.log(JSON.stringify({ file: source.name, verifiedBytes: bytes.length, sha256: source.sha256 }));
}
const whisper = sources[0];
await writeFile(join(directory, 'whisper-manifest.json'), JSON.stringify({ repository: whisper.repository, revision: whisper.revision,
  file: whisper.name, bytes: whisper.bytes, sha256: whisper.sha256 }, null, 2) + '\n');
await writeFile(join(directory, 'yamnet-manifest.json'), JSON.stringify({ repository: sources[1].repository, revision: sources[1].revision,
  files: sources.slice(1).map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })) }, null, 2) + '\n');
