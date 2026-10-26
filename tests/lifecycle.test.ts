import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import Query from '@deepseek-ai/dsh-session-query-sqlite';
import * as Timeline from '@dafeiyu/timeline';
import * as Memory from '@dafeiyu/memory';
import * as QQ from '@dafeiyu/qq';
import { Journal, eventFor } from '@dafeiyu/journal';
import { API_VERSION, MessageSchema, ServiceGate, dependencyOrder, HostConfigSchema, ExecutionScopeSchema, taskScopeKey } from '@dafeiyu/contracts';
import type { ExtensionV3 } from '@dafeiyu/contracts';
import { CapabilityRegistryV3 } from '../packages/core/lib/registry-v3.js';
import { AnalysisStore } from '../packages/memory/lib/analysis-store.js';
import type { AnalysisJob } from '../packages/memory/lib/analysis-types.js';
import { harness, textReply } from './harness.js';

const rootDirectory = () => mkdtemp(join(tmpdir(), 'dafeiyu-managed-'));
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const message = () => MessageSchema.parse({ id: 'pending-fixture', occurredAt: '2026-10-24T08:00:00+08:00',
  conversation: { channel: 'simulator', account: 'local', kind: 'local', id: 'fixture' }, sender: { id: 'fictional-user', displayName: '虚构用户' }, text: '本地虚构输入' });
const managed = (root: string) => harness(root, undefined, undefined, 5000, undefined, undefined, 'managed');
const extension = (id = 'fixture-v3'): ExtensionV3 => ({ protocolVersion: 3, id, version: 'fixture', agentId: 'dafeiyu',
  actions: [{ id: 'v3_fixture_action', version: '1', description: '虚构本地能力', effects: 'read', requiresTask: true,
    inputSchema: z.strictObject({ text: z.string().max(100) }), outputSchema: z.strictObject({ text: z.string() }),
    execute: async input => ({ status: 'succeeded', effects: 'none', completeness: 'complete', data: input, sources: [], receipts: [] }) }] });

test('managed lifecycle rejects work before recovery and cannot reactivate after quiescing', () => {
  const gate = new ServiceGate(); assert.throws(() => gate.assertActive(), /HOST_NOT_READY/);
  assert.throws(() => gate.activate(), /SERVICE_NOT_RECOVERED/);
  gate.recovered(); gate.activate(); gate.activate(); assert.equal(gate.active, true);
  gate.quiesce(); assert.throws(() => gate.activate(), /SERVICE_NOT_RECOVERED/);
  gate.close(); gate.close(); assert.equal(gate.state, 'closed');
});

test('dependency graph detects missing providers, duplicates and cycles with deterministic order', () => {
  assert.deepEqual(dependencyOrder([{ id: 'memory', provides: ['memory'], requires: ['core'] }, { id: 'core', provides: ['core'], requires: [] }]), ['core', 'memory']);
  assert.throws(() => dependencyOrder([{ id: 'a', provides: [], requires: ['missing'] }]), /DEPENDENCY_UNAVAILABLE/);
  assert.throws(() => dependencyOrder([{ id: 'a', provides: ['x'], requires: ['y'] }, { id: 'b', provides: ['y'], requires: ['x'] }]), /DEPENDENCY_CYCLE/);
  assert.throws(() => dependencyOrder([{ id: 'a', provides: ['x'], requires: [] }, { id: 'b', provides: ['x'], requires: [] }]), /DUPLICATE_FEATURE/);
});

test('host config is strict, keeps optional probe routes independent and contains no call-count budget', () => {
  const input = { schemaVersion: 1, profileId: 'fixture', agent: { id: 'dafeiyu' },
    paths: { core: './core', memory: './memory', sessions: './sessions', query: './query.sqlite' },
    modelRoutes: { chat: { provider: 'local-test', model: 'scripted' }, probes: { vision: { provider: 'local-test', model: 'image-fixture' } } },
    persona: { fixedFile: './persona.md', kind: 'test' }, plugins: [] };
  const result = HostConfigSchema.parse(input); assert.equal(result.runtime.maxConcurrentRuns, 2); assert.equal(result.runtime.maxPendingRuns, 100);
  assert.equal(result.context.outputReserveBytes,16000);assert.deepEqual(result.context.regions,{});
  assert.equal(result.modelRoutes.probes?.asr, undefined);
  assert.equal(HostConfigSchema.safeParse({ ...input, maxCallsPerTurn: 12 }).success, false);
  assert.equal(HostConfigSchema.safeParse({ ...input, plugins: [{ id: 'same' }, { id: 'same' }] }).success, false);
  const id = randomUUID(); assert.equal(ExecutionScopeSchema.safeParse({ kind: 'task', agentId: 'dafeiyu', taskId: id, scopeKey: taskScopeKey('dafeiyu', id) }).success, true);
  assert.equal(ExecutionScopeSchema.safeParse({ kind: 'task', agentId: 'dafeiyu', taskId: 'bad', scopeKey: 'bad' }).success, false);
});

test('v3 registration snapshots metadata, enforces strict schemas and revokes disposed instances', () => {
  const registry = new CapabilityRegistryV3(), reserved = { ids: [], actions: [], channels: [] };
  const spec = extension(), handle = registry.register('dafeiyu', spec, reserved), action = registry.actions()[0]; assert.ok(action);
  assert.equal(Object.isFrozen(action.input), true); assert.equal(Object.isFrozen(action.input.properties), true);
  assert.throws(() => registry.register('dafeiyu', extension('other-v3'), reserved), /DUPLICATE_ACTION/);
  handle.dispose(); assert.equal(action.active(), false); assert.deepEqual(registry.ids(), []);
  const first = spec.actions?.[0]; assert.ok(first);
  assert.throws(() => registry.register('dafeiyu', { ...spec, actions: [{ ...first, inputSchema: z.object({ text: z.string() }) }] }, reserved), /V3_SCHEMA_MUST_BE_STRICT/);
  assert.deepEqual(registry.ids(), []);
});

test('core v2 and v3 share names while legacy API_VERSION stays two', async t => {
  const h = await managed(await rootDirectory()); t.after(h.close);
  assert.equal(API_VERSION, 2); const handle = h.core.registerExtensionV3(extension());
  assert.throws(() => h.core.registerExtension({ id: 'fixture-v3', version: 'fixture', apiVersion: 2, agentId: 'dafeiyu' }), /Duplicate extension/);
  assert.throws(() => h.core.registerExtension({ id: 'other', version: 'fixture', apiVersion: 2, agentId: 'dafeiyu', actions: [{ name: 'v3_fixture_action', description: 'fixture', fields: {}, execute: async () => null }] }), /Duplicate or invalid action/);
  handle.dispose(); const legacy = h.core.registerExtension({ id: 'fixture-v3', version: 'fixture', apiVersion: 2, agentId: 'dafeiyu' }); legacy.dispose();
});

test('managed core rejects ingress without persistence and drains existing accepted message only after activation', async t => {
  const root = await rootDirectory(), journal = new Journal(join(root, 'journal.sqlite'));
  const receipt = journal.accept('dafeiyu', 'channel-simulator', 'fixture', message()); journal.close();
  const h = await managed(root); t.after(h.close);
  await tick(); assert.equal(h.adapter.requests.length, 0); assert.equal(h.core.journal.get(receipt.id).state, 'accepted');
  assert.throws(() => h.simulator.send('fixture', '不能提前受理', { id: 'too-early' }), /HOST_NOT_READY/);
  assert.equal(h.core.journal.list().length, 1);
  h.core.recover(); await tick(); assert.equal(h.adapter.requests.length, 0);
  h.core.activate(); await h.core.whenIdle(); assert.equal(h.core.journal.get(receipt.id).state, 'delivered');
  h.core.activate(); await h.core.whenIdle(); assert.equal(h.adapter.requests.length, 1);
});

test('managed construction does not recover interrupted legacy processing until explicit recovery', async t => {
  const root = await rootDirectory(), journal = new Journal(join(root, 'journal.sqlite'));
  const receipt = journal.accept('dafeiyu', 'channel-simulator', 'fixture', message()), item = journal.get(receipt.id);
  journal.transition(item.id, 'accepted', 'processing', eventFor('dafeiyu', item, 'turn.started', 'core', 'fixture')); journal.close();
  const h = await managed(root); t.after(h.close);
  assert.equal(h.core.journal.get(receipt.id).state, 'processing'); h.core.recover();
  assert.equal(h.core.journal.get(receipt.id).state, 'uncertain'); h.core.activate(); await h.core.whenIdle();
  assert.equal(h.adapter.requests.length, 0); assert.equal(h.simulator.deliveries.length, 0);
});

test('managed memory recovery and analysis worker wait for their own activation and core readiness', async t => {
  const root = await rootDirectory(), memoryRoot = join(root, 'memory'), source = message();
  const queue = new AnalysisStore(join(memoryRoot, 'analysis.sqlite'));
  const id = randomUUID(), at = new Date().toISOString(), scope = { agentId: 'dafeiyu', route: JSON.stringify(['dafeiyu','simulator','local','local','fixture']), traceId: randomUUID(), operationId: randomUUID(), startedEventId: randomUUID() };
  const job: AnalysisJob = { id, requestId: 'fixture-analysis', fingerprint: 'a'.repeat(64), grantId: randomUUID(), agentId: 'dafeiyu', route: scope.route, authority: scope,
    model: { provider: 'local-test', model: 'scripted' }, inputGeneration: 0, generation: 0, state: 'running',
    sources: [{ sourceId: 'S1', text: source.text, origin: 'user', authorId: 'fictional', evidence: { kind: 'timeline', ref: 'fictional-source', contentHash: 'a'.repeat(64) } }],
    targets: [], candidates: [], createdAt: at, updatedAt: at, attempts: 1 };
  queue.insert(job); queue.close();
  const h = await managed(join(root, 'core'));
  const query = await h.ctx.plugin(Query, { path: join(root, 'query.sqlite'), openAt: 'never' });
  const timeline = await h.ctx.plugin(Timeline, { agentId: 'dafeiyu' });
  const memory = await h.ctx.plugin(Memory, { agentId: 'dafeiyu', dataDir: memoryRoot, lifecycleMode: 'managed', analysis: {} });
  t.after(async () => { h.core.quiesce(); await h.core.whenIdle(); await memory.dispose(); await timeline.dispose(); await query.dispose(); await h.close(); });
  const readState = () => { const db = new DatabaseSync(join(memoryRoot, 'analysis.sqlite'), { readOnly: true }); try { return db.prepare('SELECT state FROM jobs WHERE id=?').get(id)?.state; } finally { db.close(); } };
  assert.equal(readState(), 'running'); h.core.recover();
  assert.throws(() => h.core.activate(), /DEPENDENCY_UNAVAILABLE/);
  h.ctx.dafeiyuMemory.recover(); assert.equal(readState(), 'queued');
  h.ctx.dafeiyuMemory.activate(); await tick(); assert.equal(readState(), 'queued'); assert.equal(h.adapter.requests.length, 0);
  h.core.activate(); await h.ctx.dafeiyuMemory.whenIdle();
  assert.equal(readState(), 'failed'); // Invalid fictional grant is evaluated only when the worker is allowed to run.
  assert.equal(h.adapter.requests.length, 0);
});

test('quiescing rejects new ingress while an already running conversation can finish', async t => {
  let release: (() => void) | undefined, entered: (() => void) | undefined;
  const started = new Promise<void>(resolve => { entered = resolve; }), ready = new Promise<void>(resolve => { release = resolve; });
  const h = await harness(await rootDirectory(), async () => { entered?.(); await ready; return textReply('已完成既有工作'); }); t.after(h.close);
  const receipt = h.simulator.send('fixture', '开始', { id: 'running' }); await started;
  h.core.quiesce(); assert.throws(() => h.simulator.send('fixture', '新工作', { id: 'late' }), /HOST_NOT_READY/);
  release?.(); await h.core.whenIdle(); assert.equal(h.core.journal.get(receipt.id).state, 'delivered');
  assert.equal(h.core.getStatus().state, 'draining');
});

test('a provider that becomes unavailable prevents new acceptance without a false storage failure', async t => {
  const h = await harness(await rootDirectory()); t.after(h.close); let ready = true;
  const provider = h.core.registerExtension({ id: 'readiness-fixture', version: 'fixture', apiVersion: 2, agentId: 'dafeiyu', lifecycleReady: () => ready });
  ready = false;
  assert.equal(h.core.getStatus().state, 'degraded');
  assert.throws(() => h.simulator.send('fixture', '不得提前受理', { id: 'not-accepted' }), /DEPENDENCY_UNAVAILABLE/);
  assert.equal(h.core.journal.list().length, 0);
  ready = true; const receipt = h.simulator.send('fixture', '恢复后受理', { id: 'accepted' });
  await h.core.whenIdle(); assert.equal(h.core.journal.get(receipt.id).state, 'delivered'); provider.dispose();
});

test('managed QQ connects only after explicit start and core readiness', async t => {
  const root = await rootDirectory(), token = 'fictional-managed-qq-token-12345678901234567890';
  const tokenFile = join(root, 'fixture.token'); await writeFile(tokenFile, token); let calls = 0;
  const server = createServer((req, res) => { calls++; res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', retcode: 0, data: req.url === '/get_login_info' ? { user_id: 1994142241 } : { online: true } })); });
  const ws = new WebSocketServer({ server }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture port missing');
  const h = await managed(join(root, 'core'));
  const qq = await h.ctx.plugin(QQ, { agentId: 'dafeiyu', botId: '1994142241', ownerId: '10000003', groupIds: [], tokenFile,
    dataDir: join(root, 'qq'), httpURL: `http://127.0.0.1:${address.port}/`, wsURL: `ws://127.0.0.1:${address.port}/`, lifecycleMode: 'managed' });
  t.after(async () => { await qq.dispose(); await h.close(); for (const client of ws.clients) client.terminate(); await new Promise<void>(resolve => ws.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve())); });
  await tick(); assert.equal(calls, 0); await assert.rejects(h.ctx.dafeiyuQQ.start(), /HOST_NOT_READY/);
  h.core.recover(); h.core.activate(); await h.ctx.dafeiyuQQ.start(); assert.equal(calls, 2);
  h.ctx.dafeiyuQQ.quiesce(); await assert.rejects(h.ctx.dafeiyuQQ.start(), /CHANNEL_STOPPING/);
});
