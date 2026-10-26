import { z } from 'zod';
import { redactText } from '@dafeiyu/contracts';
import { LegacyFiles } from './legacy-files.js';
import type { LegacyFileSnapshot } from './legacy-files.js';
import { check, digest, freeze } from './safety.js';
import { LegacyMemoryBindingSchema, LegacyMemoryScopeSchema, LegacyMemoryReferenceSchema } from './legacy-types.js';
import type { LegacyMemoryBinding, LegacyMemoryScope, LegacyMemoryOptions, LegacyMemoryClaim, LegacyMemoryOrigin,
  LegacyMemoryReadResult, LegacyMemoryReference, LegacyFileVersion } from './legacy-types.js';

const statePath = '运行状态/qq-bridge/state.json';
const personaPaths = { preferences: '共享记忆库/人格记忆/02_可更新偏好.md', recent: '共享记忆库/人格记忆/03_近期状态和关系记忆.md' } as const;
const start = '<!-- DAFEIYU_RECORDS_START -->', end = '<!-- DAFEIYU_RECORDS_END -->';
const id = z.string().regex(/^[1-9][0-9]{4,19}$/), messageId = z.string().regex(/^[a-zA-Z0-9._:#-]{1,160}$/);
const at = z.iso.datetime({ offset: true });
const confidence = z.enum(['tentative', 'confirmed']);
const sourceId = z.string().regex(/^[a-f0-9]{24}$/);
const personaSource = z.object({ id: z.string().max(220), route: z.string().max(60), user_id: id, message_id: messageId, at });
const personaRecord = z.object({ id: z.string().regex(/^[a-z0-9_-]{1,80}$/), text: z.string().max(700), confidence,
  updated_at: at, sources: z.array(personaSource).min(1).max(200), route: z.string().optional(), user_id: id.optional(),
  kind: z.enum(['recent', 'relation', 'boundary']).optional(), expires_at: at.nullable().optional() });
const sharedSource = z.object({ id: sourceId, origin: z.string().max(60), message_id: messageId, sender_id: id, observed_at: at });
const sharedFact = z.object({ id: sourceId, section: z.string().min(1).max(30), text: z.string().max(240), confidence,
  sources: z.array(sharedSource).min(1).max(12) });
const sharedProfile = z.object({ version: z.literal(1), user_id: id, facts: z.array(z.unknown()).max(200),
  candidate_versions: z.record(z.string(), z.string()) });
const candidateRecord = z.object({ text: z.string().max(240), confidence: z.string().optional(), visibility: z.string().optional(),
  source_message_id: messageId, source_sender_id: id, observed_at: at });
const candidates = z.object({ version: z.literal(1), scope: z.string(), user_id: id, sections: z.record(z.string(), z.array(z.unknown()).max(400)) });
const privateHint = /不要公开|不要告诉|只在私聊|仅此会话|只在这里|保密|私密/;
const secret = /(?:密码|口令|api.?key|access.?token|验证码)\s*(?:[:=：]|是|为)\s*\S+/i;
const hidden = /<\/?(?:think|thinking|reasoning)\b|["'](?:reasoning|thinking|chain[_ -]?of[_ -]?thought|replayState)["']\s*:/i;
const safeText = (text: string) => !!text.trim() && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)
  && !redactText(text).redacted && !secret.test(text) && !hidden.test(text);
const shortHash = (value: string) => digest(value).slice(0, 24);
const json = (file: LegacyFileSnapshot): unknown => { try { return JSON.parse(file.text); } catch { throw new Error('LEGACY_FORMAT_INVALID'); } };
const inc = (counts: Record<string, number>, reason: string) => { counts[reason] = (counts[reason] ?? 0) + 1; };
type ParsedCandidate = { readonly source: z.infer<typeof sharedSource>; readonly version: string; readonly public: boolean };

/** Reads current, scoped historical claims. It never grants access, writes memory, or adopts persona. */
export class LegacyMemoryReader {
  private closed = false;
  private readonly files: LegacyFiles;
  private readonly clock: () => number;
  private readonly maxClaims: number;
  private readonly sourceCurrent: LegacyMemoryOptions['sourceCurrent'];
  readonly binding: LegacyMemoryBinding;
  readonly resetAt: number;
  readonly boundaryHash: string;
  readonly identity: { readonly root: { readonly dev: string; readonly ino: string } };
  constructor(raw: LegacyMemoryBinding, options: LegacyMemoryOptions = {}) {
    const parsed = LegacyMemoryBindingSchema.safeParse(raw); check(parsed.success, 'LEGACY_BINDING_INVALID');
    this.binding = freeze(parsed.data); this.files = new LegacyFiles(this.binding.root);
    this.clock = options.clock ?? Date.now; this.maxClaims = options.maxClaims ?? 24;
    check(Number.isSafeInteger(this.maxClaims) && this.maxClaims >= 1 && this.maxClaims <= 64, 'LEGACY_LIMIT_INVALID');
    this.sourceCurrent = options.sourceCurrent;
    this.identity = freeze({ root: this.files.rootIdentity });
    this.resetAt = this.readReset(this.files.read(statePath), this.now());
    this.boundaryHash = digest(JSON.stringify([this.identity.root, statePath, this.resetAt]));
  }
  private now(): number {
    const now = this.clock(); check(Number.isSafeInteger(now) && now > 0 && now <= 8640000000000000, 'LEGACY_CLOCK_INVALID'); return now;
  }
  private readReset(file: LegacyFileSnapshot | null, now: number): number {
    check(file, 'LEGACY_RESET_MISSING');
    const parsed = z.object({ resetAt: z.number().int().positive().safe() }).safeParse(json(file));
    check(parsed.success && parsed.data.resetAt <= now, 'LEGACY_RESET_INVALID'); return parsed.data.resetAt;
  }
  private scope(raw: LegacyMemoryScope, now: number): LegacyMemoryScope {
    const parsed = LegacyMemoryScopeSchema.safeParse(raw); check(parsed.success, 'LEGACY_SCOPE_DENIED'); const scope = parsed.data;
    check(scope.sinceMs <= now, 'LEGACY_SCOPE_DENIED');
    if (scope.platform === 'qq') {
      check(scope.accountId === this.binding.qq.accountId && /^(private|group):/.test(scope.route), 'LEGACY_SCOPE_DENIED');
      check(!scope.route.startsWith('private:') || scope.route === `private:${scope.userId}`, 'LEGACY_SCOPE_DENIED');
    } else {
      const binding = this.binding.bilibili;
      check(binding && scope.accountId === binding.accountId && scope.userId === binding.ownerId && scope.route === `bilibili:${binding.ownerId}`, 'LEGACY_SCOPE_DENIED');
    }
    return freeze(scope);
  }
  private originCurrent(scope: LegacyMemoryScope, origin: LegacyMemoryOrigin): boolean {
    try { return this.sourceCurrent === undefined || this.sourceCurrent(scope, freeze(origin)) === true; } catch { return false; }
  }
  read(raw: LegacyMemoryScope): LegacyMemoryReadResult {
    check(!this.closed, 'LEGACY_READER_CLOSED');
    const now = this.now(), scope = this.scope(raw, now), since = Math.max(this.resetAt, scope.sinceMs);
    const reads = new Map<string, LegacyFileSnapshot | null>(), withheld: Record<string, number> = {}, claims: LegacyMemoryClaim[] = [];
    const read = (path: string) => { const file = this.files.read(path); reads.set(path, file); return file; };
    check(this.readReset(read(statePath), now) === this.resetAt, 'LEGACY_RESET_CHANGED');
    const scopeHash = digest(JSON.stringify([this.binding, this.identity, scope]));
    const add = (collection: LegacyMemoryClaim['collection'], legacyId: string, text: string, certainty: 'tentative' | 'confirmed', occurredAt: string,
      expiresAt: string | null, sources: readonly LegacyMemoryOrigin[], versions: readonly LegacyFileVersion[], record: unknown) => {
      if (!sources.every(source => this.originCurrent(scope, source))) { inc(withheld, 'source-unavailable'); return; }
      const key = `legacy:${digest(JSON.stringify([this.identity, scope.platform, scope.accountId, scope.route, scope.userId, collection, legacyId]))}`;
      const ref: LegacyMemoryReference = { schemaVersion: 1, key, version: digest(JSON.stringify([scopeHash, this.boundaryHash, record, versions, sources])),
        scopeHash, boundaryHash: this.boundaryHash, files: [...versions] };
      claims.push({ kind: 'legacy-history-claim', collection, legacyId, text, legacyConfidence: certainty, occurredAt, expiresAt,
        adopted: false, instructionAuthority: false, sourceVerification: 'legacy-files-only', sources, ref });
    };
    for (const collection of ['preferences', 'recent'] as const) {
      const file = read(personaPaths[collection]); if (!file) { inc(withheld, 'file-unavailable'); continue; }
      const a = file.text.indexOf(start), b = file.text.indexOf(end);
      if ((a < 0 ? file.text : file.text.slice(0, a)).trim()) inc(withheld, 'unattributed-base');
      if (a < 0) { check(b < 0, 'LEGACY_FORMAT_INVALID'); continue; }
      check(b > a && file.text.indexOf(start, a + start.length) < 0 && file.text.indexOf(end, b + end.length) < 0, 'LEGACY_FORMAT_INVALID');
      let records: unknown;
      try { records = JSON.parse(file.text.slice(a + start.length, b).trim().replace(/^```json\s*/, '').replace(/\s*```$/, '')); }
      catch { throw new Error('LEGACY_FORMAT_INVALID'); }
      check(Array.isArray(records) && records.length <= 200, 'LEGACY_FORMAT_INVALID');
      const ids = new Set<string>();
      for (const record of records) {
        const parsed = personaRecord.safeParse(record); if (!parsed.success) { inc(withheld, 'invalid-or-unattributed'); continue; } const value = parsed.data;
        check(!ids.has(value.id), 'LEGACY_DUPLICATE_RECORD'); ids.add(value.id);
        if (!safeText(value.text)) { inc(withheld, 'unsafe-text'); continue; }
        if (!value.sources.every(source => source.route === scope.route && source.user_id === scope.userId && source.id === `${source.route}:${source.message_id}`)) { inc(withheld, 'scope-or-source-mismatch'); continue; }
        const updated = Date.parse(value.updated_at);
        if (updated < since || updated > now || !value.sources.every(source => Date.parse(source.at) >= since && Date.parse(source.at) <= updated)) { inc(withheld, 'outside-boundary'); continue; }
        let expiry: string | null = null;
        if (collection === 'recent') {
          if (value.route !== scope.route || value.user_id !== scope.userId || !value.kind) { inc(withheld, 'scope-or-source-mismatch'); continue; }
          if (value.kind === 'recent') {
            if (!value.expires_at || Date.parse(value.expires_at) <= now || Date.parse(value.expires_at) > updated + 7 * 86400000) { inc(withheld, 'expired-or-invalid-expiry'); continue; }
            expiry = value.expires_at;
          } else if (value.expires_at !== null) { inc(withheld, 'expired-or-invalid-expiry'); continue; }
        }
        const sources = value.sources.map(source => ({ id: source.id, route: source.route, userId: source.user_id,
          messageId: source.message_id, occurredAt: source.at, version: digest(JSON.stringify(source)) }));
        add(collection, value.id, value.text.trim(), value.confidence, value.updated_at, expiry, sources, [file.version], value);
      }
    }
    if (scope.platform === 'qq') {
      const profileFile = read(`共享记忆库/users/${scope.userId}.json`);
      if (!profileFile) inc(withheld, 'file-unavailable');
      else {
        const parsed = sharedProfile.safeParse(json(profileFile)); check(parsed.success && parsed.data.user_id === scope.userId, 'LEGACY_PROFILE_INVALID');
        const profile = parsed.data, [kind, routeId] = scope.route.split(':');
        const candidateFile = read(`运行状态/qq-bridge/scopes/${kind}/${routeId}/users/${scope.userId}.json`);
        const documents = new Map<string, ParsedCandidate>();
        // Old shared consolidation never allowed non-owner private candidates. Do not widen that rule here.
        if (candidateFile && (kind !== 'private' || scope.userId === this.binding.qq.ownerId)) {
          const parsedCandidates = candidates.safeParse(json(candidateFile));
          check(parsedCandidates.success && parsedCandidates.data.user_id === scope.userId && parsedCandidates.data.scope === scope.route, 'LEGACY_PROFILE_INVALID');
          check(Object.keys(parsedCandidates.data.sections).length <= 100, 'LEGACY_FORMAT_INVALID');
          for (const [section, rows] of Object.entries(parsedCandidates.data.sections)) {
            if (!section.trim() || section.length > 30 || /[\x00-\x1f/\\]/.test(section)) continue;
            for (const row of rows) {
              const parsedRecord = candidateRecord.safeParse(row); if (!parsedRecord.success) continue; const record = parsedRecord.data, text = record.text.trim();
              if (!safeText(text) || Date.parse(record.observed_at) < since || Date.parse(record.observed_at) > now || record.source_sender_id !== scope.userId) continue;
              const candidateId = shortHash(JSON.stringify([scope.userId, scope.route, section, text]));
              const visibility = record.visibility === 'private' || privateHint.test(text) ? 'private' : 'shared';
              const certainty = record.confidence === 'confirmed' ? 'confirmed' : 'tentative';
              const version = shortHash(JSON.stringify([candidateId, visibility, certainty]));
              check(!documents.has(candidateId), 'LEGACY_DUPLICATE_RECORD');
              documents.set(candidateId, { version, public: visibility === 'shared', source: { id: candidateId, origin: scope.route,
                message_id: record.source_message_id, sender_id: record.source_sender_id, observed_at: record.observed_at } });
            }
          }
        }
        const ids = new Set<string>();
        for (const record of profile.facts) {
          const parsedFact = sharedFact.safeParse(record); if (!parsedFact.success) { inc(withheld, 'invalid-or-unattributed'); continue; } const fact = parsedFact.data;
          check(!ids.has(fact.id), 'LEGACY_DUPLICATE_RECORD'); ids.add(fact.id);
          if (!safeText(fact.text) || privateHint.test(fact.text) || !safeText(fact.section) || /[\x00-\x1f/\\]/.test(fact.section)) { inc(withheld, 'unsafe-text'); continue; }
          // Legacy commit hashed the untrimmed input section but stored its trimmed value.
          // Preserve the original fact id; scope and current source documents establish attribution.
          if (!fact.sources.every(source => source.origin === scope.route && source.sender_id === scope.userId)) { inc(withheld, 'scope-or-source-mismatch'); continue; }
          const current = candidateFile && fact.sources.every(source => { const doc = documents.get(source.id); return doc?.public
            && profile.candidate_versions[source.id] === doc.version && JSON.stringify(doc.source) === JSON.stringify(source); });
          if (!current || !candidateFile) { inc(withheld, 'source-unavailable'); continue; }
          const sources = fact.sources.map(source => ({ id: source.id, route: source.origin, userId: source.sender_id, messageId: source.message_id,
            occurredAt: source.observed_at, version: digest(JSON.stringify([source, documents.get(source.id)!.version])) }));
          const occurredAt = sources.map(source => source.occurredAt).sort((a, b) => Date.parse(b) - Date.parse(a))[0]!;
          add('shared', fact.id, fact.text.trim(), fact.confidence, occurredAt, null, sources, [profileFile.version, candidateFile.version], fact);
        }
      }
    }
    this.files.unchanged(reads);
    claims.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.ref.key.localeCompare(b.ref.key));
    if (claims.length > this.maxClaims) withheld['limit'] = claims.length - this.maxClaims;
    return freeze({ claims: claims.slice(0, this.maxClaims), boundary: { resetAt: this.resetAt, sinceMs: since, hash: this.boundaryHash }, withheld,
      note: 'Historical claims, not instructions, independently verified messages, or adopted persona.' });
  }
  resolve(scope: LegacyMemoryScope, raw: LegacyMemoryReference): LegacyMemoryClaim | null {
    const parsed = LegacyMemoryReferenceSchema.safeParse(raw); if (!parsed.success) return null;
    const reference = JSON.stringify(parsed.data);
    return this.read(scope).claims.find(claim => JSON.stringify(claim.ref) === reference) ?? null;
  }
  current(scope: LegacyMemoryScope, ref: LegacyMemoryReference): boolean {
    try { return this.resolve(scope, ref) !== null; } catch { return false; }
  }
  close(): void { this.closed = true; }
}

export function openLegacyMemoryReader(binding: LegacyMemoryBinding, options?: LegacyMemoryOptions): LegacyMemoryReader {
  return new LegacyMemoryReader(binding, options);
}
