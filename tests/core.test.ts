import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness, textReply, call } from './harness.js';
import { conversationKey } from '@dafeiyu/contracts';
import type { Extension } from '@dafeiyu/contracts';

const directory = () => mkdtemp(join(tmpdir(), 'dafeiyu-test-'));
const echo: Extension = { id: 'test-actions', version: '0.1.0', apiVersion: 1, agentId: 'dafeiyu', actions: [{
  name: 'test_echo', description: '回显测试文本', fields: { text: { description: '文本', required: true } },
  execute: async (args) => ({ text: args.text ?? '' }),
}] };

test('real DSH loop composes persona and delivers back to the same conversation', async t => {
  const h = await harness(await directory(), () => textReply('你好，我是大肥鱼。'));
  t.after(h.close);
  const receipt = h.simulator.send('room-a', '你好', { id: '1' });
  assert.equal(receipt.state, 'accepted');
  assert.equal(h.simulator.deliveries.length, 0);
  await h.core.whenIdle();
  assert.equal(h.core.journal.get(receipt.id).state, 'delivered');
  assert.equal(h.simulator.deliveries[0]?.conversation.id, 'room-a');
  assert.match(JSON.stringify(h.adapter.requests[0]), /蓝色大肥鱼/);
  const item = h.core.journal.get(receipt.id);
  const events = h.core.journal.events(item.route);
  assert.deepEqual(events.map(e => e.type), ['message.accepted', 'turn.started', 'persona.loaded', 'turn.completed', 'delivery.started', 'delivery.sent']);
  assert.equal(events[1]?.causedBy, events[0]?.id);
  assert.ok(events.find(e => e.type === 'turn.completed')?.sources.some(ref => ref.kind === 'session'));
});

test('conversation keys isolate accounts, kinds and groups, while participants share a group', async t => {
  const h = await harness(await directory()); t.after(h.close);
  const a = h.simulator.send('a', '仅A的秘密', { id: '1', sender: 'alice' });
  const b = h.simulator.send('b', '仅B的问题', { id: '1', sender: 'bob' });
  await h.core.whenIdle();
  h.simulator.send('a', 'A继续', { id: '2', sender: 'charlie' });
  await h.core.whenIdle();
  assert.notEqual(h.core.journal.get(a.id).sessionId, h.core.journal.get(b.id).sessionId);
  const bRequests = h.adapter.requests.filter(r => r.sessionId === h.core.journal.get(b.id).sessionId);
  assert.ok(bRequests.every(r => !JSON.stringify(r).includes('仅A的秘密')));
  assert.match(JSON.stringify(h.adapter.requests.at(-1)), /仅A的秘密/);
  const c = { channel: 'x', account: 'a', kind: 'group' as const, id: 'b:c' };
  assert.notEqual(conversationKey('d', c), conversationKey('d', { ...c, account: 'a:b', id: 'c' }));
});

test('duplicates are idempotent and conflicting payloads are rejected', async t => {
  const h = await harness(await directory()); t.after(h.close);
  const first = h.simulator.send('a', '同一消息', { id: '1' });
  const again = h.simulator.send('a', '同一消息', { id: '1' });
  assert.equal(again.id, first.id); assert.equal(again.duplicate, true);
  assert.throws(() => h.simulator.send('a', '不同内容', { id: '1' }), /different content/);
  await h.core.whenIdle();
  assert.equal(h.adapter.requests.length, 1); assert.equal(h.simulator.deliveries.length, 1);
});

test('registered action is scoped, executed by DSH, and causally recorded', async t => {
  let calls = 0;
  const h = await harness(await directory(), () => ++calls === 1 ? call('test_echo', { text: 'hello' }) : textReply('已回显'));
  t.after(h.close);
  h.core.registerExtension(echo);
  const receipt = h.simulator.send('a', '调用测试能力', { id: '1' });
  await h.core.whenIdle();
  assert.equal(h.core.journal.get(receipt.id).state, 'delivered');
  const events = h.core.journal.events(h.core.journal.get(receipt.id).route);
  const start = events.find(e => e.type === 'operation.started');
  const end = events.find(e => e.type === 'operation.succeeded');
  assert.ok(start && end); assert.equal(start.operationId, end.operationId); assert.equal(end.causedBy, start.id);
  assert.equal(start.plugin, 'test-actions');
  assert.ok(h.adapter.requests[0]?.tools?.some(tool => tool.name === 'test_echo'));
  assert.ok(h.ctx.tools.schemas().every(tool => tool.name !== 'test_echo'));
});

test('unregister removes future tools; duplicate and incompatible registrations fail', async t => {
  let modelCalls = 0;
  const h = await harness(await directory(), () => ++modelCalls === 2 ? call('test_echo', { text: 'removed' }) : textReply('ok')); t.after(h.close);
  const handle = h.core.registerExtension(echo);
  assert.throws(() => h.core.registerExtension(echo), /Duplicate/);
  assert.throws(() => h.core.registerExtension({ ...echo, id: 'other', apiVersion: 99 }), /Incompatible/);
  assert.throws(() => h.core.registerExtension({ ...echo, id: 'other', agentId: 'someone-else' }), /Incompatible/);
  h.simulator.send('a', 'first', { id: '1' }); await h.core.whenIdle();
  handle.dispose(); handle.dispose();
  h.simulator.send('a', 'second', { id: '2' }); await h.core.whenIdle();
  // DSH preserves original declarations for replay and adds an in-history removal marker.
  assert.match(JSON.stringify(h.adapter.requests.at(-1)?.messages), /tool-removal/);
  const item = h.core.journal.list().at(-1);
  assert.ok(item);
  assert.equal(item.state, 'delivered');
  assert.ok(!h.core.journal.events(item.route).some(event => event.type === 'operation.started'));
});

test('confirmed non-delivery retries only transport; unknown outcomes never retry', async t => {
  const h = await harness(await directory()); t.after(h.close);
  h.simulator.nextDelivery({ status: 'not-sent', code: 'OFFLINE' });
  const receipt = h.simulator.send('a', 'hello', { id: '1' }); await h.core.whenIdle();
  assert.equal(h.core.journal.get(receipt.id).state, 'reply-ready');
  h.core.retryDelivery(receipt.id); await h.core.whenIdle();
  assert.equal(h.core.journal.get(receipt.id).state, 'delivered'); assert.equal(h.adapter.requests.length, 1);
  h.simulator.nextDelivery({ status: 'unknown', code: 'TIMEOUT' });
  const uncertain = h.simulator.send('a', 'another', { id: '2' }); await h.core.whenIdle();
  assert.equal(h.core.journal.get(uncertain.id).state, 'uncertain');
  assert.throws(() => h.core.retryDelivery(uncertain.id), /definitely unsent/);
});

test('restart restores DSH conversation without replaying delivered input', async () => {
  const root = await directory();
  const first = await harness(root);
  const receipt = first.simulator.send('a', '重启前的事实', { id: '1' }); await first.core.whenIdle();
  const sessionId = first.core.journal.get(receipt.id).sessionId;
  await first.close();
  const second = await harness(root);
  try {
    const duplicate = second.simulator.send('a', '重启前的事实', { id: '1' });
    assert.equal(duplicate.duplicate, true); await second.core.whenIdle(); assert.equal(second.adapter.requests.length, 0);
    const next = second.simulator.send('a', '继续', { id: '2' }); await second.core.whenIdle();
    assert.equal(second.core.journal.get(next.id).sessionId, sessionId);
    assert.match(JSON.stringify(second.adapter.requests[0]), /重启前的事实/);
  } finally { await second.close(); }
});

test('persona revision changes next turn without replacing the session', async t => {
  const root = await directory(); const persona = join(root, 'persona.md');
  await writeFile(persona, '测试人格第一版');
  const h = await harness(root, () => textReply('ok'), persona); t.after(h.close);
  const a = h.simulator.send('a', 'hello', { id: '1' }); await h.core.whenIdle();
  await writeFile(persona, '测试人格第二版');
  h.simulator.send('a', 'hello again', { id: '2' }); await h.core.whenIdle();
  const versions = h.core.journal.events(h.core.journal.get(a.id).route).filter(e => e.type === 'persona.loaded').map(e => e.data.version);
  assert.equal(versions.length, 2); assert.notEqual(versions[0], versions[1]);
  assert.match(JSON.stringify(h.adapter.requests.at(-1)), /测试人格第二版/);
});

test('model failure does not deliver or prevent the next message', async t => {
  let count = 0;
  const h = await harness(await directory(), () => { if (++count === 1) throw new Error('simulated'); return textReply('恢复了'); });
  t.after(h.close);
  const a = h.simulator.send('a', 'fail', { id: '1' }); await h.core.whenIdle();
  assert.equal(h.core.journal.get(a.id).state, 'failed'); assert.equal(h.simulator.deliveries.length, 0);
  const b = h.simulator.send('a', 'continue', { id: '2' }); await h.core.whenIdle();
  assert.equal(h.core.journal.get(b.id).state, 'delivered');
});

test('ingress rejects malformed and cross-account messages, and old handles cannot ingest', async t => {
  const h = await harness(await directory()); t.after(h.close);
  assert.throws(() => h.simulator.handle.ingest({ text: 'invalid' }));
  assert.throws(() => h.simulator.handle.ingest({ id: '1', occurredAt: new Date().toISOString(),
    conversation: { channel: 'qq', account: 'stolen', kind: 'group', id: 'a' }, sender: { id: 'x', displayName: '主人' }, text: 'hello' }), /does not own/);
  await h.simulatorFiber.dispose();
  assert.throws(() => h.simulator.send('a', 'hello', { id: '1' }), /unregistered/);
  assert.equal(h.core.getStatus().state, 'ready');
});

test('inherited host tools are not exposed to Dafeiyu conversations', async t => {
  const h = await harness(await directory()); t.after(h.close);
  const dispose = h.ctx.tools.register({ name: 'host_only', description: '不属于大肥鱼的宿主操作',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: {}, render: () => [{ type: 'text', text: 'ok' }] }, execute: async () => 'ok' });
  t.after(dispose);
  h.simulator.send('a', 'hello', { id: '1' }); await h.core.whenIdle();
  assert.ok(!h.adapter.requests[0]?.tools?.some(tool => tool.name === 'host_only'));
});

test('core unload deactivates dependent channel and leaves a readable closed status', async t => {
  const h = await harness(await directory()); t.after(h.close);
  h.simulator.send('a', 'hello', { id: '1' }); await h.core.whenIdle();
  await h.coreFiber.dispose();
  assert.equal(h.core.getStatus().state, 'closed');
  assert.throws(() => h.simulator.send('a', 'after unload', { id: '2' }), /closing|unregistered/);
});

test('capability failure is recorded without placing raw secrets in audit or tool errors', async t => {
  let calls = 0;
  const h = await harness(await directory(), () => ++calls === 1 ? call('test_echo', { text: 'hello' }) : textReply('失败了'));
  t.after(h.close);
  h.core.registerExtension({ ...echo, actions: [{ ...echo.actions![0]!, execute: async () => { throw new Error('secret-token-not-to-log'); } }] });
  const receipt = h.simulator.send('a', 'test', { id: '1' }); await h.core.whenIdle();
  const events = h.core.journal.events(h.core.journal.get(receipt.id).route);
  assert.ok(events.some(event => event.type === 'operation.failed'));
  assert.ok(!JSON.stringify(events).includes('secret-token-not-to-log'));
  assert.ok(!JSON.stringify(h.adapter.requests.at(-1)).includes('secret-token-not-to-log'));
});

test('unregister cancels a cooperative in-flight action and records its failure', async t => {
  let entered: () => void = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; });
  let calls = 0;
  const h = await harness(await directory(), () => ++calls === 1 ? call('test_echo', { text: 'wait' }) : textReply('操作已停止'));
  t.after(h.close);
  const handle = h.core.registerExtension({ ...echo, actions: [{ ...echo.actions![0]!, execute: async (_args, context) => {
    entered();
    await new Promise<void>((_resolve, reject) => context.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    return null;
  } }] });
  const receipt = h.simulator.send('a', 'test', { id: '1' }); await started; handle.dispose(); await h.core.whenIdle();
  assert.ok(h.core.journal.events(h.core.journal.get(receipt.id).route).some(event => event.type === 'operation.failed'));
});

test('class-backed channel methods retain their receiver during registration', async t => {
  const h = await harness(await directory()); t.after(h.close);
  class Channel {
    channel = 'class-transport'; account = 'test'; count = 0;
    async deliver() { this.count++; return { status: 'sent' as const, receiptId: 'class-receipt' }; }
  }
  const channel = new Channel();
  const handle = h.core.registerExtension({ id: 'class-extension', version: '0.1.0', apiVersion: 1, agentId: 'dafeiyu', channels: [channel] });
  const receipt = handle.ingest({ id: '1', occurredAt: new Date().toISOString(), conversation: { channel: channel.channel, account: channel.account, kind: 'local', id: 'test' }, sender: { id: 'user', displayName: 'test' }, text: 'hello' });
  await h.core.whenIdle();
  assert.equal(channel.count, 1); assert.equal(h.core.journal.get(receipt.id).state, 'delivered');
});
