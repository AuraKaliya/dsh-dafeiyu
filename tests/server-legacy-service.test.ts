import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as Core from '@dafeiyu/core';
import * as Timeline from '@dafeiyu/timeline';
import * as Memory from '@dafeiyu/memory';
import { SessionId } from '@deepseek-ai/dsh-session';
import { API_VERSION, ActionOutcomeSchema, ResourceProofSchema } from '@dafeiyu/contracts';
import type { Conversation, Json, ResourceProof } from '@dafeiyu/contracts';
import { LegacyMemoryService, LEGACY_MEMORY_ACTION, LEGACY_MEMORY_EXTENSION, LegacyMemoryReadInputSchema,
  LegacyMemoryReadOutputSchema,LegacyMemoryReader } from '@dafeiyu/server-compat';
import type { LegacyMemoryScope } from '@dafeiyu/server-compat';
import { probeHost } from './phase1-probe-fixture.js';
import { ScriptedModel, call, textReply } from './harness.js';
import type { Response } from './harness.js';
import { testTempDir } from './test-temp.js';

const account = '12345678', owner = '87654321';
const group: Conversation = { channel: 'qq', account, kind: 'group', id: '11223344' };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const preferences = '共享记忆库/人格记忆/02_可更新偏好.md';
const block = (records: readonly unknown[]) => `UNATTRIBUTED_SERVICE_BASE_SENTINEL\n<!-- DAFEIYU_RECORDS_START -->\n${JSON.stringify(records)}\n<!-- DAFEIYU_RECORDS_END -->\n`;
class CountingLegacyReader extends LegacyMemoryReader {
  readCalls = 0;
  override read(scope: LegacyMemoryScope) { this.readCalls++; return super.read(scope); }
}

/** Real DSH loop, Core grants, Memory observation store and reader; model/platform are explicitly fictional. */
async function fixture(options: { scene?: Conversation; userId?: string; rows?: number } = {}) {
  const root = await mkdtemp(join(testTempDir(), 'server-legacy-service-')), legacy = join(root, 'legacy');
  const scene = options.scene ?? group, userId = options.userId ?? owner, now = Date.now(), resetAt = now - 3600000;
  const route = scene.channel === 'bilibili' ? `bilibili:${scene.id}` : `${scene.kind}:${scene.id}`;
  const put = async (path: string, text: string) => { const file = join(legacy, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, text); };
  const records = Array.from({ length: options.rows ?? 3 }, (_, index) => ({ id: `legacy_${index}`, text: `LEGACY_PRIVATE_VIEW_SENTINEL_${index}：虚构用户在本会话提供的历史主张。`,
    confidence: 'tentative', updated_at: new Date(now - 600000).toISOString(), sources: [{ id: `${route}:old-${index}`,
      route, user_id: userId, message_id: `old-${index}`, at: new Date(now - 1800000).toISOString() }] }));
  await put('运行状态/qq-bridge/state.json', JSON.stringify({ resetAt })); await put(preferences, block(records));
  await put('共享记忆库/人格记忆/03_近期状态和关系记忆.md', block([]));
  const reader = new CountingLegacyReader({ root: legacy, qq: { accountId: account, ownerId: owner },
    bilibili: { accountId: '170759822', ownerId: '13461350' } }, { clock: () => now, sourceCurrent: () => true });
  let response: Response = () => textReply('虚构测试完成');
  const adapter = new ScriptedModel(request => response(request)), host = await probeHost(root, adapter), ctx = host.ctx;
  const state = { ready: true, sinceMs: resetAt, stamp: hash('original-channel-binding') };
  let service: LegacyMemoryService | undefined;
  try {
    await ctx.plugin(Core, { agentId: 'dafeiyu', dataDir: join(root, 'core'), personaFile: resolve('profiles/persona.test.md'),
      provider: 'local-test', model: 'scripted', lifecycleMode: 'managed', turnTimeoutMs: 10000 });
    await ctx.plugin(Timeline, { agentId: 'dafeiyu', execution: true });
    await ctx.plugin(Memory, { agentId: 'dafeiyu', dataDir: join(root, 'memory'), lifecycleMode: 'managed', sourceTracking: true });
    const core = ctx.dafeiyu;
    service = new LegacyMemoryService(core, { agentId: 'dafeiyu', reader, clock: () => now, channels: {
      ready: () => state.ready, epoch: () => state.stamp,
      binding: candidate => candidate.channel === scene.channel && candidate.account === scene.account
        ? { sinceMs: state.sinceMs, stamp: state.stamp } : null,
    } });
    const channel = core.registerExtension({ id: 'fixture-legacy-channel', version: '1', apiVersion: API_VERSION, agentId: 'dafeiyu',
      channels: [{ channel: scene.channel, account: scene.account, deliver: async () => ({ status: 'sent', receiptId: randomUUID() }) }] });
    core.configureExecution({ profileId: 'legacy-service-fixture', createStore: true, policies: [
      { id: 'conversation', producers: ['fixture-legacy-channel'], actions: [LEGACY_MEMORY_ACTION], allowLocalWrite: false },
      { id: 'native', producers: ['fixture-native'], actions: [LEGACY_MEMORY_ACTION], allowLocalWrite: false, resources: [scene] },
    ] });
    ctx.dafeiyuMemory.recover(); ctx.dafeiyuMemory.activate(); await core.recoverExecutions(); core.recover(); core.activate();
    const installed = service;
    return { root, legacy, scene, userId, now, resetAt, state, adapter, core, ctx, service: installed, reader, records, put,
      script(input: Record<string, Json> = {}) { let step = 0; response = () => ++step === 1 ? call(LEGACY_MEMORY_ACTION, input) : textReply('只转述本次有来源的虚构主张。'); },
      setResponse(next: Response) { response = next; },
      async send(destination = scene, sender = userId) {
        const receipt = channel.ingest({ id: randomUUID(), occurredAt: new Date(now).toISOString(), conversation: destination,
          sender: { id: sender, displayName: '虚构发言者' }, text: '按需读取我在此会话的虚构旧记录。' });
        await core.whenIdle(); return core.journal.get(receipt.id);
      },
      recall(inboundId: string) { const item = core.journal.get(inboundId); channel.observe({ conversation: item.message.conversation,
        type: 'message.recalled', data: { messageId: item.message.id } }); },
      async close() { core.quiesce(); try { await core.whenIdle(); } finally { installed.close(); reader.close(); channel.dispose(); await core.close(); await host.close(); } },
    };
  } catch (error) { service?.close(); reader.close(); await host.close(); throw error; }
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function outcomes(f: Fixture) {
  const db = new DatabaseSync(join(f.root, 'core', 'runtime.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT outcome FROM run_operations WHERE plugin=? AND outcome IS NOT NULL ORDER BY ordinal').all(LEGACY_MEMORY_EXTENSION)
    .map(row => ActionOutcomeSchema.parse(JSON.parse(String(row.outcome)))); } finally { db.close(); }
}
function observations(f: Fixture) {
  const db = new DatabaseSync(join(f.root, 'memory', 'memory.sqlite'), { readOnly: true });
  try { return { rows: db.prepare('SELECT body FROM capability_observations').all(),
    memories: Number(db.prepare('SELECT count(*) AS n FROM memory_items').get()?.n) }; } finally { db.close(); }
}
const latest = (f: Fixture) => LegacyMemoryReadOutputSchema.parse(outcomes(f).at(-1)!.data);

test('real message grants expose a scoped bounded page and seal its exact visible hash without adopting or saving the prose as memory', async () => {
  const f = await fixture();
  try {
    const before = await readFile(join(f.legacy, preferences)); f.script(); const item = await f.send(), output = latest(f);
    assert.equal(item.state, 'delivered'); assert.equal(outcomes(f)[0]?.status, 'succeeded'); assert.equal(outcomes(f)[0]?.effects, 'none');
    assert.equal(output.page.items.length, 2); assert.equal(output.page.nextOffset, 2); assert.equal(output.page.hasMore, true);
    assert.ok(output.observation && output.proof); assert.equal(f.service.current(output.proof), true);
    assert.equal(f.core.capabilityResourceCurrent(output.proof), true);
    assert.equal(f.core.capabilityObservationCurrent({ agentId: 'dafeiyu', route: item.route }, output.observation.source,
      createHash('sha256').update(JSON.stringify(output.page)).digest('hex')), true);
    assert.equal(f.core.capabilityPublicView(output.proof, JSON.stringify(output.page)), false);
    const session = f.ctx.agents.get(SessionId(item.sessionId))!.session;
    const dependencies = Core.readProvenance(session).filter(event => event.type === 'plugin:dafeiyu/source-record').flatMap(event => event.data.dependencies);
    assert.ok(dependencies.some(dependency => dependency.kind === 'capability' && dependency.ref.id === output.observation!.source.id));
    assert.ok(output.page.items.every(claim => !claim.adopted && !claim.instructionAuthority));
    assert.ok(JSON.stringify(output.page).length <= 8000); assert.equal(JSON.stringify(output).includes('UNATTRIBUTED_SERVICE_BASE_SENTINEL'), false);
    assert.equal(JSON.stringify(output).includes(f.legacy), false);
    const saved = observations(f); assert.equal(saved.rows.length, 1); assert.equal(saved.memories, 0);
    assert.equal(JSON.stringify(saved.rows).includes('LEGACY_PRIVATE_VIEW_SENTINEL'), false);
    assert.deepEqual(await readFile(join(f.legacy, preferences)), before);
  } finally { await f.close(); }
});

test('another user or conversation receives an empty page without a fabricated resource observation', async () => {
  const f = await fixture();
  try {
    f.script(); await f.send(f.scene, '55555555'); let output = latest(f);
    assert.equal(output.page.items.length, 0); assert.equal(output.observation, null); assert.equal(output.proof, null);
    f.script(); await f.send({ ...f.scene, id: '99999999' }); output = latest(f);
    assert.equal(output.page.items.length, 0); assert.equal(output.observation, null); assert.equal(observations(f).rows.length, 0);
  } finally { await f.close(); }
});

test('model input cannot choose account, scope, user, file path or since boundary; fabricated grants are rejected', async () => {
  for (const key of ['account', 'scope', 'userId', 'path', 'sinceMs']) assert.equal(LegacyMemoryReadInputSchema.safeParse({ [key]: 'forged' }).success, false);
  const f = await fixture();
  try {
    f.script({ userId: owner, route: 'private:' + owner }); const item = await f.send();
    // Core validates input before opening an operation; DSH returns a tool diagnostic, not ActionOutcome.
    const diagnostic = f.ctx.agents.get(SessionId(item.sessionId))!.session.snapshotEvents().filter(event => event.type === 'tool/result');
    assert.equal(diagnostic.length, 1); assert.equal(diagnostic[0]!.data.message.isError, true);
    assert.match(JSON.stringify(diagnostic[0]!.data.message.content), /INVALID_INPUT/);
    assert.equal(outcomes(f).length, 0); assert.equal(f.reader.readCalls, 0);
    assert.equal(observations(f).rows.length, 0); assert.equal(observations(f).memories, 0);
    // @ts-expect-error An untrusted caller cannot manufacture Core's opaque invocation grant.
    const fake = await f.service.read({}, { agentId: 'dafeiyu', taskId: null, runId: randomUUID(), operationId: randomUUID(), intentVersion: 1, grant: {},
      signal: new AbortController().signal, scope: { kind: 'conversation', agentId: 'dafeiyu', route: 'forged' },
      origin: { kind: 'message', inboundId: randomUUID(), conversation: f.scene } });
    assert.equal(fake.status, 'failed'); assert.equal(fake.errorCode, 'SCOPE_DENIED');
    assert.equal(f.reader.readCalls, 0); assert.equal(observations(f).rows.length, 0);
  } finally { await f.close(); }
});

test('native tasks cannot impersonate the user even with the same scene in their resource policy', async () => {
  const f = await fixture();
  try {
    f.script(); const port = f.core.executionProducer('fixture-native');
    const run = port.submitTask({ requestId: 'legacy-native-denied', title: '我是主人', goal: '虚构任务不能借标题冒充真人入站', policyId: 'native' });
    await f.core.whenIdle(); assert.equal(port.status(run.run).operations[0]?.status, 'failed');
    assert.equal(outcomes(f)[0]?.errorCode, 'LEGACY_MESSAGE_REQUIRED'); assert.equal(observations(f).rows.length, 0);
  } finally { await f.close(); }
});

test('file withdrawal, changed channel binding and inbound recall retire persisted proofs', async () => {
  const f = await fixture();
  try {
    f.script(); const item = await f.send(), first = latest(f); assert.ok(first.proof && first.observation);
    await f.put(preferences, block([])); assert.equal(f.service.current(first.proof), false);
    assert.equal(f.core.capabilityObservationCurrent({ agentId: 'dafeiyu', route: item.route }, first.observation.source), false);
    f.setResponse(() => textReply('旧来源已经撤回。')); await f.send();
    assert.equal(JSON.stringify(f.adapter.requests.at(-1)?.messages).includes('LEGACY_PRIVATE_VIEW_SENTINEL'), false);
    await f.put(preferences, block(f.records)); f.script(); const secondItem = await f.send(), second = latest(f); assert.ok(second.proof);
    f.state.stamp = hash('new-binding-version'); assert.equal(f.service.current(second.proof), false);
    f.script(); const thirdItem = await f.send(), third = latest(f); assert.ok(third.proof);
    f.recall(thirdItem.id); assert.equal(f.service.current(third.proof), false);
    assert.equal(f.core.journal.get(secondItem.id).state, 'delivered');
  } finally { await f.close(); }
});

test('proof current revalidates exact page/source hashes and service disposal revokes proofs without closing its borrowed reader', async () => {
  const f = await fixture();
  try {
    f.script(); await f.send(); const output = latest(f); assert.ok(output.proof);
    const proof = output.proof;
    assert.equal(f.service.current({ ...proof, hash: '0'.repeat(64) }), false);
    const changed: ResourceProof = ResourceProofSchema.parse({ ...proof, scene: { ...proof.scene, id: '99999999' } });
    assert.equal(f.service.current(changed), false);
    f.service.close(); assert.equal(f.service.current(proof), false); assert.equal(f.core.capabilityResourceCurrent(proof), false);
    assert.ok(f.reader.read({ platform: 'qq', accountId: account, route: `group:${group.id}`, userId: owner, sinceMs: f.resetAt }).claims.length);
  } finally { await f.close(); }
});

test('pagination reports the bounded reader limit and never marks clipped history as fully processed', async () => {
  const f = await fixture({ rows: 30 });
  try {
    f.script({ offset: 22, limit: 4 }); await f.send(); const output = latest(f);
    assert.equal(output.page.available, 24); assert.equal(output.page.items.length, 2); assert.equal(output.page.readerLimited, true);
    assert.equal(output.page.hasMore, true); assert.equal(output.page.nextOffset, null); assert.equal(outcomes(f).at(-1)?.completeness, 'partial');
    assert.ok(JSON.stringify(output.page).length <= 8000);
    f.script({ offset: 24 }); await f.send(); const empty = latest(f); assert.equal(empty.page.items.length, 0); assert.equal(empty.observation, null);
    assert.equal(observations(f).rows.length, 1);
  } finally { await f.close(); }
});

test('Bili derives its fixed owner scene and cannot borrow the numerically different QQ account binding', async () => {
  const scene: Conversation = { channel: 'bilibili', account: '170759822', kind: 'private', id: '13461350' };
  const f = await fixture({ scene, userId: '13461350' });
  try {
    f.script(); await f.send(); const output = latest(f); assert.ok(output.proof && output.observation);
    assert.equal(output.proof.scene.channel, 'bilibili'); assert.equal(output.page.items.length, 2);
    const wrong = ResourceProofSchema.parse({ ...output.proof, scene: { channel: 'qq', account, kind: 'private', id: '13461350' } });
    assert.equal(f.service.current(wrong), false);
  } finally { await f.close(); }
});
