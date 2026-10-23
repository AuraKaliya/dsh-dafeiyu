import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Json, OperationScope, TimelineScope } from '@dafeiyu/contracts';
import type { NewEvent } from '@dafeiyu/journal';
import { MEMORY_VERSION, MemoryError, memoryRef, receiptSchema, revisionSchema } from './types.js';
import type { Command, MutationReceipt, ReadMode, Revision, WriteContent } from './types.js';

const APPLICATION_ID = 0x44464d31;
const string = (value: unknown): string => z.string().parse(value);
const integer = (value: unknown): number => z.number().int().safe().parse(value);
function canonical(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
}
const hash = (value: unknown): string => createHash('sha256').update(canonical(z.json().parse(value))).digest('hex');
interface Item { id: string; ordinal: number; version: number; head: number; deleted: boolean; reason: string; }
export interface MemoryView extends Revision {
  readonly sourceVersions:readonly {id:string;revision:number;version:number;contentHash:string}[];
  readonly ref: string; readonly version: number; readonly latestRevision: number;
  readonly validity: 'active' | 'superseded'; readonly deleted: boolean; readonly effectivelyDeleted: boolean;
  readonly basisStatus: 'current' | 'changed' | 'deleted';
  readonly deletionReason: string | null; readonly untrustedEvidence: true;
  readonly useRestriction: 'evidence_only' | 'historical_evidence_only' | 'deleted_lookup_only';
}
export interface SearchInput { readonly query: string; readonly limit: number; readonly cursor?: string }

/** Trusted persistence API. Model-facing access must go through the core-bound MemoryService. */
export class MemoryStore {
  private readonly db: DatabaseSync;
  private closed = false;
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    try {
      const app = this.db.prepare('PRAGMA application_id').get()?.application_id;
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
      const tables = this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n;
      const fresh = app === 0 && version === 0 && tables === 0;
      if (!fresh && (app !== APPLICATION_ID || version !== 1)) throw new Error('Unsupported memory database identity or schema');
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      if (fresh) this.transaction(() => this.db.exec(`
        CREATE TABLE memory_items(ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
          agent_id TEXT NOT NULL,route TEXT NOT NULL,version INTEGER NOT NULL,head INTEGER NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),reason TEXT NOT NULL DEFAULT '');
        CREATE INDEX items_scope ON memory_items(agent_id,route,ordinal);
        CREATE TABLE memory_revisions(id TEXT NOT NULL REFERENCES memory_items(id),revision INTEGER NOT NULL,
          body TEXT NOT NULL,event_id TEXT NOT NULL,PRIMARY KEY(id,revision));
        CREATE TABLE dependencies(id TEXT NOT NULL,revision INTEGER NOT NULL,parent_id TEXT NOT NULL,parent_revision INTEGER NOT NULL,
          PRIMARY KEY(id,revision,parent_id,parent_revision),
          FOREIGN KEY(id,revision) REFERENCES memory_revisions(id,revision),
          FOREIGN KEY(parent_id,parent_revision) REFERENCES memory_revisions(id,revision));
        CREATE TABLE scope_generations(agent_id TEXT NOT NULL,route TEXT NOT NULL,generation INTEGER NOT NULL,PRIMARY KEY(agent_id,route));
        CREATE TABLE memory_events(id TEXT PRIMARY KEY,body TEXT NOT NULL,reason TEXT NOT NULL);
        CREATE TABLE outbox(event_id TEXT PRIMARY KEY REFERENCES memory_events(id),delivered INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE requests(agent_id TEXT NOT NULL,route TEXT NOT NULL,request_id TEXT NOT NULL,
          fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,route,request_id));
        CREATE TRIGGER items_no_delete BEFORE DELETE ON memory_items BEGIN SELECT RAISE(ABORT,'Use logical deletion'); END;
        CREATE TRIGGER revisions_immutable_update BEFORE UPDATE ON memory_revisions BEGIN SELECT RAISE(ABORT,'Immutable revision'); END;
        CREATE TRIGGER revisions_immutable_delete BEFORE DELETE ON memory_revisions BEGIN SELECT RAISE(ABORT,'Immutable revision'); END;
        CREATE TRIGGER events_immutable_update BEFORE UPDATE ON memory_events BEGIN SELECT RAISE(ABORT,'Append-only memory event'); END;
        CREATE TRIGGER events_immutable_delete BEFORE DELETE ON memory_events BEGIN SELECT RAISE(ABORT,'Append-only memory event'); END;
        CREATE TRIGGER dependencies_immutable_update BEFORE UPDATE ON dependencies BEGIN SELECT RAISE(ABORT,'Immutable source dependency'); END;
        CREATE TRIGGER dependencies_immutable_delete BEFORE DELETE ON dependencies BEGIN SELECT RAISE(ABORT,'Immutable source dependency'); END;
        PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1;
      `));
    } catch (error) { this.db.close(); throw error; }
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private item(scope: TimelineScope, id: string): Item | null {
    const row = this.db.prepare('SELECT * FROM memory_items WHERE id=? AND agent_id=? AND route=?').get(id, scope.agentId, scope.route);
    return row ? { id: string(row.id), ordinal: integer(row.ordinal), version: integer(row.version), head: integer(row.head),
      deleted: row.deleted === 1, reason: string(row.reason) } : null;
  }
  generation(scope: TimelineScope): number {
    const row = this.db.prepare('SELECT generation FROM scope_generations WHERE agent_id=? AND route=?').get(scope.agentId, scope.route);
    return row ? integer(row.generation) : 0;
  }
  /** Monotonic invalidation epoch. Adding an unrelated memory does not erase valid conversation history. */
  mutationEpoch(scope:TimelineScope):number {
    return integer(this.db.prepare('SELECT coalesce(sum(version-1),0) AS n FROM memory_items WHERE agent_id=? AND route=?').get(scope.agentId,scope.route)?.n);
  }
  /** Explicit state changes on memories directly grounded in this source form its fence.
   * Derived invalidity never flows backwards through a sibling input. */
  sourceFence(scope:TimelineScope,contentHash:string,matchesSource?:(ref:string)=>boolean):string {
    const versions=new Map<string,number>();
    for(const row of this.db.prepare('SELECT r.id,r.revision,r.body,i.version FROM memory_revisions r JOIN memory_items i ON i.id=r.id WHERE i.agent_id=? AND i.route=?').iterate(scope.agentId,scope.route)){
      const revision=revisionSchema.parse(JSON.parse(string(row.body)));
      if(!(!matchesSource&&revision.contentHash===contentHash)&&!revision.sources.some(s=>s.contentHash===contentHash&&(!matchesSource||s.kind==='timeline'&&matchesSource(s.ref))))continue;
      if(integer(row.version)>1)versions.set(string(row.id),integer(row.version));
    }
    return hash([...versions].sort(([a],[b])=>a.localeCompare(b)));
  }
  provenance(scope:TimelineScope,id:string,revision:number):MemoryView[] {
    const result:MemoryView[]=[],seen=new Set<string>();
    const visit=(id:string,revision:number):void=>{
      const key=`${id}:${revision}`;if(seen.has(key))return;seen.add(key);
      const item=this.read(scope,id,'normal',revision);if(!item)throw new MemoryError('source_unavailable');result.push(item);
      for(const source of item.sources)if(source.kind==='memory')visit(source.id,source.revision);
    };
    visit(id,revision);return result;
  }
  evidenceFences(scope:TimelineScope,id:string,revision:number,sameSource?:(left:string,right:string)=>boolean){return this.provenance(scope,id,revision).flatMap(item=>item.sources.flatMap(s=>s.kind==='timeline'
    ?[{ref:s.ref,contentHash:s.contentHash,fence:this.sourceFence(scope,s.contentHash,sameSource?ref=>sameSource(s.ref,ref):undefined)}]:[]));}
  /** Conservative tombstone barrier: automatic extraction cannot resurrect deleted source material. */
  suppressedEvidence(scope: TimelineScope, contentHash: string,matchesSource?:(ref:string)=>boolean): boolean {
    for(const row of this.db.prepare('SELECT r.id,r.revision,r.body,i.deleted FROM memory_revisions r JOIN memory_items i ON i.id=r.id WHERE i.agent_id=? AND i.route=?').iterate(scope.agentId,scope.route)) {
      if(matchesSource?row.deleted!==1:!this.lineage(scope,string(row.id),integer(row.revision)).deleted)continue;
      const revision=revisionSchema.parse(JSON.parse(string(row.body)));
      if(!matchesSource&&revision.contentHash===contentHash||revision.sources.some(source=>source.contentHash===contentHash&&(!matchesSource||source.kind==='timeline'&&matchesSource(source.ref))))return true;
    }
    return false;
  }
  /** Trusted indexer enumeration: sources and tombstones are checked before any text is yielded. */
  *current(scope: TimelineScope): Generator<MemoryView> {
    for (const row of this.db.prepare('SELECT id FROM memory_items WHERE agent_id=? AND route=? ORDER BY ordinal')
      .iterate(scope.agentId, scope.route)) {
      const item = this.read(scope, string(row.id));
      if (item) yield item;
    }
  }
  /** Versioned source graph; UNION handles shared ancestry without infinite traversal. */
  private lineage(scope: TimelineScope, id: string, revision: number) {
    const rows = this.db.prepare(`WITH RECURSIVE lineage(id,revision) AS (
      VALUES(?,?) UNION SELECT d.parent_id,d.parent_revision FROM dependencies d JOIN lineage l ON d.id=l.id AND d.revision=l.revision)
      SELECT l.revision,i.id,i.agent_id,i.route,i.deleted,i.head,i.version,r.body FROM lineage l
      LEFT JOIN memory_items i ON i.id=l.id LEFT JOIN memory_revisions r ON r.id=l.id AND r.revision=l.revision`).all(id, revision);
    const inaccessible = rows.some(row => row.agent_id !== scope.agentId || row.route !== scope.route || row.body === null);
    return { inaccessible, deleted: rows.some(row => row.deleted === 1), changed: rows.some(row => row.head !== row.revision),
      versions:inaccessible?[]:rows.map(row=>({id:string(row.id),revision:integer(row.revision),version:integer(row.version),contentHash:revisionSchema.parse(JSON.parse(string(row.body))).contentHash})) };
  }
  read(scope: TimelineScope, id: string, mode: ReadMode = 'normal', revision?: number): MemoryView | null {
    const item = this.item(scope, id);
    if (!item) return null;
    const number = revision ?? item.head;
    const state = this.lineage(scope, id, number);
    if (state.inaccessible || (mode === 'deleted' ? !state.deleted : state.deleted) || (mode === 'normal' && state.changed)) return null;
    const row = this.db.prepare('SELECT body FROM memory_revisions WHERE id=? AND revision=?').get(id, number);
    if (!row) return null;
    const body = revisionSchema.parse(JSON.parse(string(row.body)));
    return { ...body,sourceVersions:state.versions, ref: memoryRef(id, number), version: item.version, latestRevision: item.head,
      validity: number === item.head ? 'active' : 'superseded', deleted: item.deleted, effectivelyDeleted: state.deleted,
      basisStatus: state.deleted ? 'deleted' : state.changed ? 'changed' : 'current',
      deletionReason: item.deleted ? item.reason : null, untrustedEvidence: true,
      useRestriction: mode === 'deleted' ? 'deleted_lookup_only' : state.changed ? 'historical_evidence_only' : 'evidence_only' };
  }
  search(scope: TimelineScope, mode: ReadMode, input: SearchInput) {
    const generation = this.generation(scope);
    const fingerprint = hash({ agentId: scope.agentId, route: scope.route, mode, query: input.query, limit: input.limit });
    let before = Number.MAX_SAFE_INTEGER;
    if (input.cursor) {
      let page;
      try {
        page = z.strictObject({ v: z.literal(1), fingerprint: z.string(), generation: z.number().int().nonnegative(), before: z.number().int().positive().safe() })
          .parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')));
      } catch { throw new MemoryError('invalid_cursor'); }
      if (page.fingerprint !== fingerprint) throw new MemoryError('invalid_cursor');
      if (page.generation !== generation) throw new MemoryError('stale_cursor');
      before = page.before;
    }
    const selected: { ordinal: number; item: MemoryView }[] = [];
    // Read identities first; state/source eligibility is checked before keyword processing or disclosure.
    for (const row of this.db.prepare('SELECT id,ordinal FROM memory_items WHERE agent_id=? AND route=? AND ordinal<? ORDER BY ordinal DESC')
      .iterate(scope.agentId, scope.route, before)) {
      const item = this.read(scope, string(row.id), mode);
      if (item && item.content.toLowerCase().includes(input.query.toLowerCase())) selected.push({ ordinal: integer(row.ordinal), item });
      if (selected.length > input.limit) break;
    }
    const hasMore = selected.length > input.limit;
    const page = selected.slice(0, input.limit);
    const last = page.at(-1);
    return { generation, items: page.map(entry => entry.item), nextCursor: hasMore && last
      ? Buffer.from(JSON.stringify({ v: 1, fingerprint, generation, before: last.ordinal })).toString('base64url') : null };
  }
  private validateSources(scope: TimelineScope, value: WriteContent, target?: string): void {
    for (const source of value.sources) if (source.kind === 'memory') {
      if (source.id === target) throw new MemoryError('source_unavailable');
      const parent = this.read(scope, source.id, 'normal', source.revision);
      if (!parent || parent.contentHash !== source.contentHash) throw new MemoryError('source_unavailable');
    }
  }
  /** Recover a cross-store commit acknowledgement without disclosing a remembered text. */
  receipt(scope: TimelineScope, command: Command): MutationReceipt | null {
    const row=this.db.prepare('SELECT fingerprint,receipt FROM requests WHERE agent_id=? AND route=? AND request_id=?').get(scope.agentId,scope.route,command.requestId);
    if(!row)return null;
    if(row.fingerprint!==hash(command))throw new MemoryError('idempotency_conflict');
    return receiptSchema.parse(JSON.parse(string(row.receipt)));
  }
  mutate(scope: OperationScope, command: Command): MutationReceipt & { duplicate: boolean } {
    return this.transaction(() => {
      const fingerprint = hash(command);
      const old = this.db.prepare('SELECT fingerprint,receipt FROM requests WHERE agent_id=? AND route=? AND request_id=?')
        .get(scope.agentId, scope.route, command.requestId);
      if (old) {
        if (old.fingerprint !== fingerprint) throw new MemoryError('idempotency_conflict');
        // Receipts contain no text. Replaying a request cannot disclose a subsequently deleted version.
        return { ...receiptSchema.parse(JSON.parse(string(old.receipt))), duplicate: true };
      }
      if(command.expectedGeneration!==undefined && command.expectedGeneration!==this.generation(scope))throw new MemoryError('version_conflict');
      let item: Item;
      if (command.action === 'create') {
        this.validateSources(scope, command.value);
        const id = randomUUID();
        this.db.prepare('INSERT INTO memory_items(id,agent_id,route,version,head) VALUES(?,?,?,?,?)').run(id, scope.agentId, scope.route, 1, 1);
        item = this.item(scope, id)!;
      } else {
        const existing = this.item(scope, command.id);
        if (!existing) throw new MemoryError('not_found');
        item = existing;
        if (item.version !== command.expectedVersion) throw new MemoryError('version_conflict');
        if (command.action !== 'restore' && item.deleted) throw new MemoryError('deleted');
        if (command.action === 'restore' && !item.deleted) throw new MemoryError('not_deleted');
        if (command.action === 'revise') this.validateSources(scope, command.value, item.id);
        item = { ...item, version: item.version + 1, head: item.head + (command.action === 'revise' ? 1 : 0),
          deleted: command.action === 'delete', reason: command.action === 'delete' ? command.reason : '' };
        this.db.prepare('UPDATE memory_items SET version=?,head=?,deleted=?,reason=? WHERE id=? AND agent_id=? AND route=?')
          .run(item.version, item.head, Number(item.deleted), item.reason, item.id, scope.agentId, scope.route);
      }
      const eventId = randomUUID();
      if (command.action === 'create' || command.action === 'revise') {
        const value = command.value;
        const body: Revision = revisionSchema.parse({ ...value, id: item.id, revision: item.head,
          contentHash: hash(value), createdAt: new Date().toISOString(), analysisStatus: value.analysis ? 'evidence_checked' : 'not_analyzed' });
        this.db.prepare('INSERT INTO memory_revisions(id,revision,body,event_id) VALUES(?,?,?,?)').run(item.id, item.head, JSON.stringify(body), eventId);
        for (const source of value.sources) if (source.kind === 'memory') {
          this.db.prepare('INSERT OR IGNORE INTO dependencies(id,revision,parent_id,parent_revision) VALUES(?,?,?,?)')
            .run(item.id, item.head, source.id, source.revision);
        }
      }
      const type = { create: 'memory.created', revise: 'memory.revised', delete: 'memory.deleted', restore: 'memory.restored' }[command.action];
      const event: NewEvent = { agentId: scope.agentId, route: scope.route, traceId: scope.traceId, operationId: scope.operationId,
        causedBy: scope.startedEventId, type, plugin: 'memory', pluginVersion: MEMORY_VERSION, occurredAt: new Date().toISOString(),
        sources: [{ kind: 'event', id: scope.startedEventId, route: scope.route }],
        data: { memoryId: item.id, revision: item.head, version: item.version, deleted: item.deleted, deletionScope: 'memory-item-and-revisions' } };
      this.db.prepare('INSERT INTO memory_events(id,body,reason) VALUES(?,?,?)').run(eventId, JSON.stringify(event), 'reason' in command ? command.reason : '');
      this.db.prepare('INSERT INTO outbox(event_id) VALUES(?)').run(eventId);
      this.db.prepare('INSERT INTO scope_generations(agent_id,route,generation) VALUES(?,?,1) ON CONFLICT(agent_id,route) DO UPDATE SET generation=generation+1')
        .run(scope.agentId, scope.route);
      const receipt: MutationReceipt = { id: item.id, version: item.version, revision: item.head, eventId, generation:this.generation(scope) };
      this.db.prepare('INSERT INTO requests(agent_id,route,request_id,fingerprint,receipt) VALUES(?,?,?,?,?)')
        .run(scope.agentId, scope.route, command.requestId, fingerprint, JSON.stringify(receipt));
      return { ...receipt, duplicate: false };
    });
  }
  /** At-least-once delivery with a stable event ID. Publishing must be idempotent. */
  drainOutbox(publish: (event: NewEvent, id: string) => void): number {
    for (const row of this.db.prepare('SELECT e.id,e.body FROM memory_events e JOIN outbox o ON o.event_id=e.id WHERE o.delivered=0 ORDER BY e.rowid').iterate()) {
      try {
        const parsed = z.strictObject({ agentId: z.string(), route: z.string(), traceId: z.string(), operationId: z.string(),
          causedBy: z.string(), type: z.enum(['memory.created', 'memory.revised', 'memory.deleted', 'memory.restored']),
          plugin: z.literal('memory'), pluginVersion: z.string().min(1).max(80), occurredAt: z.iso.datetime(),
          sources: z.array(z.strictObject({ kind: z.literal('event'), id: z.string(), route: z.string() })),
          data: z.record(z.string(), z.json()) }).parse(JSON.parse(string(row.body)));
        const event: NewEvent = parsed;
        publish(event, string(row.id));
        this.db.prepare('UPDATE outbox SET delivered=1 WHERE event_id=?').run(string(row.id));
      } catch { break; }
    }
    return integer(this.db.prepare('SELECT count(*) AS n FROM outbox WHERE delivered=0').get()?.n);
  }
  close(): void { if (!this.closed) { this.closed = true; this.db.close(); } }
}
