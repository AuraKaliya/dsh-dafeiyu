import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Json, OperationScope, TimelineScope } from '@dafeiyu/contracts';
import type { NewEvent } from '@dafeiyu/journal';
import { MEMORY_VERSION, MemoryError, memoryRef, receiptSchema, revisionSchema } from './types.js';
import type { Command, MutationReceipt, ReadMode, Revision, WriteContent } from './types.js';
import { MemoryBoundarySchema,boundaryAllows } from '@dafeiyu/contracts';
import type { MemoryBoundary,MemoryAccessPurpose,MemoryWriteBinding } from '@dafeiyu/contracts';
import { conservativeBoundary,restrictBoundary,boundaryDigest } from './boundary.js';
import { migrateMemoryBoundaries } from './migrate-boundaries.js';
import { ObservationStore,migrateObservations } from './observations.js';
import { TaskWorkspace,migrateTaskWorkspaces } from './task-workspace.js';
import { TaskMemory,migrateTaskMemory } from './task-memory.js';
import type { MemoryRetrieval } from './retrieval.js';

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
  readonly boundary:MemoryBoundary;
  readonly effectiveAccess:Pick<MemoryBoundary,'internalUse'|'externalExpression'>;
  readonly observation?:unknown;
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
  private transactionDepth=0;
  private taskSourceValidator:((agentId:string,jobId:string,purpose:MemoryAccessPurpose)=>'valid'|'deleted'|'changed'|'unavailable')|undefined;
  private readonly validatingTaskSources=new Set<string>();
  readonly observations:ObservationStore;
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    try {
      // Schema reads can race a different process's migration too, not only writes.
      this.db.exec('PRAGMA busy_timeout=5000;');
      const app = this.db.prepare('PRAGMA application_id').get()?.application_id;
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
      const tables = this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n;
      const fresh = app === 0 && version === 0 && tables === 0;
      if (!fresh && (app !== APPLICATION_ID || (version !== 1&&version!==2&&version!==3&&version!==4&&version!==5))) throw new Error('Unsupported memory database identity or schema');
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
      this.transaction(()=>migrateMemoryBoundaries(this.db));
      this.transaction(()=>migrateObservations(this.db));
      this.observations=new ObservationStore(this.db,work=>this.transaction(work),this);
      this.transaction(()=>migrateTaskWorkspaces(this.db));
      this.transaction(()=>migrateTaskMemory(this.db));
    } catch (error) { this.db.close(); throw error; }
  }
  private transaction<T>(work: () => T): T {
    const depth=this.transactionDepth++,savepoint=`memory_nested_${depth}`;
    try{
      this.db.exec(depth?`SAVEPOINT ${savepoint}`:'BEGIN IMMEDIATE');
      try { const result = work(); this.db.exec(depth?`RELEASE ${savepoint}`:'COMMIT'); return result; }
      catch (error) { this.db.exec(depth?`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`:'ROLLBACK'); throw error; }
    }finally{this.transactionDepth--;}
  }
  taskWorkspace(timeline:(scope:TimelineScope,ref:string,hash:string)=>boolean,sameSource:(scope:TimelineScope,a:string,b:string)=>boolean){
    const workspace=new TaskWorkspace(this.db,work=>this.transaction(work),this,timeline,sameSource);
    this.taskSourceValidator=(agentId,jobId,purpose)=>workspace.sourceState(agentId,jobId,purpose);return workspace;
  }
  taskSourceState(agentId:string,jobId:string,purpose:MemoryAccessPurpose='internal'):'valid'|'deleted'|'changed'|'unavailable' {
    const key=`${agentId}:${jobId}:${purpose}`;if(!this.taskSourceValidator||this.validatingTaskSources.has(key)||this.validatingTaskSources.size>=64)return 'unavailable';
    this.validatingTaskSources.add(key);try{return this.taskSourceValidator(agentId,jobId,purpose);}catch{return 'unavailable';}finally{this.validatingTaskSources.delete(key);}
  }
  taskMemory(tasks:TaskWorkspace,retrieval:MemoryRetrieval|null){return new TaskMemory(this.db,work=>this.transaction(work),this,tasks,retrieval);}
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
    return integer(this.db.prepare('SELECT coalesce(sum(version-1),0) AS n FROM memory_items WHERE agent_id=? AND route=?').get(scope.agentId,scope.route)?.n)+this.observations.epoch(scope);
  }
  /** Explicit state changes on memories directly grounded in this source form its fence.
   * Derived invalidity never flows backwards through a sibling input. */
  sourceFence(scope:TimelineScope,contentHash:string,matchesSource?:(ref:string)=>boolean):string {
    const versions=new Map<string,number>();
    for(const row of this.db.prepare('SELECT r.id,r.revision,r.body,i.version FROM memory_revisions r JOIN memory_items i ON i.id=r.id WHERE i.agent_id=? AND i.route=?').iterate(scope.agentId,scope.route)){
      const revision=revisionSchema.parse(JSON.parse(string(row.body)));
      if(!(!matchesSource&&revision.contentHash===contentHash)&&!revision.sources.some(s=>s.contentHash===contentHash&&(!matchesSource||s.kind!=='memory'&&matchesSource(s.ref))))continue;
      if(integer(row.version)>1)versions.set(string(row.id),integer(row.version));
    }
    return hash([...versions].sort(([a],[b])=>a.localeCompare(b)));
  }
  provenance(scope:TimelineScope,id:string,revision:number,purpose:MemoryAccessPurpose='expression'):MemoryView[] {
    const result:MemoryView[]=[],seen=new Set<string>();
    const visit=(id:string,revision:number):void=>{
      const key=`${id}:${revision}`;if(seen.has(key))return;seen.add(key);
      const item=this.read(scope,id,'normal',revision,purpose);if(!item)throw new MemoryError('source_unavailable');result.push(item);
      for(const source of item.sources)if(source.kind==='memory')visit(source.id,source.revision);
    };
    visit(id,revision);return result;
  }
  evidenceFences(scope:TimelineScope,id:string,revision:number,sameSource?:(left:string,right:string)=>boolean,purpose:MemoryAccessPurpose='expression'){return this.provenance(scope,id,revision,purpose).flatMap(item=>item.sources.flatMap(s=>s.kind==='timeline'
    ?[{ref:s.ref,contentHash:s.contentHash,fence:this.sourceFence(scope,s.contentHash,sameSource?ref=>sameSource(s.ref,ref):undefined)}]:[]));}
  /** Conservative tombstone barrier: automatic extraction cannot resurrect deleted source material. */
  suppressedEvidence(scope: TimelineScope, contentHash: string,matchesSource?:(ref:string)=>boolean): boolean {
    for(const row of this.db.prepare('SELECT r.id,r.revision,r.body,i.deleted FROM memory_revisions r JOIN memory_items i ON i.id=r.id WHERE i.agent_id=? AND i.route=?').iterate(scope.agentId,scope.route)) {
      if(matchesSource?row.deleted!==1:!this.lineage(scope,string(row.id),integer(row.revision)).deleted)continue;
      const revision=revisionSchema.parse(JSON.parse(string(row.body)));
      if(!matchesSource&&revision.contentHash===contentHash||revision.sources.some(source=>source.contentHash===contentHash&&(!matchesSource||source.kind!=='memory'&&matchesSource(source.ref))))return true;
    }
    return false;
  }
  /** Trusted indexer enumeration: sources and tombstones are checked before any text is yielded. */
  *current(scope: TimelineScope,purpose:MemoryAccessPurpose='expression'): Generator<MemoryView> {
    for (const row of this.db.prepare('SELECT id FROM memory_items WHERE agent_id=? AND route=? ORDER BY ordinal')
      .iterate(scope.agentId, scope.route)) {
      const item = this.read(scope, string(row.id),'normal',undefined,purpose);
      if (item) yield item;
    }
  }
  /** Versioned source graph; UNION handles shared ancestry without infinite traversal. */
  private decodeBoundary(body:unknown,digest:unknown,agent:unknown,route:unknown):MemoryBoundary|null {
    try{
      const boundary=MemoryBoundarySchema.parse(JSON.parse(string(body)));
      if(boundaryDigest(boundary)!==digest||boundary.owner.agentId!==agent||boundary.sourceScene.route!==route
        ||boundary.task.kind==='conversation-task'&&boundary.task.route!==route
        ||boundary.internalUse.kind==='conversation'&&boundary.internalUse.route!==route
        ||boundary.externalExpression.kind==='conversation'&&boundary.externalExpression.route!==route)return null;
      if(boundary.sourceScene.kind==='conversation'){
        const expected=conservativeBoundary({agentId:boundary.owner.agentId,route:string(route)},boundary.assignment,{conversation:boundary.sourceScene.conversation});
        if(expected.sourceScene.kind!=='conversation')return null;
      }
      return boundary;
    }catch{return null;}
  }
  private boundary(id:string,revision:number):MemoryBoundary|null {
    const row=this.db.prepare('SELECT b.body,b.boundary_hash,i.agent_id,i.route FROM memory_boundaries b JOIN memory_items i ON i.id=b.id WHERE b.id=? AND b.revision=?').get(id,revision);
    return row?this.decodeBoundary(row.body,row.boundary_hash,row.agent_id,row.route):null;
  }
  private lineage(scope: TimelineScope, id: string, revision: number,purpose:MemoryAccessPurpose='expression') {
    const rows = this.db.prepare(`WITH RECURSIVE lineage(id,revision) AS (
      VALUES(?,?) UNION SELECT d.parent_id,d.parent_revision FROM dependencies d JOIN lineage l ON d.id=l.id AND d.revision=l.revision)
      SELECT l.revision,i.id,i.agent_id,i.route,i.deleted,i.head,i.version,r.body,
        b.body AS boundary_body,b.boundary_hash,h.body AS head_boundary_body,h.boundary_hash AS head_boundary_hash FROM lineage l
      LEFT JOIN memory_items i ON i.id=l.id LEFT JOIN memory_revisions r ON r.id=l.id AND r.revision=l.revision
      LEFT JOIN memory_boundaries b ON b.id=l.id AND b.revision=l.revision
      LEFT JOIN memory_boundaries h ON h.id=i.id AND h.revision=i.head`).all(id, revision);
    const boundaries:MemoryBoundary[]=[];
    let inaccessible = rows.some(row => {
      const boundary=this.decodeBoundary(row.boundary_body,row.boundary_hash,row.agent_id,row.route),head=this.decodeBoundary(row.head_boundary_body,row.head_boundary_hash,row.agent_id,row.route);
      if(boundary&&head)boundaries.push(boundary,head);
      return row.agent_id!==scope.agentId||row.route!==scope.route||row.body===null||!boundary||!head
        ||!boundaryAllows(boundary,scope,purpose)||!boundaryAllows(head,scope,purpose);
    });
    let sourceDeleted=false,sourceChanged=false;
    for(const row of rows){
      if(row.body===null)continue;
      const taskWork=this.observations.taskWorkForMemory(string(row.id));
      if(taskWork){const status=this.taskSourceState(scope.agentId,taskWork);sourceDeleted ||= status==='deleted';sourceChanged ||= status==='changed';inaccessible ||= status==='unavailable';}
      for(const evidence of revisionSchema.parse(JSON.parse(string(row.body))).sources)if(evidence.kind==='observation'){
        const source=this.observations.source(scope,evidence.ref,purpose);
        if(!source){inaccessible=true;continue;}boundaries.push(source.boundary);
        sourceDeleted ||= source.deleted;sourceChanged ||= source.version!==evidence.version||source.hash!==evidence.contentHash;
      }
    }
    const effectiveAccess:MemoryView['effectiveAccess']={
      internalUse:!inaccessible&&boundaries.every(b=>boundaryAllows(b,scope,'internal'))?{kind:'conversation',route:scope.route}:{kind:'none'},
      externalExpression:!inaccessible&&boundaries.every(b=>boundaryAllows(b,scope,'expression'))?{kind:'conversation',route:scope.route}:{kind:'none'},
    };
    return { inaccessible,effectiveAccess, deleted: sourceDeleted||rows.some(row => row.deleted === 1), changed: sourceChanged||rows.some(row => row.head !== row.revision),
      versions:inaccessible?[]:rows.map(row=>({id:string(row.id),revision:integer(row.revision),version:integer(row.version),contentHash:revisionSchema.parse(JSON.parse(string(row.body))).contentHash})) };
  }
  read(scope: TimelineScope, id: string, mode: ReadMode = 'normal', revision?: number,purpose:MemoryAccessPurpose='expression'): MemoryView | null {
    const item = this.item(scope, id);
    if (!item) return null;
    const number = revision ?? item.head;
    const state = this.lineage(scope, id, number,purpose);
    if (state.inaccessible || (mode === 'deleted' ? !state.deleted : state.deleted) || (mode === 'normal' && state.changed)) return null;
    const row = this.db.prepare('SELECT body FROM memory_revisions WHERE id=? AND revision=?').get(id, number);
    if (!row) return null;
    const body = revisionSchema.parse(JSON.parse(string(row.body)));
    const boundary=this.boundary(id,number);if(!boundary)return null;
    const observation=this.observations.contribution(id,number);
    return { ...body,boundary,effectiveAccess:state.effectiveAccess,...(observation?{observation}:{}),sourceVersions:state.versions, ref: memoryRef(id, number), version: item.version, latestRevision: item.head,
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
    for(const source of value.sources)if(source.kind==='observation'){
      const state=this.observations.source(scope,source.ref,'internal');
      if(!state||state.deleted||state.version!==source.version||state.hash!==source.contentHash||this.suppressedEvidence(scope,state.hash,ref=>ref===source.ref))throw new MemoryError('source_unavailable');
    }
    for (const source of value.sources) if (source.kind === 'memory') {
      if (source.id === target) throw new MemoryError('source_unavailable');
      const parent = this.read(scope, source.id, 'normal', source.revision,'internal');
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
  mutate(scope: OperationScope, command: Command,binding:MemoryWriteBinding={}): MutationReceipt & { duplicate: boolean } {
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
      if(command.boundaryPolicy&&command.action!=='create'&&command.action!=='revise')throw new Error('Boundary policy requires a new content revision');
      let item: Item;
      let previousBoundary:MemoryBoundary|undefined;
      if (command.action === 'create') {
        this.validateSources(scope, command.value);
        const id = randomUUID();
        this.db.prepare('INSERT INTO memory_items(id,agent_id,route,version,head) VALUES(?,?,?,?,?)').run(id, scope.agentId, scope.route, 1, 1);
        item = this.item(scope, id)!;
      } else {
        const existing = this.item(scope, command.id);
        if (!existing) throw new MemoryError('not_found');
        item = existing;
        previousBoundary=this.boundary(item.id,item.head)??undefined;
        if(!previousBoundary)throw new MemoryError('source_unavailable');
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
        const ancestors:MemoryBoundary[]=previousBoundary?[previousBoundary]:[];
        for(const source of value.sources)if(source.kind==='memory'){
          ancestors.push(...this.provenance(scope,source.id,source.revision,'internal').map(item=>item.boundary));
        }
        for(const source of value.sources)if(source.kind==='observation'){
          const state=this.observations.source(scope,source.ref,'internal');if(!state)throw new MemoryError('source_unavailable');ancestors.push(state.boundary);
        }
        const boundary=restrictBoundary(conservativeBoundary(scope,'conservative-create',binding),ancestors,command.boundaryPolicy);
        this.db.prepare('INSERT INTO memory_boundaries(id,revision,body,boundary_hash) VALUES(?,?,?,?)').run(item.id,item.head,JSON.stringify(boundary),boundaryDigest(boundary));
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
          causedBy: z.string().nullable(), type: z.enum(['memory.created', 'memory.revised', 'memory.deleted', 'memory.restored','observation.recorded','observation.source.deleted','observation.source.restored',
            'task.created','task.updated','task.scene.joined','task.scene.selected','task.sources.linked','task.work.started','task.observation.linked','task.work.completed','task.work.late','task.work.interrupted',
            'task.memory.policy','task.memory.granted','task.memory.revoked','task.memory.recalled','task.memory.opened']),
          plugin: z.string().min(1), pluginVersion: z.string().min(1).max(80), occurredAt: z.iso.datetime({offset:true}),
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
