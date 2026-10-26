import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { availableParallelism } from 'node:os';

const root = process.env.DAFEIYU_TEST_RUN;
if (!root) throw new Error('MANAGED_TEST_RUN_REQUIRED');
const failures: { name: string; file: string | null }[] = [];
run({ files: process.argv.slice(2), concurrency: Math.max(1, Math.min(4, availableParallelism() - 1)), isolation: 'process',
  setup(stream) { stream.on('test:fail', failure => { if (failures.length < 100) failures.push({ name: failure.name.slice(0, 400), file: failure.file ? basename(failure.file) : null }); });
    stream.on('test:summary', summary => {
    if (summary.file !== undefined) return;
    writeFileSync(join(root, 'summary.json'), JSON.stringify({ success: summary.success, counts: summary.counts, durationMs: summary.duration_ms, failures }));
    if (!summary.success) process.exitCode = 1;
  }); },
}).compose(spec()).pipe(process.stdout);
