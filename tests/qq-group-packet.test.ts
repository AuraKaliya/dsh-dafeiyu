import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { OneBot } from '../packages/channel-qq/lib/onebot.js';
import { parseSnowLumaGroups } from '../packages/channel-qq/lib/snowluma-groups.js';
import { groupPacket, wireBytes, wireUint, assertGroupQuery } from './qq-group-packet-fixture.js';

test('frozen read response distinguishes group assistant from ordinary receive mode', () => {
  assert.deepEqual(parseSnowLumaGroups('08e51f1002220e120c18b96022032a01412a023802'), [{ id: '12345', name: 'A', msgMask: 2 }]);
  assert.deepEqual(parseSnowLumaGroups('08e51f10022200'), []);
});

test('receive masks preserve membership while missing and unknown states stay explicitly unknown', () => {
  const masks = [1, 2, 3, 4, null, 99];
  const groups = parseSnowLumaGroups(groupPacket(masks.map((msgMask, i) => ({ group_id: 11223344 + i, group_name: '虚构群', msgMask }))));
  assert.deepEqual(groups.map(group => group.msgMask), [1, 2, 3, 4, null, null]); assert.equal(groups.length, 6);
});

test('malformed or rejected protobuf never becomes an empty authorized group list', () => {
  const envelope = (body: Buffer) => Buffer.concat([wireUint(1, 4069), wireUint(2, 2), wireBytes(4, body)]).toString('hex');
  const group = (settings: Buffer) => wireBytes(2, Buffer.concat([wireUint(3, 11223344), wireBytes(5, settings)]));
  const invalidName = wireBytes(4, wireBytes(5, Buffer.from([255])));
  const invalid: unknown[] = [null, {}, '', '0', 'gg', '80', '00', '0a80', '0b', 'ffffffffffffffffffff02',
    wireUint(3, 1).toString('hex'), Buffer.concat([wireUint(1, 123), wireBytes(4, Buffer.alloc(0))]).toString('hex'),
    Buffer.concat([wireUint(2, 9), wireBytes(4, Buffer.alloc(0))]).toString('hex'),
    Buffer.concat([wireUint(3, 1), wireBytes(4, Buffer.alloc(0))]).toString('hex'),
    envelope(group(Buffer.concat([wireUint(7, 1), wireUint(7, 2)]))), envelope(group(wireBytes(7, Buffer.from('1')))),
    envelope(wireBytes(2, wireUint(3, 4294967296n))),
    envelope(wireBytes(2, Buffer.concat([wireUint(3, 11223344), wireUint(3, 22334455)]))),
    envelope(wireBytes(2, Buffer.concat([wireUint(3, 11223344), invalidName]))),
    groupPacket([{ group_id: 11223344, group_name: 'x'.repeat(201) }]),
    groupPacket([{ group_id: 11223344, group_name: 'A' }, { group_id: 11223344, group_name: 'B' }]),
    groupPacket(Array.from({ length: 2001 }, (_, i) => ({ group_id: 11223344 + i, group_name: 'A' }))),
    '00'.repeat(1024 ** 2 + 1)];
  for (const input of invalid) assert.throws(() => parseSnowLumaGroups(input), /^Error: GROUP_RESPONSE_INVALID$/);
});

test('unknown protobuf fields are skipped without overriding requested group settings', () => {
  const original = Buffer.from(groupPacket([{ group_id: 11223344, group_name: 'A', msgMask: 4 }]), 'hex');
  assert.equal(parseSnowLumaGroups(Buffer.concat([original, wireBytes(99, Buffer.from('untrusted unused metadata'))]).toString('hex'))[0]?.msgMask, 4);
});

for (const scenario of ['normal', 'identity-change', 'unsupported'] as const) test(`fixed send_packet adapter: ${scenario}`, async t => {
  const calls: string[] = []; let identity = '12345678';
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fictional-local-token');
    let body = ''; for await (const part of req) body += String(part); calls.push(req.url ?? ''); let data: unknown;
    if (req.url === '/get_login_info') data = { user_id: Number(identity) };
    else if (req.url === '/get_status') data = { online: true };
    else if (req.url === '/send_packet') {
      assertGroupQuery(body);
      if (scenario === 'unsupported') { res.writeHead(404).end(); return; }
      data = groupPacket([{ group_id: 11223344, group_name: 'A', msgMask: 2 }]);
      if (scenario === 'identity-change') identity = '87654321';
    } else { res.writeHead(500).end(); return; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'ok', retcode: 0, data }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const api = new OneBot(`http://127.0.0.1:${address.port}/`, 'fictional-local-token', '12345678', 1000);
  if (scenario === 'normal') assert.deepEqual(await api.groups(new AbortController().signal), [{ id: '11223344', name: 'A', msgMask: 2 }]);
  else await assert.rejects(api.groups(new AbortController().signal), scenario === 'identity-change' ? /ACCOUNT_MISMATCH/ : /GROUP_SETTINGS_UNAVAILABLE/);
  assert.equal(calls.filter(action => action === '/send_packet').length, 1);
  assert.equal(calls.some(action => action.includes('msg') || action === '/get_group_list'), false);
});
