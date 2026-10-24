import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { StreamChunk } from '@deepseek-ai/dsh-llm';
import { call, ScriptedModel, textReply } from './harness.js';
import { containsPrivateModelState, countToolResults, createProbeAgent, installProbeProjection,
  probeHost, probeInput, runProbeTurn, visibleProbeStream } from './phase1-probe-fixture.js';

const route = { provider: 'local-test', model: 'scripted' };
const stats = () => ({ reasoningBlocks: 0, replayEnvelopes: 0, toolBlocks: 0 });
const directory = () => mkdtemp(join(tmpdir(), 'dafeiyu-phase1-probe-'));
async function* chunks(values: readonly StreamChunk[]) { yield* values; }

test('P1-P01 native producer source survives DSH persistence, cold query, replacement and resume', async () => {
  const root = await directory(), id = `phase1-probe-${randomUUID()}`, taskId = randomUUID(), runId = randomUUID();
  let h = await probeHost(root, new ScriptedModel(() => textReply('虚构原生任务完成')));
  let handle = await createProbeAgent(h.ctx, route, id);
  let originalSeq;
  try {
    await runProbeTurn(h.ctx, handle, probeInput(taskId, runId, '虚构材料PROBE_SOURCE_ORIGINAL_817'));
    const original = handle.agent.session.snapshotEvents().find(e => e.type === 'user/message' && e.data.source.kind === 'dafeiyu-execution-probe');
    assert.ok(original && original.type === 'user/message'); originalSeq = original.seq;
    assert.equal(original.data.source.kind, 'dafeiyu-execution-probe');
    handle.agent.session.append('user/message', createUserMessage({ source: { kind: 'dafeiyu-execution-probe', form: 'notice',
      summary: '虚构压缩替代视图', taskId, runId, inputId: randomUUID(), originKind: 'native' },
      content: [{ type: 'text', text: 'PROBE_SUMMARY_VIEW_817' }] }),
    { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] });
    assert.ok(await h.ctx.sessions.flush(handle.agent.session));
  } finally { await handle.dispose(); await h.close(); }
  assert.ok(originalSeq);
  h = await probeHost(root, new ScriptedModel(() => textReply('重启继续完成')));
  try {
    const { SessionId } = await import('@deepseek-ai/dsh-session');
    const cold = await h.ctx.sessionQuery.readEvent({ sessionId: SessionId(id), seq: originalSeq });
    assert.equal(cold.target.type, 'user/message');
    if (cold.target.type !== 'user/message') throw new Error('Wrong probe event');
    assert.equal(cold.target.data.source.kind, 'dafeiyu-execution-probe');
    assert.match(JSON.stringify(cold.target.data), /PROBE_SOURCE_ORIGINAL_817/);
    const trace = await h.ctx.sessionQuery.traceEvent({ sessionId: SessionId(id), seq: originalSeq });
    assert.ok(trace.replacementChain.length > 0);
    const surface = await h.ctx.sessionQuery.readSurface(SessionId(id));
    assert.ok(!JSON.stringify(surface.events).includes('PROBE_SOURCE_ORIGINAL_817'));
    assert.match(JSON.stringify(surface.events), /PROBE_SUMMARY_VIEW_817/);
    handle = await createProbeAgent(h.ctx, route, id, undefined, true);
    try { await runProbeTurn(h.ctx, handle, probeInput(taskId, randomUUID(), '继续本地原生任务')); }
    finally { await handle.dispose(); }
  } finally { await h.close(); }
});

test('P1-P02 visible projection keeps interleaved tool calls and excludes reasoning and replay', async () => {
  const counters = stats(), id = ToolCallId('fictional-probe-call');
  const output: StreamChunk[] = [];
  for await (const chunk of visibleProbeStream(chunks([
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'PRIVATE_PROBE_SENTINEL' },
    { type: 'block-start', index: 4, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 4, id, name: 'phase1_probe_step', argumentsDelta: '{"stage":1,"proof":""}' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'PRIVATE_PROBE_SENTINEL' } },
    { type: 'block-end', index: 4, block: { type: 'tool-call', id, name: 'phase1_probe_step', arguments: '{"stage":1,"proof":""}' } },
    { type: 'finish', reason: { kind: 'tool-calls' }, replayState: { response: { secret: 'PRIVATE_REPLAY_SENTINEL' }, blocks: [] } },
  ]), counters)) output.push(chunk);
  assert.equal(counters.reasoningBlocks, 1); assert.equal(counters.replayEnvelopes, 1);
  assert.ok(!containsPrivateModelState(output)); assert.ok(!JSON.stringify(output).includes('PRIVATE_'));
  assert.ok(output.filter(c => 'index' in c).every(c => 'index' in c && c.index === 0));
  assert.equal(output.at(-1)?.type, 'finish');
});

test('P1-P02 real DSH multi-step tool execution persists only visible content under scripted reasoning', async () => {
  const root = await directory(), id = `phase1-probe-${randomUUID()}`, counters = stats(), steps: number[] = [];
  const model = new ScriptedModel(request => {
    const stage = countToolResults(request) + 1;
    const visible = stage <= 2 ? call('phase1_probe_step', { stage, proof: stage === 1 ? '' : 'receipt-1' }) : textReply('receipt-2');
    return [ { type: 'block-start', index: 9, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 9, text: 'PRIVATE_DSH_PROBE_SENTINEL' },
      { type: 'block-end', index: 9, block: { type: 'reasoning', text: 'PRIVATE_DSH_PROBE_SENTINEL' } },
      ...visible.map(c => c.type === 'finish' ? { ...c, replayState: { response: { signature: 'PRIVATE_REPLAY_SENTINEL' } } } : c) ];
  });
  const h = await probeHost(root, model); installProbeProjection(h.ctx, id, counters);
  const handle = await createProbeAgent(h.ctx, route, id, (stage, proof) => {
    assert.equal(stage, steps.length + 1); assert.equal(proof, stage === 1 ? '' : 'receipt-1'); steps.push(stage); return `receipt-${stage}`;
  });
  try {
    const result = await runProbeTurn(h.ctx, handle, probeInput(randomUUID(), randomUUID(), '执行两步虚构操作'));
    assert.equal(result.text, 'receipt-2'); assert.deepEqual(steps, [1, 2]);
    assert.equal(counters.reasoningBlocks, 3); assert.equal(counters.replayEnvelopes, 3);
    assert.ok(!containsPrivateModelState(handle.agent.session.snapshotEvents()));
  } finally { await handle.dispose(); await h.close(); }
  for (const file of await readdir(join(root, 'sessions'), { recursive: true })) {
    if (!file.endsWith('.jsonl')) continue;
    const content = await readFile(join(root, 'sessions', file), 'utf8');
    assert.ok(!content.includes('PRIVATE_DSH_PROBE_SENTINEL')); assert.ok(!content.includes('PRIVATE_REPLAY_SENTINEL'));
  }
});

test('probe projection rejects malformed visible deltas without leaking provider errors', async () => {
  await assert.rejects(async () => { for await (const _ of visibleProbeStream(chunks([
    { type: 'text-delta', index: 1, text: 'fixture' },
  ]), stats())) { /* consume */ } }, /PROBE_INVALID_STREAM/);
  const output: StreamChunk[] = [];
  for await (const chunk of visibleProbeStream(chunks([{ type: 'finish', reason: { kind: 'error', failure: { code: 'FIXTURE_ERROR', message: 'PRIVATE_ERROR_SENTINEL' } } }]), stats())) output.push(chunk);
  assert.ok(!JSON.stringify(output).includes('PRIVATE_ERROR_SENTINEL'));
});
