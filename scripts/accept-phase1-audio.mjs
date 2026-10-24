import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve('.runtime/phase1-probes/audio');
await mkdir(join(root, 'attempts'), { recursive: true });
try {
  const previous = await readFile(join(root, 'report.json'), 'utf8');
  const prior = JSON.parse(previous);
  await writeFile(join(root, 'attempts', `${prior.runId ?? 'initial-setup-failure'}.json`), previous, { flag: 'wx' });
} catch (error) { if (!['ENOENT', 'EEXIST'].includes(error?.code)) throw error; }
const require = createRequire(resolve('.runtime/phase1-probes/audio-node/package.json'));
const { initWhisper, toggleNativeLog } = require('@fugood/whisper.node');
const model = JSON.parse(await readFile(join(root, 'models/whisper-manifest.json'), 'utf8'));
const modelFile = join(root, 'models', model.file);
if (createHash('sha256').update(await readFile(modelFile)).digest('hex') !== model.sha256) throw new Error('WHISPER_MODEL_CHANGED');
const report = { schemaVersion: 1, stage: '1A', probe: 'P1-P04', at: new Date().toISOString(),
  runId: randomUUID(),
  kind: 'real-local-inference-synthetic-speech-and-tone', model, serverAccess: false, nativeChatAudioSupported: false,
  backend: '@fugood/whisper.node@1.1.3 CPU', samples: [], passed: false };
let context;
try {
  await toggleNativeLog(false);
  const started = Date.now(); context = await initWhisper({ filePath: modelFile, useGpu: false });
  report.loadMs = Date.now() - started; report.loadedRssBytes = process.memoryUsage().rss;
  for (const [name, language] of [['speech-zh', 'zh'], ['speech-en', 'en']]) {
    const file = join(root, 'fixtures', name + '.wav'), start = Date.now();
    const job = context.transcribeFile(file, { language, temperature: 0, maxThreads: 2, tokenTimestamps: true });
    const deadline = setTimeout(() => { void job.stop(); }, 120000);
    let result; try { result = await job.promise; } finally { clearTimeout(deadline); }
    const text = typeof result.result === 'string' ? result.result : '';
    const normalized = text.toLowerCase().replace(/\s/g, '');
    const matched = language === 'zh'
      ? [/蓝色灯|藍色燈/.test(text), /三次|3次/.test(text), /关闭|關閉/.test(text)]
      : ['blue', 'three', 'off'].map(word => normalized.includes(word));
    report.samples.push({ name, language, source: 'local system TTS, no subtitles supplied',
      sha256: createHash('sha256').update(await readFile(file)).digest('hex'), text,
      segments: result.segments, timestampUnit: 'milliseconds', aborted: result.isAborted === true, durationMs: Date.now() - start,
      factsMatched: matched, observedRssBytes: process.memoryUsage().rss });
  }
  execFileSync(resolve('.runtime/fastembed-bench/venv/Scripts/python.exe'),
    ['benchmarks/phase1/audio_events.py', '--root', root], { cwd: process.cwd(), encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  report.events = JSON.parse(await readFile(join(root, 'events-result.json'), 'utf8'));
  report.passed = report.samples.every(sample => !sample.aborted && sample.factsMatched.every(Boolean) && sample.segments?.length > 0)
    && Object.values(report.events.checks).every(Boolean);
} catch { report.error = 'AUDIO_PROBE_INCOMPLETE'; }
finally {
  if (context) await context.release();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(root, 'attempts', `${report.runId}.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await mkdir(resolve('docs/results'), { recursive: true });
  await writeFile(resolve('docs/results/phase1a-audio.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ probe: report.probe, passed: report.passed,
    samples: report.samples.map(({segments:_segments,...sample}) => sample), eventChecks: report.events?.checks, error: report.error ?? null }));
  if (!report.passed) process.exitCode = 1;
}
