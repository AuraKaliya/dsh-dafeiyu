import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync } from 'node:fs';
import { link, mkdir, mkdtemp, readFile, readdir, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { openLegacyMemoryReader } from '@dafeiyu/server-compat';
import type { LegacyMemoryBinding, LegacyMemoryScope } from '@dafeiyu/server-compat';
import { testTempDir } from './test-temp.js';

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const short = (text: string) => sha(text).slice(0, 24);
const resetAt = Date.parse('2026-10-25T10:00:00.000Z');
const sourceAt = '2026-10-25T11:00:00.000Z', updatedAt = '2026-10-25T12:00:00.000Z';
const now = Date.parse('2026-10-25T13:00:00.000Z'), expires = '2026-10-26T12:00:00.000Z';
const scope: LegacyMemoryScope = { platform: 'qq', accountId: '11111', route: 'group:33333', userId: '22222', sinceMs: resetAt };
const statePath = '运行状态/qq-bridge/state.json';
const prefsPath = '共享记忆库/人格记忆/02_可更新偏好.md', recentPath = '共享记忆库/人格记忆/03_近期状态和关系记忆.md';
const profilePath = '共享记忆库/users/22222.json';
const candidatePath = '运行状态/qq-bridge/scopes/group/33333/users/22222.json';
const block = (records: readonly unknown[], base = 'UNSOURCED_BASE_SENTINEL') => `${base}\n<!-- DAFEIYU_RECORDS_START -->\n\`\`\`json\n${JSON.stringify(records)}\n\`\`\`\n<!-- DAFEIYU_RECORDS_END -->\n`;

async function fixture() {
  const root = await mkdtemp(join(testTempDir(), 'server-legacy-memory-'));
  const binding: LegacyMemoryBinding = { root, qq: { accountId: '11111', ownerId: '22222' }, bilibili: { accountId: '88888', ownerId: '22222' } };
  const put = async (path: string, value: string | unknown) => {
    const file = join(root, path); await mkdir(dirname(file), { recursive: true });
    await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const origin = { id: `${scope.route}:message1`, route: scope.route, user_id: scope.userId, message_id: 'message1', at: sourceAt };
  const preference = { id: 'tea', text: '虚构用户说今天想喝茶。', confidence: 'tentative', updated_at: updatedAt, sources: [origin] };
  const recent = { id: 'current_visit', text: '虚构用户本周计划到访。', confidence: 'confirmed', updated_at: updatedAt,
    route: scope.route, user_id: scope.userId, kind: 'recent', expires_at: expires, sources: [origin] };
  const text = '虚构用户喜欢在下雨时读书。', section = '偏好';
  const candidateId = short(JSON.stringify([scope.userId, scope.route, section, text]));
  const source = { id: candidateId, origin: scope.route, message_id: 'message2', sender_id: scope.userId, observed_at: sourceAt };
  const fact = { id: short(`${scope.userId}|${scope.route}|${section}|${text}`), section, text, confidence: 'confirmed', sources: [source] };
  const profile = { version: 1, user_id: scope.userId, summary: 'UNSCOPED_SUMMARY_SENTINEL', names: ['PRIVATE_NAME_SENTINEL'],
    candidate_versions: { [candidateId]: short(JSON.stringify([candidateId, 'shared', 'confirmed'])) }, facts: [fact] };
  const candidate = { version: 1, scope: scope.route, user_id: scope.userId, sections: { [section]: [
    { text, confidence: 'confirmed', visibility: 'shared', source_message_id: 'message2', source_sender_id: scope.userId, observed_at: sourceAt },
  ] } };
  await put(statePath, { resetAt, processedByRoute: { other: ['UNRELATED_STATE_SENTINEL'] } });
  await put(prefsPath, block([preference])); await put(recentPath, block([recent]));
  await put(profilePath, profile); await put(candidatePath, candidate);
  await put('人格/01_固定核心.md', 'REJECTED_FIXED_CORE_SENTINEL');
  await put('无关文件.txt', 'FICTIONAL_DIRTY_UNRELATED');
  return { root, binding, put, preference, recent, profile, candidate, candidateId };
}

async function fileHashes(root: string, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, item.name);
    if (item.isDirectory()) Object.assign(result, await fileHashes(root, path));
    else result[path] = sha(await readFile(join(root, path)));
  }
  return result;
}

test('legacy reader opens only existing roots and a real reset boundary, never creates or repairs files', async () => {
  const parent = await mkdtemp(join(testTempDir(), 'legacy-missing-')), root = join(parent, 'absent');
  const binding: LegacyMemoryBinding = { root, qq: { accountId: '11111', ownerId: '22222' } };
  assert.throws(() => openLegacyMemoryReader(binding, { clock: () => now }), /LEGACY_PATH_INVALID/);
  assert.equal(existsSync(root), false);
  await mkdir(root);
  assert.throws(() => openLegacyMemoryReader(binding, { clock: () => now }), /LEGACY_RESET_MISSING/);
  assert.deepEqual(await readdir(root), []);
  const f = await fixture(); await f.put(statePath, { unrelated: 1 }); const before = await fileHashes(f.root);
  assert.throws(() => openLegacyMemoryReader(f.binding, { clock: () => now }), /LEGACY_RESET_INVALID/);
  assert.deepEqual(await fileHashes(f.root), before);
});

test('scoped legacy claims preserve all original bytes and expose neither fixed core, base prose nor private extension fields', async () => {
  const f = await fixture();
  await f.put(prefsPath, block([{ ...f.preference, thinking: 'INTERNAL_ONLY_SENTINEL', credentials: { token: 'PRIVATE_TOKEN_FIELD_SENTINEL' } }]));
  const before = await fileHashes(f.root), reader = openLegacyMemoryReader(f.binding, { clock: () => now });
  const result = reader.read(scope), output = JSON.stringify(result);
  assert.equal(result.claims.length, 3);
  assert.deepEqual(new Set(result.claims.map(claim => claim.collection)), new Set(['preferences', 'recent', 'shared']));
  assert.equal(reader.identity.root.ino, lstatSync(f.root, { bigint: true }).ino.toString());
  for (const claim of result.claims) {
    assert.equal(claim.kind, 'legacy-history-claim'); assert.equal(claim.adopted, false); assert.equal(claim.instructionAuthority, false);
    assert.equal(claim.sourceVerification, 'legacy-files-only'); assert.ok(claim.sources.length); assert.equal(reader.current(scope, claim.ref), true);
    assert.ok(Object.isFrozen(claim)); assert.ok(claim.ref.files.every(file => file.hash.length === 64 && /^\d+$/.test(file.ino)));
  }
  for (const sentinel of ['UNSOURCED_BASE_SENTINEL', 'REJECTED_FIXED_CORE_SENTINEL', 'UNSCOPED_SUMMARY_SENTINEL', 'PRIVATE_NAME_SENTINEL',
    'UNRELATED_STATE_SENTINEL', 'INTERNAL_ONLY_SENTINEL', 'PRIVATE_TOKEN_FIELD_SENTINEL']) assert.equal(output.includes(sentinel), false);
  assert.equal(output.includes(f.root), false); assert.deepEqual(await fileHashes(f.root), before);
  reader.close(); assert.throws(() => reader.read(scope), /LEGACY_READER_CLOSED/);
});

test('route, current sender, account and platform are independent access boundaries', async () => {
  const f = await fixture(), reader = openLegacyMemoryReader(f.binding, { clock: () => now });
  try {
    assert.equal(reader.read({ ...scope, route: 'group:44444' }).claims.length, 0);
    assert.equal(reader.read({ ...scope, userId: '55555' }).claims.length, 0);
    assert.throws(() => reader.read({ ...scope, accountId: '99999' }), /LEGACY_SCOPE_DENIED/);
    assert.throws(() => reader.read({ ...scope, route: 'private:55555' }), /LEGACY_SCOPE_DENIED/);
    const biliScope: LegacyMemoryScope = { ...scope, platform: 'bilibili', accountId: '88888', route: 'bilibili:22222' };
    assert.equal(reader.read(biliScope).claims.length, 0);
    const source = { ...f.preference.sources[0]!, route: biliScope.route, id: `${biliScope.route}:message1` };
    await f.put(prefsPath, block([{ ...f.preference, sources: [source] }]));
    // A Bili read must not even parse a QQ user's profile with the same numeric id.
    await f.put(profilePath, 'INVALID_QQ_PROFILE_SENTINEL');
    assert.equal(reader.read(biliScope).claims.length, 1);
    assert.throws(() => reader.read({ ...biliScope, userId: '55555' }), /LEGACY_SCOPE_DENIED/);
  } finally { reader.close(); }
});

test('unattributed or mixed-scope preference records and ambiguous recent relations remain withheld', async () => {
  const f = await fixture();
  await f.put(prefsPath, block([
    { ...f.preference, id: 'without_sources', text: 'NO_SOURCE_SENTINEL', sources: [] },
    { ...f.preference, id: 'mixed_routes', text: 'MIXED_SCOPE_SENTINEL', sources: [...f.preference.sources,
      { ...f.preference.sources[0]!, id: 'group:44444:message1', route: 'group:44444' }] },
  ]));
  await f.put(recentPath, block([{ ...f.recent, user_id: undefined, text: 'NO_USER_SENTINEL' }]));
  const reader = openLegacyMemoryReader(f.binding, { clock: () => now });
  try {
    const result = reader.read(scope); assert.deepEqual(result.claims.map(claim => claim.collection), ['shared']);
    for (const value of ['NO_SOURCE_SENTINEL', 'MIXED_SCOPE_SENTINEL', 'NO_USER_SENTINEL']) assert.equal(JSON.stringify(result).includes(value), false);
  } finally { reader.close(); }
});

test('actual reset and trusted per-route since exclude older records; ordinary state updates retain the same source boundary', async () => {
  const f = await fixture(), reader = openLegacyMemoryReader(f.binding, { clock: () => now });
  try {
    const reference = reader.read(scope).claims.find(claim => claim.collection === 'preferences')!.ref;
    await f.put(statePath, { resetAt, processedByRoute: { changed: ['fictional-message'] } });
    assert.equal(reader.current(scope, reference), true);
    assert.equal(reader.read({ ...scope, sinceMs: Date.parse(updatedAt) + 1 }).claims.length, 0);
    await f.put(statePath, { resetAt: resetAt + 1 });
    assert.equal(reader.current(scope, reference), false); assert.throws(() => reader.read(scope), /LEGACY_RESET_CHANGED/);
  } finally { reader.close(); }
  await f.put(statePath, { resetAt: 0 }); assert.throws(() => openLegacyMemoryReader(f.binding, { clock: () => now }), /LEGACY_RESET_INVALID/);
  await f.put(statePath, { resetAt: now + 1 }); assert.throws(() => openLegacyMemoryReader(f.binding, { clock: () => now }), /LEGACY_RESET_INVALID/);
});

test('recent expiry and additional program recall checks revoke previously issued references', async () => {
  const f = await fixture(); let currentTime = now, recalled = false;
  const reader = openLegacyMemoryReader(f.binding, { clock: () => currentTime, sourceCurrent: (_scope, source) => !recalled || source.messageId !== 'message1' });
  try {
    const original = reader.read(scope), recent = original.claims.find(claim => claim.collection === 'recent')!, preference = original.claims.find(claim => claim.collection === 'preferences')!;
    currentTime = Date.parse(expires); assert.equal(reader.current(scope, recent.ref), false);
    assert.equal(reader.current(scope, preference.ref), true);
    recalled = true; assert.equal(reader.current(scope, preference.ref), false);
    assert.deepEqual(reader.read(scope).claims.map(claim => claim.collection), ['shared']);
  } finally { reader.close(); }
  const throwing = openLegacyMemoryReader(f.binding, { clock: () => now, sourceCurrent: () => { throw new Error('FICTIONAL_PRIVATE_FAILURE'); } });
  try { assert.equal(throwing.read(scope).claims.length, 0); } finally { throwing.close(); }
  // @ts-expect-error A JavaScript caller can violate the declared boolean return contract.
  const miswired = openLegacyMemoryReader(f.binding, { clock: () => now, sourceCurrent: () => undefined });
  try { assert.equal(miswired.read(scope).claims.length, 0); } finally { miswired.close(); }
});

test('legacy shared ids retain their original pre-trim hash while attribution still comes from current scoped sources', async () => {
  const f = await fixture(), fact = f.profile.facts[0]!;
  const legacyId = short(`${scope.userId}|${scope.route}| ${fact.section} |${fact.text}`);
  fact.id = legacyId; await f.put(profilePath, f.profile);
  const before = await fileHashes(f.root), reader = openLegacyMemoryReader(f.binding, { clock: () => now });
  try {
    const claim = reader.read(scope).claims.find(value => value.collection === 'shared');
    assert.equal(claim?.legacyId, legacyId); assert.equal(reader.current(scope, claim!.ref), true);
    assert.deepEqual(await fileHashes(f.root), before);
  } finally { reader.close(); }
});

test('shared source deletion, private withdrawal, metadata changes and old version labels all make facts unavailable', async () => {
  const f = await fixture(), reader = openLegacyMemoryReader(f.binding, { clock: () => now });
  try {
    const reference = reader.read(scope).claims.find(claim => claim.collection === 'shared')!.ref;
    f.candidate.sections['偏好']![0]!.visibility = 'private'; await f.put(candidatePath, f.candidate);
    assert.equal(reader.current(scope, reference), false); assert.ok(reader.read(scope).claims.every(claim => claim.collection !== 'shared'));
    f.candidate.sections['偏好']![0]!.visibility = 'shared'; f.candidate.sections['偏好']![0]!.confidence = 'tentative'; await f.put(candidatePath, f.candidate);
    assert.ok(reader.read(scope).claims.every(claim => claim.collection !== 'shared'));
    f.candidate.sections['偏好']![0]!.confidence = 'confirmed'; f.candidate.sections['偏好']![0]!.source_message_id = 'different-message'; await f.put(candidatePath, f.candidate);
    assert.ok(reader.read(scope).claims.every(claim => claim.collection !== 'shared'));
    f.candidate.sections['偏好']![0]!.source_message_id = 'message2'; await f.put(candidatePath, f.candidate);
    assert.ok(reader.read(scope).claims.some(claim => claim.collection === 'shared'));
    await unlink(join(f.root, candidatePath)); assert.ok(reader.read(scope).claims.every(claim => claim.collection !== 'shared'));
  } finally { reader.close(); }
});

test('full file identity and content changes invalidate refs without overwriting removed or changed records', async () => {
  const f = await fixture(), reader = openLegacyMemoryReader(f.binding, { clock: () => now });
  try {
    const first = reader.read(scope).claims.find(claim => claim.collection === 'preferences')!;
    const original = await readFile(join(f.root, prefsPath)); await rename(join(f.root, prefsPath), join(f.root, prefsPath + '.old'));
    await writeFile(join(f.root, prefsPath), original);
    assert.equal(reader.current(scope, first.ref), false);
    const second = reader.read(scope).claims.find(claim => claim.collection === 'preferences')!;
    assert.equal(second.ref.key, first.ref.key); assert.notEqual(second.ref.version, first.ref.version);
    await f.put(prefsPath, block([])); assert.equal(reader.resolve(scope, second.ref), null);
    const after = await fileHashes(f.root); reader.read(scope); assert.deepEqual(await fileHashes(f.root), after);
    assert.equal(reader.resolve(scope, { ...first.ref, version: '0'.repeat(64) }), null);
  } finally { reader.close(); }
});

test('wrong file attribution, duplicate record ids and malformed blocks fail closed without repairs', async () => {
  const f = await fixture(), reader = openLegacyMemoryReader(f.binding, { clock: () => now });
  try {
    f.candidate.scope = 'group:44444'; await f.put(candidatePath, f.candidate); assert.throws(() => reader.read(scope), /LEGACY_PROFILE_INVALID/);
    f.candidate.scope = scope.route; await f.put(candidatePath, f.candidate);
    await f.put(prefsPath, block([f.preference, f.preference])); assert.throws(() => reader.read(scope), /LEGACY_DUPLICATE_RECORD/);
    await f.put(prefsPath, 'prefix<!-- DAFEIYU_RECORDS_START -->invalid'); const before = await fileHashes(f.root);
    assert.throws(() => reader.read(scope), /LEGACY_FORMAT_INVALID/); assert.deepEqual(await fileHashes(f.root), before);
  } finally { reader.close(); }
});

test('junctions, hard-linked memory files, oversized reads and known secret/thinking text cannot enter claims', async () => {
  const f = await fixture(), alias = await mkdtemp(join(testTempDir(), 'legacy-alias-')), linkedRoot = join(alias, 'root');
  await symlink(f.root, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => openLegacyMemoryReader({ ...f.binding, root: linkedRoot }, { clock: () => now }), /LEGACY_PATH_INVALID/);
  const reader = openLegacyMemoryReader(f.binding, { clock: () => now });
  try {
    await link(join(f.root, prefsPath), join(f.root, 'hard-link.md')); assert.throws(() => reader.read(scope), /LEGACY_PATH_INVALID/);
    await unlink(join(f.root, 'hard-link.md'));
    await f.put(prefsPath, 'x'.repeat(2097153)); assert.throws(() => reader.read(scope), /LEGACY_FILE_TOO_LARGE/);
    await f.put(prefsPath, block([{ ...f.preference, text: 'password=SYNTHETIC_SECRET_ONLY' },
      { ...f.preference, id: 'hidden', text: '<think>FICTIONAL_INTERNAL_SENTINEL</think>' }]));
    const result = reader.read(scope); assert.ok(result.claims.every(claim => claim.collection !== 'preferences'));
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_SECRET_ONLY'), false); assert.equal(JSON.stringify(result).includes('FICTIONAL_INTERNAL_SENTINEL'), false);
  } finally { reader.close(); }
});

test('optional absent memory remains absent and bounded output is explicit rather than an invented complete migration', async () => {
  const f = await fixture(); await unlink(join(f.root, recentPath));
  const reader = openLegacyMemoryReader(f.binding, { clock: () => now, maxClaims: 1 });
  try {
    const before = await fileHashes(f.root), result = reader.read(scope);
    assert.equal(result.claims.length, 1); assert.equal(result.withheld['limit'], 1); assert.equal(result.withheld['file-unavailable'], 1);
    assert.deepEqual(await fileHashes(f.root), before); assert.equal(existsSync(join(f.root, recentPath)), false);
  } finally { reader.close(); }
});
