import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MessageSchema, conversationKey } from '@dafeiyu/contracts';
import type { EventRecord, InboundMessage, Json, MessageState, PendingMessage, Receipt, Reply, SourceRef } from '@dafeiyu/contracts';

type NewEvent = Omit<EventRecord, 'seq' | 'id' | 'recordedAt' | 'visibility' | 'schemaVersion'>;
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
        occurredAt: message.occurredAt, sources: [{ kind: 'message', id: message.id }],
        data: { senderId: message.sender.id } });
      return { id, duplicate: false, state: 'accepted' };
    });
  }
  append(input: NewEvent): EventRecord {
    const record = { ...input, schemaVersion: 1 as const, id: randomUUID(), recordedAt: new Date().toISOString(),
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
