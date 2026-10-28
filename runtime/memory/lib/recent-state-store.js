import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { RecentStateRecordSchema, RecentStateSaveSchema, RecentStatePublishSchema, RecentStateUnpublishSchema, ContextItemSchema, redactJson } from '#dafeiyu/contracts';
import { personaScope } from './persona-digest.js';
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const publicationSchema = z.strictObject({ id: z.uuid(), stateId: z.uuid(), stateVersion: z.number().int().positive(), view: z.string().max(800), viewHash: z.string(),
    topics: z.array(z.string().max(80)).max(16), policy: z.literal('self-summary-v1'), reviewHash: z.string(), createdAt: z.iso.datetime() });
export const RECENT_STATE_TABLES = ['recent_self_states', 'recent_state_revisions', 'recent_state_requests', 'recent_state_publications'];
export function verifyRecentStateSchema(db) {
    db.prepare('SELECT id,agent_id,scope_key,version,body FROM recent_self_states LIMIT 0').all();
    db.prepare('SELECT id,version,body FROM recent_state_revisions LIMIT 0').all();
    db.prepare('SELECT agent_id,request_id,fingerprint,receipt FROM recent_state_requests LIMIT 0').all();
    db.prepare('SELECT id,state_id,state_version,body,withdrawn FROM recent_state_publications LIMIT 0').all();
    for (const [name, message] of [['recent_state_revision_immutable', 'Immutable recent state revision'], ['recent_state_revision_retain', 'Retain recent state revision'], ['recent_publication_immutable', 'Immutable recent publication'], ['recent_publication_retain', 'Retain recent publication']]) {
        const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name);
        if (!row || !String(row.sql).includes("RAISE(ABORT,'" + message + "')"))
            throw new Error('Unsupported recent state guard');
    }
}
export function migrateRecentState(db) {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if (version === 13) {
        verifyRecentStateSchema(db);
        return;
    }
    if (version !== 12)
        throw new Error('Unsupported recent state database');
    db.exec(`CREATE TABLE recent_self_states(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL);
    CREATE INDEX recent_state_scope ON recent_self_states(agent_id,scope_key);
    CREATE TABLE recent_state_revisions(id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(id,version));
    CREATE TRIGGER recent_state_revision_immutable BEFORE UPDATE ON recent_state_revisions BEGIN SELECT RAISE(ABORT,'Immutable recent state revision'); END;
    CREATE TRIGGER recent_state_revision_retain BEFORE DELETE ON recent_state_revisions BEGIN SELECT RAISE(ABORT,'Retain recent state revision'); END;
    CREATE TABLE recent_state_requests(agent_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,request_id));
    CREATE TABLE recent_state_publications(id TEXT PRIMARY KEY,state_id TEXT NOT NULL,state_version INTEGER NOT NULL,body TEXT NOT NULL,withdrawn INTEGER NOT NULL DEFAULT 0 CHECK(withdrawn IN (0,1)));
    CREATE INDEX recent_state_publication ON recent_state_publications(state_id,state_version);
    CREATE TRIGGER recent_publication_immutable BEFORE UPDATE OF id,state_id,state_version,body ON recent_state_publications BEGIN SELECT RAISE(ABORT,'Immutable recent publication'); END;
    CREATE TRIGGER recent_publication_retain BEFORE DELETE ON recent_state_publications BEGIN SELECT RAISE(ABORT,'Retain recent publication'); END;
    PRAGMA user_version=13;`);
    db.prepare('INSERT INTO memory_schema_migrations VALUES(13,?,0,?)').run(new Date().toISOString(), 'add-versioned-recent-self-state-without-changing-memory-or-persona');
}
/** Mutable attention belongs to Growth. No Task completion or personality adoption is written here. */
export class RecentStateStore {
    db;
    transaction;
    current;
    constructor(db, transaction, current) {
        this.db = db;
        this.transaction = transaction;
        this.current = current;
    }
    load(agent, id) { const row = this.db.prepare('SELECT body FROM recent_self_states WHERE agent_id=? AND id=?').get(agent, id); return row ? RecentStateRecordSchema.parse(JSON.parse(String(row.body))) : null; }
    request(agent, key, input, work) {
        return this.transaction(() => {
            const fingerprint = hash(input), old = this.db.prepare('SELECT fingerprint,receipt FROM recent_state_requests WHERE agent_id=? AND request_id=?').get(agent, key);
            if (old) {
                if (old.fingerprint !== fingerprint)
                    throw new Error('IDEMPOTENCY_CONFLICT');
                return JSON.parse(String(old.receipt));
            }
            const result = work();
            this.db.prepare('INSERT INTO recent_state_requests VALUES(?,?,?,?)').run(agent, key, fingerprint, JSON.stringify(result));
            return result;
        });
    }
    save(access, raw, sources) {
        access.guard();
        const input = RecentStateSaveSchema.parse(raw), scope = access.view.scope;
        const expiry = Date.parse(input.expiresAt);
        if (input.status === 'active' && (expiry <= Date.now() || expiry > Date.now() + 30 * 86400000))
            throw new Error('INVALID_INPUT');
        if (redactJson(z.json().parse(input)).redacted)
            throw new Error('PRIVATE_INPUT_REJECTED');
        return this.request(scope.agentId, `${access.view.runId}:save:${input.requestId}`, input, () => {
            const old = input.id ? this.load(scope.agentId, input.id) : null;
            if (input.id && !old)
                throw new Error('SOURCE_STALE');
            if (old && personaScope(old.scope) !== personaScope(scope))
                throw new Error('SCOPE_DENIED');
            if ((old?.version ?? 0) !== input.expectedVersion)
                throw new Error('VERSION_CONFLICT');
            if (!sources.length || !this.current(access.view.runId, sources))
                throw new Error('SOURCE_STALE');
            const at = new Date().toISOString(), record = RecentStateRecordSchema.parse({ schemaVersion: 1, id: old?.id ?? randomUUID(), version: (old?.version ?? 0) + 1,
                scope, runId: access.view.runId, operationId: access.operationId, text: input.text, topics: input.topics, motivation: input.motivation, status: input.status,
                originMotivation: access.motivation.kind, expiresAt: input.expiresAt, createdAt: old?.createdAt ?? at, updatedAt: at, sources, claimType: 'self_report' });
            access.guard();
            this.db.prepare('INSERT INTO recent_state_revisions VALUES(?,?,?)').run(record.id, record.version, JSON.stringify(record));
            this.db.prepare('INSERT INTO recent_self_states VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,body=excluded.body').run(record.id, scope.agentId, personaScope(scope), record.version, JSON.stringify(record));
            this.audit(access, 'recent-state.saved', { id: record.id, version: record.version, status: record.status });
            return { id: record.id, version: record.version, status: record.status, scope: 'origin', personalityAdopted: false };
        });
    }
    read(access, id) { access.guard(); const row = this.load(access.view.scope.agentId, id); if (!row || personaScope(row.scope) !== personaScope(access.view.scope))
        throw new Error('SCOPE_DENIED'); return row; }
    list(scope) { return this.db.prepare('SELECT body FROM recent_self_states WHERE agent_id=? AND scope_key=? ORDER BY rowid DESC LIMIT 32').all(scope.agentId, personaScope(scope)).map(row => RecentStateRecordSchema.parse(JSON.parse(String(row.body)))); }
    publish(access, raw, review, policyEnabled) {
        access.guard();
        const input = RecentStatePublishSchema.parse(raw);
        if (!policyEnabled)
            throw new Error('SCOPE_DENIED');
        return this.request(access.view.scope.agentId, `${access.view.runId}:publish:${input.requestId}`, input, () => {
            const row = this.read(access, input.id);
            if (row.version !== input.expectedVersion)
                throw new Error('VERSION_CONFLICT');
            if (row.status !== 'active' || Date.parse(row.expiresAt) <= Date.now() || !this.current(row.runId, row.sources))
                throw new Error('SOURCE_STALE');
            if (redactJson(input.view).redacted)
                throw new Error('PRIVATE_INPUT_REJECTED');
            const topics = [...new Set([...new Intl.Segmenter('zh', { granularity: 'word' }).segment(input.view)].filter(part => part.isWordLike && part.segment.length > 1 && !['最近', '自己', '一些', '现在'].includes(part.segment)).map(part => part.segment.slice(0, 80)))].slice(0, 16);
            const publication = publicationSchema.parse({ id: randomUUID(), stateId: row.id, stateVersion: row.version, view: input.view, viewHash: hash(input.view), topics, policy: 'self-summary-v1', reviewHash: hash(review), createdAt: new Date().toISOString() });
            this.db.prepare('UPDATE recent_state_publications SET withdrawn=1 WHERE state_id=? AND withdrawn=0').run(row.id);
            this.db.prepare('INSERT INTO recent_state_publications(id,state_id,state_version,body) VALUES(?,?,?,?)').run(publication.id, row.id, row.version, JSON.stringify(publication));
            this.audit(access, 'recent-state.published', { id: row.id, version: row.version, publication: publication.id });
            return { id: row.id, version: row.version, publication: publication.id, scope: 'qualified-self-summary', rawSourcesShared: false };
        });
    }
    published(scope) {
        return this.db.prepare('SELECT p.body,s.body AS state FROM recent_state_publications p JOIN recent_self_states s ON s.id=p.state_id AND s.version=p.state_version WHERE s.agent_id=? AND p.withdrawn=0 ORDER BY p.rowid DESC LIMIT 32').all(scope.agentId).flatMap(row => {
            const state = RecentStateRecordSchema.parse(JSON.parse(String(row.state))), publication = publicationSchema.parse(JSON.parse(String(row.body)));
            return state.status === 'active' && Date.parse(state.expiresAt) > Date.now() && this.current(state.runId, state.sources) ? [{ publication: publication.id, id: state.id, version: state.version, view: publication.view, expiresAt: state.expiresAt, claimType: 'self_report' }] : [];
        });
    }
    unpublish(access, raw, shared) {
        access.guard();
        const input = RecentStateUnpublishSchema.parse(raw);
        return this.request(access.view.scope.agentId, `${access.view.runId}:unpublish:${input.requestId}`, input, () => {
            const row = this.db.prepare('SELECT p.state_id,p.state_version,s.scope_key FROM recent_state_publications p JOIN recent_self_states s ON s.id=p.state_id WHERE p.id=? AND s.agent_id=?').get(input.publication, access.view.scope.agentId);
            if (!row || !shared && row.scope_key !== personaScope(access.view.scope))
                throw new Error('SCOPE_DENIED');
            if (Number(row.state_version) !== input.expectedVersion)
                throw new Error('VERSION_CONFLICT');
            this.db.prepare('UPDATE recent_state_publications SET withdrawn=1 WHERE id=?').run(input.publication);
            this.audit(access, 'recent-state.unpublished', { publication: input.publication });
            return { publication: input.publication, withdrawn: true, originRecordChanged: false };
        });
    }
    prepare(scope, query, shared, limit) {
        const own = this.list(scope), candidates = own.map(state => ({ state, view: state.text, publication: null }));
        if (shared)
            for (const row of this.db.prepare('SELECT p.body,s.body AS state FROM recent_state_publications p JOIN recent_self_states s ON s.id=p.state_id AND s.version=p.state_version WHERE s.agent_id=? AND s.scope_key<>? AND p.withdrawn=0 ORDER BY p.rowid DESC LIMIT 32').all(scope.agentId, personaScope(scope))) {
                const state = RecentStateRecordSchema.parse(JSON.parse(String(row.state))), publication = publicationSchema.parse(JSON.parse(String(row.body)));
                // Cross-scene selection may only use the approved public view, not private topic labels.
                if (!publication.topics.length || !publication.topics.some(topic => query.toLowerCase().includes(topic.toLowerCase())))
                    continue;
                if (publication.viewHash !== hash(publication.view))
                    continue;
                candidates.push({ state, view: publication.view, publication: publication.id });
            }
        const items = [], seen = new Set();
        for (const { state, view, publication } of candidates) {
            if (seen.has(state.id) || state.status !== 'active' || Date.parse(state.expiresAt) <= Date.now() || !this.current(state.runId, state.sources))
                continue;
            seen.add(state.id);
            const item = ContextItemSchema.parse({ id: 'recent-state:' + state.id, version: `${state.version}:${publication ?? 'origin'}`, expiresAt: state.expiresAt,
                text: JSON.stringify({ kind: 'recent-self-state', text: view, motivation: state.motivation, originMotivation: state.originMotivation, claimType: 'self_report', maturity: 'recent-attention', visibility: publication ? 'shared-summary' : 'origin', instructionAuthority: false,
                    note: '近期自述，未采用为稳定人格；不代表已安排任务或独立证实的世界事实。' }), sources: [{ ref: 'dafeiyu:recent-state:' + state.id, version: String(state.version), hash: hash([state.version, view, publication]) }] });
            items.push(item);
            if (Buffer.byteLength(JSON.stringify(items)) > limit)
                items.pop();
        }
        return items;
    }
    audit(access, type, data) { const id = randomUUID(); this.db.prepare('INSERT INTO persona_outbox(id,body) VALUES(?,?)').run(id, JSON.stringify({ id, type, scope: access.view.scope, runId: access.view.runId, origin: access.view.origin, operationId: access.operationId, causedBy: access.startedEventId, producer: 'memory-recent-state', at: new Date().toISOString(), data })); }
}
