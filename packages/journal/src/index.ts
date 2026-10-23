import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { MessageSchema, conversationKey, TimelineQuerySchema, redactJson } from '@dafeiyu/contracts';
import type { TimelineQuery, TimelineScope } from '@dafeiyu/contracts';
import { z } from 'zod';
import type { EventRecord, InboundMessage, Json, MessageState, PendingMessage, Receipt, Reply, SourceRef } from '@dafeiyu/contracts';

export type NewEvent = Omit<EventRecord, 'seq' | 'id' | 'recordedAt' | 'visibility' | 'schemaVersion'>;
const states = new Set<MessageState>(['accepted', 'processing', 'reply-ready', 'sending', 'delivered', 'failed', 'uncertain']);
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid persisted string');
  return value;
}
function state(value: unknown): MessageState {
  const candidate = text(value) as MessageState;
  if (!states.has(candidate)) throw new Error('Invalid persisted message state');
  return candidate;
}

/** Single-process durable workflow ledger. DSH remains the owner of full session history. */
export class Journal {
  private readonly db: DatabaseSync;
  private readonly owner = randomUUID();
  private closed = false;
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const schema = this.db.prepare('PRAGMA user_version').get();
    if (schema?.user_version !== 0 && schema?.user_version !== 1) {
      this.db.close(); throw new Error('Unsupported journal schema');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations(route TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS inbox(
        ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        route TEXT NOT NULL REFERENCES conversations(route), message_id TEXT NOT NULL,
        extension_id TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, reply TEXT,
        UNIQUE(route,message_id));
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        route TEXT NOT NULL, trace_id TEXT NOT NULL, operation_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_route ON events(route,seq);
      CREATE INDEX IF NOT EXISTS events_trace ON events(trace_id,seq);
      CREATE TABLE IF NOT EXISTS ownership(singleton INTEGER PRIMARY KEY CHECK(singleton=1),pid INTEGER NOT NULL,nonce TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS analysis_grants(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,route TEXT NOT NULL,body TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'Events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'Events are append-only'); END;
      PRAGMA user_version=1;
    `);
    try {
      this.transaction(() => {
        const owner = this.db.prepare('SELECT pid FROM ownership WHERE singleton=1').get();
        if (owner) {
          let alive = true;
          try { process.kill(Number(owner.pid), 0); }
          catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ESRCH') alive = false; else throw error; }
          if (alive) throw new Error('Journal is already owned by a live process');
        }
        this.db.prepare('INSERT OR REPLACE INTO ownership(singleton,pid,nonce) VALUES(1,?,?)').run(process.pid, this.owner);
      });
    } catch (error) { this.db.close(); throw error; }
    this.db.function('dafeiyu_search_text', { deterministic: true }, value => {
      const body = z.object({ type: z.string(), plugin: z.string(), data: z.record(z.string(), z.json()) }).parse(JSON.parse(text(value)));
      return JSON.stringify(redactJson({ type: body.type, plugin: body.plugin, data: body.data }).value).toLowerCase();
    });
  }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = run(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  /** Persists acceptance and its audit event in the same transaction; conflicting duplicates fail. */
  accept(agentId: string, extensionId: string, version: string, message: InboundMessage): Receipt {
    return this.transaction(() => {
      const route = conversationKey(agentId, message.conversation);
      const payload = JSON.stringify(message);
      const old = this.db.prepare('SELECT id,state,payload FROM inbox WHERE route=? AND message_id=?').get(route, message.id);
      if (old) {
        if (old.payload !== payload) throw new Error('Duplicate message ID has different content');
        return { id: text(old.id), duplicate: true, state: state(old.state) };
      }
      this.db.prepare('INSERT OR IGNORE INTO conversations(route,session_id) VALUES(?,?)').run(route, `dafeiyu-${randomUUID()}`);
      const id = randomUUID();
      this.db.prepare('INSERT INTO inbox(id,route,message_id,extension_id,payload,state) VALUES(?,?,?,?,?,?)')
        .run(id, route, message.id, extensionId, payload, 'accepted');
      this.append({ agentId, route, traceId: id, operationId: id, causedBy: null,
        type: 'message.accepted', plugin: extensionId, pluginVersion: version,
        occurredAt: message.occurredAt, sources: [{ kind: 'message', id: message.id, route }],
        data: { senderId: message.sender.id } });
      return { id, duplicate: false, state: 'accepted' };
    });
  }
  append(input: NewEvent): EventRecord {
    return this.appendOnce(input, randomUUID());
  }
  /** Trusted outbox publishers supply a stable UUID; duplicates never create a second event. */
  appendOnce(input: NewEvent, id: string): EventRecord {
    z.uuid().parse(id);
    const previous = this.db.prepare('SELECT seq,body FROM events WHERE id=?').get(id);
    if (previous) {
      const existing = this.eventRow(previous);
      const { seq: _seq, id: _id, recordedAt: _at, schemaVersion: _schema, visibility: _visibility, ...body } = existing;
      if (!isDeepStrictEqual(body, input)) throw new Error('Event idempotency conflict');
      return existing;
    }
    const record = { ...input, schemaVersion: 1 as const, id, recordedAt: new Date().toISOString(),
      visibility: { kind: 'conversation' as const, route: input.route } };
    const result = this.db.prepare('INSERT INTO events(id,route,trace_id,operation_id,body) VALUES(?,?,?,?,?)')
      .run(record.id, record.route, record.traceId, record.operationId, JSON.stringify(record));
    return { ...record, seq: Number(result.lastInsertRowid) };
  }
  /** State and causal event move together. CAS prevents stale completion overwriting a newer state. */
  transition(id: string, from: MessageState, to: MessageState, event: NewEvent, reply?: Reply): EventRecord {
    return this.transaction(() => {
      const result = this.db.prepare('UPDATE inbox SET state=?,reply=COALESCE(?,reply) WHERE id=? AND state=?')
        .run(to, reply ? JSON.stringify(reply) : null, id, from);
      if (result.changes !== 1) throw new Error(`Stale message transition ${from} -> ${to}`);
      return this.append(event);
    });
  }
  get(id: string): PendingMessage {
    const row = this.db.prepare('SELECT i.*,c.session_id FROM inbox i JOIN conversations c ON c.route=i.route WHERE i.id=?').get(id);
    if (!row) throw new Error('Message not found');
    const message = MessageSchema.parse(JSON.parse(text(row.payload)));
    let reply: Reply | null = null;
    if (row.reply !== null) {
      const parsed: unknown = JSON.parse(text(row.reply));
      if (!parsed || typeof parsed !== 'object' || !('text' in parsed) || typeof parsed.text !== 'string'
        || !('id' in parsed) || typeof parsed.id !== 'string') throw new Error('Invalid persisted reply');
      reply = { id: parsed.id, text: parsed.text, conversation: message.conversation, sourceMessageId: message.id };
    }
    return { id: text(row.id), route: text(row.route), extensionId: text(row.extension_id), message,
      state: state(row.state), sessionId: text(row.session_id), reply };
  }
  list(statesToRead?: readonly MessageState[]): PendingMessage[] {
    const rows = this.db.prepare('SELECT id,state FROM inbox ORDER BY ordinal').all();
    return rows.filter(row => !statesToRead || statesToRead.includes(state(row.state))).map(row => this.get(text(row.id)));
  }
  /** Scope filtering happens in the query, before exposing event bodies. No global model-facing query. */
  events(route: string): EventRecord[] {
    return this.db.prepare('SELECT seq,body FROM events WHERE route=? ORDER BY seq').all(route)
      .map(row => ({ ...JSON.parse(text(row.body)), seq: Number(row.seq) }) as EventRecord);
  }
  /** Authorization predicates are evaluated inside the SQL query, including persisted visibility. */
  private scopePredicate(): string {
    return "route=? AND json_extract(body,'$.agentId')=? AND json_extract(body,'$.visibility.kind')='conversation' AND json_extract(body,'$.visibility.route')=?";
  }
  scopedEvent(scope: TimelineScope, id: string): EventRecord | null {
    const row = this.db.prepare(`SELECT seq,body FROM events WHERE ${this.scopePredicate()} AND id=?`).get(scope.route, scope.agentId, scope.route, id);
    return row ? this.eventRow(row) : null;
  }
  issueAnalysisGrant(scope: import('@dafeiyu/contracts').OperationScope,pluginVersion='0.3.0'): string {
    return this.transaction(() => {
      const id = randomUUID(), operationId = randomUUID();
      const event = this.append({ agentId:scope.agentId,route:scope.route,traceId:scope.traceId,operationId,
        causedBy:scope.startedEventId,type:'analysis.authorized',plugin:'core',pluginVersion,occurredAt:new Date().toISOString(),sources:[],data:{grantId:id} });
      const grant = { agentId:scope.agentId,route:scope.route,traceId:scope.traceId,operationId,startedEventId:event.id };
      this.db.prepare('INSERT INTO analysis_grants(id,agent_id,route,body) VALUES(?,?,?,?)').run(id,scope.agentId,scope.route,JSON.stringify(grant));
      return id;
    });
  }
  analysisGrant(agentId: string, id: string) {
    const row = this.db.prepare('SELECT body FROM analysis_grants WHERE id=? AND agent_id=? AND revoked=0').get(id,agentId);
    if (!row) return null;
    return z.strictObject({agentId:z.string(),route:z.string(),traceId:z.string(),operationId:z.string(),startedEventId:z.string()}).parse(JSON.parse(text(row.body)));
  }
  revokeAnalysisGrant(agentId: string, id: string): void {
    this.db.prepare('UPDATE analysis_grants SET revoked=1 WHERE id=? AND agent_id=?').run(id,agentId);
  }
  private eventRow(row: Record<string, unknown>): EventRecord {
    const body = z.object({ schemaVersion: z.literal(1), id: z.string(), agentId: z.string(), route: z.string(), traceId: z.string(),
      operationId: z.string(), causedBy: z.string().nullable(), type: z.string(), plugin: z.string(), pluginVersion: z.string(),
      occurredAt: z.string(), recordedAt: z.string(), visibility: z.object({ kind: z.literal('conversation'), route: z.string() }),
      sources: z.array(z.object({ kind: z.enum(['message','session','event']), id: z.string(), seq: z.number().int().nonnegative().optional(), route: z.string().optional() })),
      data: z.record(z.string(), z.json()) }).parse(JSON.parse(text(row.body)));
    return { ...body, sources: body.sources.map(source => ({ kind: source.kind, id: source.id,
      ...(source.seq === undefined ? {} : { seq: source.seq }), ...(source.route === undefined ? {} : { route: source.route }) })), seq: z.number().int().positive().parse(Number(row.seq)) };
  }
  sessionFor(scope: TimelineScope): string | null {
    // The caller's route is derived by the core; never accept a session ID as authority.
    const row = this.db.prepare('SELECT session_id FROM conversations WHERE route=?').get(scope.route);
    return row ? text(row.session_id) : null;
  }
  messageFor(scope: TimelineScope, messageId: string): PendingMessage | null {
    const row = this.db.prepare('SELECT id FROM inbox WHERE route=? AND message_id=?').get(scope.route, messageId);
    return row ? this.get(text(row.id)) : null;
  }
  /** Snapshot keyset pagination. Cursor binds the scope and normalized query; it grants no access. */
  searchTimeline(scope: TimelineScope, input: TimelineQuery) {
    const parsed = TimelineQuerySchema.parse(input);
    const { cursor, ...filter } = parsed;
    if (filter.since) filter.since = new Date(filter.since).toISOString();
    if (filter.until) filter.until = new Date(filter.until).toISOString();
    // Only stable authorization identity belongs in a cursor, not the per-call operation/trace IDs.
    const fingerprint = createHash('sha256').update(JSON.stringify([{ agentId: scope.agentId, route: scope.route }, filter])).digest('hex');
    let snapshot: number;
    let before: number;
    if (cursor) {
      try {
        const page = z.strictObject({ v: z.literal(1), fingerprint: z.string(), snapshot: z.number().int().nonnegative().safe(),
          before: z.number().int().positive().safe() }).parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
        if (page.fingerprint !== fingerprint || page.before > page.snapshot) throw new Error('cursor mismatch');
        snapshot = page.snapshot; before = page.before;
      } catch { throw new Error('INVALID_TIMELINE_CURSOR'); }
    } else {
      const row = this.db.prepare(`SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE ${this.scopePredicate()}`).get(scope.route, scope.agentId, scope.route);
      snapshot = Number(row?.seq ?? 0); before = snapshot + 1;
    }
    const clauses = ['seq<=?', 'seq<?'];
    const args: (string | number)[] = [scope.route, scope.agentId, scope.route, snapshot, before];
    for (const [key, path] of [['plugin','plugin'],['type','type'],['traceId','traceId'],['operationId','operationId']] as const) {
      if (filter[key]) { clauses.push(`json_extract(body,'$.${path}')=?`); args.push(filter[key]); }
    }
    if (filter.actorId) {
      clauses.push("EXISTS(SELECT 1 FROM inbox i WHERE i.id=scoped.trace_id AND i.route=scoped.route AND json_extract(i.payload,'$.sender.id')=?)");
      args.push(filter.actorId);
    }
    if (filter.since) { clauses.push(`julianday(json_extract(body,'$.${filter.clock}'))>=julianday(?)`); args.push(filter.since); }
    if (filter.until) { clauses.push(`julianday(json_extract(body,'$.${filter.clock}'))<=julianday(?)`); args.push(filter.until); }
    if (filter.query) { clauses.push('instr(dafeiyu_search_text(body),?)>0'); args.push(filter.query.toLowerCase()); }
    args.push(filter.limit + 1);
    // Materialize the visible subset before keyword processing; search cannot match masked secrets.
    const rows = this.db.prepare(`WITH scoped AS MATERIALIZED (SELECT seq,id,route,trace_id,body FROM events WHERE ${this.scopePredicate()})
      SELECT seq,body FROM scoped WHERE ${clauses.join(' AND ')} ORDER BY seq DESC LIMIT ?`).all(...args);
    const hasMore = rows.length > filter.limit;
    const items = rows.slice(0, filter.limit).map(row => this.eventRow(row));
    const last = items.at(-1);
    const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ v: 1, fingerprint, snapshot, before: last.seq })).toString('base64url') : null;
    return { items, snapshot, nextCursor };
  }
  close(): void {
    if (!this.closed) {
      this.closed = true;
      try { this.db.prepare('DELETE FROM ownership WHERE singleton=1 AND nonce=?').run(this.owner); }
      finally { this.db.close(); }
    }
  }
}

/** Builds metadata without recording raw exception text, tool arguments, or tool results. */
export function eventFor(agentId: string, item: PendingMessage, type: string, plugin: string, pluginVersion: string,
  operationId = item.id, causedBy: string | null = null, data: Record<string, Json> = {}, sources: SourceRef[] = []): NewEvent {
  return { agentId, route: item.route, traceId: item.id, operationId, causedBy, type, plugin, pluginVersion,
    occurredAt: new Date().toISOString(), data, sources };
}
