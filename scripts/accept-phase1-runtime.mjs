import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parseDocument } from 'yaml';

// Isolated, fictional probes through the existing DSH DeepSeek credential service.
const root = resolve('.runtime/phase1-probes', `runtime-${randomUUID()}`);
await mkdir(root, { recursive: true });
process.env.DSH_HOME = resolve(root, 'dsh-home');
const { localHost, model } = await import('./local-host.mjs');
const { createProbeAgent, installProbeProjection, probeInput, runProbeTurn, containsPrivateModelState } = await import('../build-tests/phase1-probe-fixture.js');
const profile = parseDocument(await readFile(join(homedir(), '.dsh/profiles/desktop/cordis.patch.yml'), 'utf8'), { logLevel: 'silent' });
if (profile.errors.length) throw new Error('CURRENT_ROUTE_UNAVAILABLE');
const routes = [];
function collect(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.provider === 'string' && typeof value.model === 'string') routes.push({ provider: value.provider, model: value.model, reasoningEffort: value.reasoningEffort });
  for (const nested of Object.values(value)) collect(nested);
}
collect(profile.toJS());
if (!routes.some(route => JSON.stringify(route) === JSON.stringify(model))) throw new Error('CURRENT_ROUTE_CHANGED');

const id = `phase1-probe-real-${randomUUID()}`, taskId = randomUUID();
const receipts = [randomUUID(), randomUUID(), randomUUID()], steps = [];
const stats = { reasoningBlocks: 0, replayEnvelopes: 0, toolBlocks: 0 };
const report = { schemaVersion: 1, stage: '1A', probe: 'P1-P02', kind: 'real-model-real-dsh-fictional-operations',
  at: new Date().toISOString(), model, serverAccess: false, realPlatformAccess: false, privateHistoryUsed: false,
  checks: [], finishes: [], calls: [], passed: false };
let host, handle;
const bind = ctx => {
  installProbeProjection(ctx, id, stats);
  ctx.on('llm/stream', async function* (options, next) {
    if (options.sessionId !== id) { yield* next(); return; }
    for await (const chunk of next()) {
      if (chunk.type === 'finish') report.finishes.push({ kind: chunk.reason.kind,
        ...('failure' in chunk.reason ? { code: /^[A-Z0-9_.-]{1,80}$/.test(chunk.reason.failure.code ?? '') ? chunk.reason.failure.code : 'PROVIDER_FAILED' } : {}) });
      yield chunk;
    }
  });
};
const step = (stage, proof) => {
  if (stage !== steps.length + 1 || proof !== (stage === 1 ? '' : receipts[stage - 2])) throw new Error('PROBE_TOOL_SEQUENCE');
  steps.push(stage); return receipts[stage - 1];
};
const safeClose = async () => {
  if (handle) { await handle.dispose(); handle = undefined; }
  if (host) { report.calls.push(...host.calls.map(({ sessionId: _id, at: _at, ...call }) => call)); await host.close(); host = undefined; }
};
try {
  host = await localHost(root, { simulator: false, realModel: true, timeline: true, timeout: 240000 });
  const info = await host.ctx.llm.resolveModelInfo(model.provider, model.model);
  report.modelCapabilities = { id: info.id, inputModalities: info.inputModalities ?? null, contextWindow: info.contextWindow ?? null };
  bind(host.ctx);
  handle = await createProbeAgent(host.ctx, model, id, step);
  const result = await runProbeTurn(host.ctx, handle, probeInput(taskId, randomUUID(),
    '这是一个虚构的本地适配任务。必须顺序实际调用phase1_probe_step两次：先stage=1且proof为空字符串；取得receipt后，调用stage=2且proof为第一次的receipt。最后只输出第二次工具返回的receipt，不要猜测。'), 240000);
  report.checks.push({ name: 'two-tool-steps', passed: steps.join(',') === '1,2' && result.text.trim() === receipts[1] });
  report.checks.push({ name: 'no-private-model-state-live', passed: !containsPrivateModelState(handle.agent.session.snapshotEvents()) });
  await safeClose();

  host = await localHost(root, { simulator: false, realModel: true, timeline: true, timeout: 240000 }); bind(host.ctx);
  handle = await createProbeAgent(host.ctx, model, id, step, true);
  const resumed = await runProbeTurn(host.ctx, handle, probeInput(taskId, randomUUID(),
    '继续本机验收。请从本会话已保存的工具结果取得第二步receipt，实际调用phase1_probe_step，stage=3，proof填写第二步receipt。最后只输出第三步返回的receipt。'), 240000);
  report.checks.push({ name: 'restart-and-tool-continuation', passed: steps.join(',') === '1,2,3' && resumed.text.trim() === receipts[2] });
  report.checks.push({ name: 'no-private-model-state-resumed', passed: !containsPrivateModelState(handle.agent.session.snapshotEvents()) });
} catch (error) {
  report.error = typeof error?.message === 'string' && /^PROBE_[A-Z_]+$/.test(error.message) ? error.message : 'PROBE_RUNTIME_FAILED';
} finally {
  try { await safeClose(); } catch { report.error = 'PROBE_CLOSE_OR_CREDENTIAL_INTEGRITY_FAILED'; }
  let diskClean = true, files = 0;
  for (const file of await readdir(join(root, 'sessions'), { recursive: true }).catch(() => [])) {
    if (!file.endsWith('.jsonl')) continue;
    files++;
    for (const line of (await readFile(join(root, 'sessions', file), 'utf8')).split('\n').filter(Boolean)) {
      try { if (containsPrivateModelState(JSON.parse(line))) diskClean = false; } catch { diskClean = false; }
    }
  }
  report.checks.push({ name: 'no-private-model-state-on-disk', passed: files > 0 && diskClean, files });
  report.streamProjection = stats;
  report.toolSteps = steps;
  report.passed = !report.error && report.checks.length === 5 && report.checks.every(check => check.passed)
    && report.calls.length > 0 && report.calls.every(call => call.status === 'completed');
  report.finishedAt = new Date().toISOString();
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await mkdir(resolve('docs/results'), { recursive: true });
  await writeFile(resolve('docs/results/phase1a-runtime.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ probe: report.probe, passed: report.passed, capabilities: report.modelCapabilities,
    checks: report.checks, calls: report.calls.length, projection: stats, error: report.error ?? null }));
  if (!report.passed) process.exitCode = 1;
}
