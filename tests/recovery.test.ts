import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal, eventFor } from '@dafeiyu/journal';
import { MessageSchema } from '@dafeiyu/contracts';
import { harness, textReply } from './harness.js';

const directory = () => mkdtemp(join(tmpdir(), 'dafeiyu-recovery-'));
const input = (id: string) => MessageSchema.parse({ id, occurredAt: '2026-10-23T12:00:00+08:00',
  conversation: { channel: 'simulator', account: 'local', kind: 'local', id: 'a' },
  sender: { id: 'user', displayName: '测试' }, text: 'test' });

test('journal has one writer and monotonic recorded order despite late source times', async () => {
  const file = join(await directory(), 'journal.sqlite');
  const j = new Journal(file);
  try {
    assert.throws(() => new Journal(file), /already owned/);
    const a = j.accept('dafeiyu', 'channel-simulator', '0.1.0', input('a'));
    j.accept('dafeiyu', 'channel-simulator', '0.1.0', { ...input('b'), occurredAt: '2026-10-22T12:00:00+08:00' });
    const events = j.events(j.get(a.id).route);
    assert.ok(events[0] && events[1]);
    assert.ok(events[0].seq < events[1].seq); assert.ok(events[0].occurredAt > events[1].occurredAt);
    assert.equal(j.events('another-scope').length, 0);
  } finally { j.close(); }
  const reopened = new Journal(file); reopened.close();
});

test('unfinished processing and external send become uncertain without executing again', async () => {
  const root = await directory(); const j = new Journal(join(root, 'journal.sqlite'));
  const a = j.accept('dafeiyu', 'channel-simulator', '0.1.0', input('a'));
  const first = j.get(a.id);
  j.transition(a.id, 'accepted', 'processing', eventFor('dafeiyu', first, 'turn.started', 'core', '0.1.0'));
  j.append(eventFor('dafeiyu', first, 'operation.started', 'test-action', '0.1.0', 'unfinished-operation'));
  const b = j.accept('dafeiyu', 'channel-simulator', '0.1.0', input('b'));
  const second = j.get(b.id);
  j.transition(b.id, 'accepted', 'sending', eventFor('dafeiyu', second, 'delivery.started', 'core', '0.1.0'));
  j.close();
  const h = await harness(root);
  try {
    await h.core.whenIdle();
    assert.equal(h.core.journal.get(a.id).state, 'uncertain'); assert.equal(h.core.journal.get(b.id).state, 'uncertain');
    assert.equal(h.adapter.requests.length, 0); assert.equal(h.simulator.deliveries.length, 0);
    assert.ok(h.core.journal.events(first.route).some(event => event.type === 'operation.unknown' && event.operationId === 'unfinished-operation'));
  } finally { await h.close(); }
});

test('accepted but not started message resumes once after registration', async () => {
  const root = await directory(); const j = new Journal(join(root, 'journal.sqlite'));
  const receipt = j.accept('dafeiyu', 'channel-simulator', '0.1.0', input('a')); j.close();
  const h = await harness(root);
  try { await h.core.whenIdle(); assert.equal(h.core.journal.get(receipt.id).state, 'delivered'); assert.equal(h.adapter.requests.length, 1); }
  finally { await h.close(); }
});

test('prepared reply survives restart and is delivered without another model turn', async () => {
  const root = await directory(); const j = new Journal(join(root, 'journal.sqlite'));
  const receipt = j.accept('dafeiyu', 'channel-simulator', '0.1.0', input('a'));
  const item = j.get(receipt.id);
  j.transition(item.id, 'accepted', 'reply-ready', eventFor('dafeiyu', item, 'turn.completed', 'core', '0.1.0'),
    { id: item.id + ':reply', conversation: item.message.conversation, sourceMessageId: 'a', text: '此前已经生成' });
  j.close(); const h = await harness(root);
  try {
    await h.core.whenIdle(); assert.equal(h.adapter.requests.length, 0);
    assert.equal(h.simulator.deliveries[0]?.text, '此前已经生成');
  } finally { await h.close(); }
});

test('same conversation serializes; independent conversations can progress concurrently', async t => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered: () => void = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; });
  const h = await harness(await directory(), async request => {
    if (JSON.stringify(request.messages).includes('slow-one') && !JSON.stringify(request.messages).includes('after-slow')) { entered(); await gate; }
    return textReply('ok');
  }); t.after(h.close);
  h.simulator.send('slow', 'slow-one', { id: '1' });
  await started;
  h.simulator.send('slow', 'after-slow', { id: '2' });
  const fast = h.simulator.send('fast', 'independent', { id: '1' });
  for (let i = 0; i < 100 && h.core.journal.get(fast.id).state !== 'delivered'; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.core.journal.get(fast.id).state, 'delivered');
  assert.equal(h.adapter.requests.length, 2);
  release(); await h.core.whenIdle();
  assert.deepEqual(h.simulator.deliveries.filter(reply => reply.conversation.id === 'slow').map(reply => reply.sourceMessageId), ['1', '2']);
});

test('cooperative turn timeout is recorded without sending a partial reply', async t => {
  const h = await harness(await directory(), async request => {
    await new Promise<void>((_resolve, reject) => {
      if (request.signal?.aborted) { reject(new Error('cancelled')); return; }
      request.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    });
    return textReply('must not send');
  }, undefined, 100);
  t.after(h.close);
  // Keep the test process alive while AbortSignal.timeout's unref'ed timer is pending.
  const keepAlive = setInterval(() => {}, 1000); t.after(() => clearInterval(keepAlive));
  const receipt = h.simulator.send('a', 'wait', { id: '1' }); await h.core.whenIdle();
  assert.equal(h.core.journal.get(receipt.id).state, 'failed'); assert.equal(h.simulator.deliveries.length, 0);
});
