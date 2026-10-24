import { randomUUID,createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { conversationKey,redactContent,TaskMemoryAuthorizationSchema } from '@dafeiyu/contracts';
import type { TaskMemoryAuthorization } from '@dafeiyu/contracts';
import type { ObservationAuthority,MemoryObservation,TimelineScope,MemoryAccessPurpose,ContextItem,TaskWorkspaceProvider } from '@dafeiyu/contracts';
import type { MemoryStore } from './store.js';
import type { NewEvent } from '@dafeiyu/journal';
import { MEMORY_VERSION,sourceVersionSchema,sourceFenceSchema } from './types.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const string=(v:unknown)=>z.string().parse(v),integer=(v:unknown)=>z.number().int().safe().parse(v);
export const witnessSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('memory'),route:z.string(),id:z.uuid(),revision:z.number().int().positive(),version:z.number().int().positive(),contentHash:z.string(),
    ancestors:z.array(sourceVersionSchema),fences:z.array(sourceFenceSchema),authorization:TaskMemoryAuthorizationSchema.optional(),range:z.strictObject({start:z.number().int().nonnegative(),end:z.number().int().positive()}).optional()}),
  z.strictObject({kind:z.literal('observation'),route:z.string(),id:z.uuid(),contentHash:z.string()}),
]);
export type Witness=z.infer<typeof witnessSchema>;
const authoritySchema=z.object({agentId:z.string(),route:z.string(),pluginId:z.string(),pluginVersion:z.string(),ingressPluginId:z.string(),
  conversation:z.object({channel:z.string(),account:z.string(),kind:z.enum(['private','group','local']),id:z.string()}),taskId:z.string().nullable(),
  parent:z.object({traceId:z.string(),operationId:z.string(),eventId:z.string()}).optional()}).transform(value=>{
    const {parent,...rest}=value;return {...rest,...(parent?{parent}:{})};
  });
const jobSchema=z.strictObject({authority:authoritySchema,taskEpoch:z.number().int(),selectionVersion:z.number().int(),slot:z.string(),slotVersion:z.number().int(),
  inputs:z.array(z.strictObject({linkId:z.uuid(),proof:witnessSchema})).max(16)});
const privateRoute=(agentId:string,taskId:string)=>conversationKey(agentId,{channel:'agent-task',account:agentId,kind:'local',id:taskId});

export function migrateTaskWorkspaces(db:DatabaseSync):void {
  const version=db.prepare('PRAGMA user_version').get()?.user_version;
  const tables=['task_workspaces','task_revisions','task_members','task_selections','task_links','task_jobs','task_slots','task_requests','task_observations'];
if(version===4||version===5||version===6||version===7||version===8||version===9||version===10){for(const table of tables)db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();return;}
  if(version!==3)throw new Error('Unsupported task workspace schema');
  db.exec(`CREATE TABLE task_workspaces(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,version INTEGER NOT NULL,epoch INTEGER NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL);
    CREATE TABLE task_revisions(task_id TEXT NOT NULL REFERENCES task_workspaces(id),version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(task_id,version));
    CREATE TABLE task_members(task_id TEXT NOT NULL REFERENCES task_workspaces(id),route TEXT NOT NULL,plugin TEXT NOT NULL,PRIMARY KEY(task_id,route,plugin));
    CREATE TABLE task_selections(agent_id TEXT NOT NULL,route TEXT NOT NULL,version INTEGER NOT NULL,task_id TEXT REFERENCES task_workspaces(id),PRIMARY KEY(agent_id,route));
    CREATE TABLE task_links(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES task_workspaces(id),fingerprint TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(task_id,fingerprint));
    CREATE TABLE task_jobs(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES task_workspaces(id),status TEXT NOT NULL,body TEXT NOT NULL,result TEXT);
    CREATE TABLE task_slots(task_id TEXT NOT NULL REFERENCES task_workspaces(id),slot TEXT NOT NULL,version INTEGER NOT NULL,job_id TEXT NOT NULL REFERENCES task_jobs(id),PRIMARY KEY(task_id,slot));
    CREATE TABLE task_requests(agent_id TEXT NOT NULL,route TEXT NOT NULL,plugin TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,route,plugin,request_id));
    CREATE TABLE task_observations(task_id TEXT NOT NULL REFERENCES task_workspaces(id),job_id TEXT NOT NULL REFERENCES task_jobs(id),activity_id TEXT NOT NULL REFERENCES observation_activities(id),late INTEGER NOT NULL,PRIMARY KEY(job_id,activity_id));
    CREATE TRIGGER task_revision_immutable BEFORE UPDATE ON task_revisions BEGIN SELECT RAISE(ABORT,'Immutable task revision'); END;
    CREATE TRIGGER task_revision_no_delete BEFORE DELETE ON task_revisions BEGIN SELECT RAISE(ABORT,'Retain task revision'); END;
    CREATE TRIGGER task_link_immutable BEFORE UPDATE ON task_links BEGIN SELECT RAISE(ABORT,'Immutable task source'); END;
    CREATE TRIGGER task_link_no_delete BEFORE DELETE ON task_links BEGIN SELECT RAISE(ABORT,'Retain task source'); END;
    CREATE TRIGGER task_job_input_immutable BEFORE UPDATE OF id,task_id,body ON task_jobs BEGIN SELECT RAISE(ABORT,'Immutable work inputs'); END;
    PRAGMA user_version=4;`);
}

/** One SQLite transaction for task state, source adoption, observations and outbox. Task
 * control epoch, scene activation and per-slot version are independent concurrency fences. */
export class TaskWorkspace {
  private authorization:((agent:string,proof:TaskMemoryAuthorization,route:string,memoryId:string)=>boolean)|undefined;
  authorizeWith(validate:NonNullable<TaskWorkspace['authorization']>){this.authorization=validate;}
  state(agentId:string,id:string){const {version,epoch,status}=this.task(agentId,id);return {version,epoch,status};}
  memoryProof(scope:TimelineScope,id:string,revision:number,version:number,contentHash:string){return this.capture(scope,{kind:'memory',id,revision,version,contentHash});}
  validProof(agentId:string,proof:Witness){return !!this.evidence(agentId,proof);}
  expressionLink(agentId:string,taskId:string,id:string){const link=this.links(agentId,taskId).find(l=>l.id===id);if(!link)return null;const evidence=this.evidence(agentId,link.proof);return evidence?{id,text:evidence.text,proof:link.proof}:null;}
  expressionSlot(agentId:string,taskId:string,slot:string){const task=this.task(agentId,taskId),entry=this.entries(agentId,taskId).find(e=>e.slot===slot);
    if(!entry||entry.job.taskEpoch!==task.epoch||!entry.result.proofs.length||entry.result.proofs.some(p=>!this.evidence(agentId,p)))return null;
    return {slot,version:entry.version,jobId:entry.jobId,text:entry.result.text,proofs:entry.result.proofs};}
  selectAuthorized(agentId:string,id:string,requestId:string,expectedVersion:number,proofs:Witness[]){
    return this.request({agentId,route:privateRoute(agentId,id),pluginId:'$task-coordinator'},requestId,{kind:'authorized-selection',id,expectedVersion,proofs},()=>{
      const task=this.task(agentId,id);if(task.version!==expectedVersion||task.status!=='active')throw new Error('task_version_conflict');
      for(const proof of proofs)if(proof.kind!=='memory'||proof.authorization?.taskId!==id||!this.evidence(agentId,proof))throw new Error('task_source_unavailable');
      const links=proofs.map(proof=>this.adopt(id,proof));task.version++;this.revise(task);this.record(task,'task.sources.linked',{version:task.version,links,internalOnly:true});return {taskId:id,version:task.version,links};
    });
  }
  constructor(private readonly db:DatabaseSync,private readonly transaction:<T>(work:()=>T)=>T,private readonly memory:MemoryStore,
    private readonly timeline:(scope:TimelineScope,ref:string,hash:string)=>boolean,private readonly sameSource:(scope:TimelineScope,a:string,b:string)=>boolean){}
  private task(agentId:string,id:string){
    const row=this.db.prepare('SELECT * FROM task_workspaces WHERE id=? AND agent_id=?').get(id,agentId);if(!row)throw new Error('task_not_found');
    const body=z.strictObject({title:z.string(),goal:z.string()}).parse(JSON.parse(string(row.body)));
    return {id,agentId,version:integer(row.version),epoch:integer(row.epoch),status:z.enum(['active','paused','completed']).parse(row.status),...body};
  }
  private record(task:ReturnType<TaskWorkspace['task']>,type:string,data:Record<string,import('@dafeiyu/contracts').Json>,authority?:ObservationAuthority){
    const eventId=randomUUID(),event:NewEvent={agentId:task.agentId,route:authority?.route??privateRoute(task.agentId,task.id),traceId:authority?.parent?.traceId??task.id,
      operationId:task.id,causedBy:authority?.parent?.eventId??null,plugin:'memory',pluginVersion:MEMORY_VERSION,type,occurredAt:new Date().toISOString(),sources:[],data:{taskId:task.id,...data}};
    this.db.prepare('INSERT INTO memory_events VALUES(?,?,?)').run(eventId,JSON.stringify(event),'');this.db.prepare('INSERT INTO outbox(event_id) VALUES(?)').run(eventId);
  }
  private revise(task:ReturnType<TaskWorkspace['task']>){
    this.db.prepare('UPDATE task_workspaces SET version=?,epoch=?,status=?,body=? WHERE id=?').run(task.version,task.epoch,task.status,JSON.stringify({title:task.title,goal:task.goal}),task.id);
    this.db.prepare('INSERT INTO task_revisions VALUES(?,?,?)').run(task.id,task.version,JSON.stringify(task));
  }
  private request<T extends Record<string,unknown>>(scope:{agentId:string;route:string;pluginId:string},requestId:string,input:unknown,work:()=>T):T {
    return this.transaction(()=>{const fingerprint=hash(input),old=this.db.prepare('SELECT fingerprint,receipt FROM task_requests WHERE agent_id=? AND route=? AND plugin=? AND request_id=?').get(scope.agentId,scope.route,scope.pluginId,requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new Error('task_idempotency_conflict');return z.record(z.string(),z.unknown()).parse(JSON.parse(string(old.receipt))) as T;}
      const receipt=work();this.db.prepare('INSERT INTO task_requests VALUES(?,?,?,?,?,?)').run(scope.agentId,scope.route,scope.pluginId,requestId,fingerprint,JSON.stringify(receipt));return receipt;});
  }
  create(agentId:string,input:Parameters<TaskWorkspaceProvider['create']>[1]):string {
    return this.request({agentId,route:'$task-coordinator',pluginId:'$core'},input.requestId,{kind:'create',input},()=>{
      const id=randomUUID(),task={id,agentId,version:1,epoch:1,status:'active' as const,title:redactContent(input.title).value,goal:redactContent(input.goal).value};
      this.db.prepare('INSERT INTO task_workspaces VALUES(?,?,?,?,?,?)').run(id,agentId,1,1,'active',JSON.stringify({title:task.title,goal:task.goal}));
      this.db.prepare('INSERT INTO task_revisions VALUES(?,?,?)').run(id,1,JSON.stringify(task));this.record(task,'task.created',{version:1});return {id};
    }).id;
  }
  findCreateRequest(agentId:string,requestId:string):string|null {
    const row=this.db.prepare("SELECT receipt FROM task_requests WHERE agent_id=? AND route='$task-coordinator' AND plugin='$core' AND request_id=?").get(agentId,requestId);
    return row?z.object({id:z.uuid()}).parse(JSON.parse(string(row.receipt))).id:null;
  }
  update(agentId:string,id:string,input:Parameters<TaskWorkspaceProvider['update']>[2]):Record<string,unknown>{
    return this.request({agentId,route:'$task-coordinator',pluginId:'$core'},input.requestId,{kind:'update',id,input},()=>{
      const task=this.task(agentId,id);if(task.version!==input.expectedVersion)throw new Error('task_version_conflict');
      task.version++;task.epoch++;if(input.title!==undefined)task.title=redactContent(input.title).value;if(input.goal!==undefined)task.goal=redactContent(input.goal).value;if(input.status)task.status=input.status;
      this.revise(task);this.record(task,'task.updated',{version:task.version,epoch:task.epoch,status:task.status});return {id,version:task.version,epoch:task.epoch};
    });
  }
  private member(authority:ObservationAuthority,id:string){const task=this.task(authority.agentId,id);
    if(!this.db.prepare('SELECT 1 FROM task_members WHERE task_id=? AND route=? AND plugin=?').get(id,authority.route,authority.pluginId))throw new Error('task_scene_not_joined');return task;}
  join(authority:ObservationAuthority,id:string,input:Parameters<TaskWorkspaceProvider['join']>[2]):Record<string,unknown>{
    return this.request(authority,input.requestId,{kind:'join',id,input},()=>{const task=this.task(authority.agentId,id);if(task.status!=='active')throw new Error('task_not_active');
      this.db.prepare('INSERT OR IGNORE INTO task_members VALUES(?,?,?)').run(id,authority.route,authority.pluginId);this.record(task,'task.scene.joined',{plugin:authority.pluginId},authority);return {taskId:id,joined:true};});
  }
  selection(scope:TimelineScope){const row=this.db.prepare('SELECT version,task_id FROM task_selections WHERE agent_id=? AND route=?').get(scope.agentId,scope.route);return {version:row?integer(row.version):0,taskId:row?.task_id?string(row.task_id):null};}
  activeTask(scope:TimelineScope):string|null {const selection=this.selection(scope);return selection.taskId&&this.task(scope.agentId,selection.taskId).status==='active'?selection.taskId:null;}
  activate(authority:ObservationAuthority,id:string|null,input:Parameters<TaskWorkspaceProvider['activate']>[2]):Record<string,unknown>{
    return this.request(authority,input.requestId,{kind:'activate',id,input},()=>{const old=this.selection(authority);if(old.version!==input.expectedVersion)throw new Error('task_selection_conflict');
      if(id&&this.member(authority,id).status!=='active')throw new Error('task_not_active');
      this.db.prepare('INSERT INTO task_selections VALUES(?,?,?,?) ON CONFLICT(agent_id,route) DO UPDATE SET version=excluded.version,task_id=excluded.task_id').run(authority.agentId,authority.route,old.version+1,id);
      if(id||old.taskId)this.record(this.task(authority.agentId,id??old.taskId!),'task.scene.selected',{selectionVersion:old.version+1,selected:id},authority);
      return {taskId:id,version:old.version+1};});
  }
  private capture(scope:TimelineScope,ref:Parameters<TaskWorkspaceProvider['link']>[2]['items'][number]):Witness|null {
    if(ref.kind==='observation'){const activity=this.memory.observations.activity(scope,ref.id,'internal');return activity?{kind:'observation',route:scope.route,id:ref.id,contentHash:activity.hash}:null;}
    const item=this.memory.read(scope,ref.id,'normal',ref.revision,'internal');if(!item||item.version!==ref.version||item.contentHash!==ref.contentHash)return null;
    const fences=this.memory.evidenceFences(scope,item.id,item.revision,(a,b)=>this.sameSource(scope,a,b),'internal');
    if(fences.some(f=>!this.timeline(scope,f.ref,f.contentHash)||this.memory.suppressedEvidence(scope,f.contentHash,r=>this.sameSource(scope,r,f.ref))))return null;
    return {kind:'memory',route:scope.route,id:item.id,revision:item.revision,version:item.version,contentHash:item.contentHash,ancestors:[...item.sourceVersions],fences};
  }
  private evidence(agentId:string,proof:Witness,purpose:MemoryAccessPurpose='internal'){
    const scope={agentId,route:proof.route};
    if(proof.kind==='observation'){const activity=this.memory.observations.activity(scope,proof.id,purpose);return activity&&activity.hash===proof.contentHash?{text:JSON.stringify(activity.summary),proof}:null;}
    const {authorization,range,...base}=proof;
    if(authorization&&(purpose==='expression'||!this.authorization?.(agentId,authorization,proof.route,proof.id)))return null;
    const current=this.capture(scope,proof);if(!current||hash(current)!==hash(base))return null;
    const item=this.memory.read(scope,proof.id,'normal',proof.revision,purpose);if(!item)return null;
    const points=Array.from(item.content);if(range&&(range.start>=range.end||range.end>points.length))return null;
    return {text:range?points.slice(range.start,range.end).join(''):item.content,proof};
  }
  link(authority:ObservationAuthority,id:string,input:Parameters<TaskWorkspaceProvider['link']>[2]):Record<string,unknown>{
    return this.request(authority,input.requestId,{kind:'link',id,input},()=>{const task=this.member(authority,id);if(task.status!=='active')throw new Error('task_not_active');if(task.version!==input.expectedVersion)throw new Error('task_version_conflict');
      const links:string[]=[];for(const item of input.items){const proof=this.capture(authority,item);if(!proof)throw new Error('task_source_unavailable');
        const fingerprint=hash(proof),old=this.db.prepare('SELECT id FROM task_links WHERE task_id=? AND fingerprint=?').get(id,fingerprint);
        if(old){links.push(string(old.id));continue;}
        if(integer(this.db.prepare('SELECT count(*) AS n FROM task_links WHERE task_id=?').get(id)?.n)>=64)throw new Error('task_capacity');
        const linkId=randomUUID();this.db.prepare('INSERT INTO task_links VALUES(?,?,?,?)').run(linkId,id,fingerprint,JSON.stringify(proof));links.push(linkId);
      }
      task.version++;this.revise(task);this.record(task,'task.sources.linked',{version:task.version,links},authority);return {taskId:id,version:task.version,links};});
  }
  private links(agentId:string,id:string){this.task(agentId,id);return this.db.prepare('SELECT id,body FROM task_links WHERE task_id=? ORDER BY rowid').all(id).map(row=>({id:string(row.id),proof:witnessSchema.parse(JSON.parse(string(row.body)))}));}
  private adopt(id:string,proof:Witness):string {
    const fingerprint=hash(proof),old=this.db.prepare('SELECT id FROM task_links WHERE task_id=? AND fingerprint=?').get(id,fingerprint);if(old)return string(old.id);
    if(integer(this.db.prepare('SELECT count(*) AS n FROM task_links WHERE task_id=?').get(id)?.n)>=64)throw new Error('task_capacity');
    const linkId=randomUUID();this.db.prepare('INSERT INTO task_links VALUES(?,?,?,?)').run(linkId,id,fingerprint,JSON.stringify(proof));return linkId;
  }
  begin(authority:ObservationAuthority,id:string,input:Parameters<TaskWorkspaceProvider['begin']>[2]):string {
    return this.request(authority,input.requestId,{kind:'begin',id,input},()=>{const task=this.member(authority,id),selection=this.selection(authority);if(task.status!=='active'||selection.taskId!==id)throw new Error('task_not_selected');
      const slot=this.db.prepare('SELECT version FROM task_slots WHERE task_id=? AND slot=?').get(id,input.slot),slotVersion=slot?integer(slot.version):0;
      if(slotVersion!==input.expectedSlotVersion)throw new Error('task_slot_conflict');
      const all=this.links(authority.agentId,id),inputs=input.inputs.map(linkId=>{const link=all.find(l=>l.id===linkId);if(!link||!this.evidence(authority.agentId,link.proof))throw new Error('task_source_unavailable');return {linkId,proof:link.proof};});
      if(new Set(input.inputs).size!==input.inputs.length)throw new Error('task_duplicate_inputs');
      const jobId=randomUUID(),body=jobSchema.parse({authority,taskEpoch:task.epoch,selectionVersion:selection.version,slot:input.slot,slotVersion,inputs});
      this.db.prepare('INSERT INTO task_jobs VALUES(?,?,?,?,NULL)').run(jobId,id,'running',JSON.stringify(body));this.record(task,'task.work.started',{jobId,slot:input.slot},authority);return {id:jobId};
    }).id;
  }
  private job(authority:ObservationAuthority,id:string){const row=this.db.prepare('SELECT * FROM task_jobs WHERE id=?').get(id);if(!row)throw new Error('task_work_not_found');
    const body=jobSchema.parse(JSON.parse(string(row.body)));if(body.authority.agentId!==authority.agentId||body.authority.route!==authority.route||body.authority.pluginId!==authority.pluginId)throw new Error('task_work_not_found');
    return {id,task:this.task(authority.agentId,string(row.task_id)),status:string(row.status),body};}
  private current(job:ReturnType<TaskWorkspace['job']>):boolean {
    const selection=this.selection(job.body.authority),slot=this.db.prepare('SELECT version FROM task_slots WHERE task_id=? AND slot=?').get(job.task.id,job.body.slot);
    return job.status==='running'&&job.task.status==='active'&&job.task.epoch===job.body.taskEpoch&&selection.taskId===job.task.id&&selection.version===job.body.selectionVersion
      &&(slot?integer(slot.version):0)===job.body.slotVersion&&job.body.inputs.every(i=>!!this.evidence(job.task.agentId,i.proof));
  }
  sourceState(agentId:string,jobId:string,purpose:MemoryAccessPurpose='internal'):'valid'|'deleted'|'changed'|'unavailable' {
    const row=this.db.prepare('SELECT j.body FROM task_jobs j JOIN task_workspaces t ON t.id=j.task_id WHERE j.id=? AND t.agent_id=?').get(jobId,agentId);if(!row)return 'unavailable';
    const job=jobSchema.parse(JSON.parse(string(row.body)));
    if(purpose==='expression'&&job.inputs.some(i=>i.proof.route!==job.authority.route||!this.evidence(agentId,i.proof,'expression')))return 'unavailable';
    let state:'valid'|'deleted'|'changed'|'unavailable'='valid';
    const rank={valid:0,changed:1,deleted:2,unavailable:3};
    const include=(next:typeof state)=>{if(rank[next]>rank[state])state=next;};
    for(const input of job.inputs){const proof=input.proof,scope={agentId,route:proof.route};if(this.evidence(agentId,proof))continue;
      if(proof.kind==='memory'){
        if(proof.authorization&&!this.authorization?.(agentId,proof.authorization,proof.route,proof.id)){include('unavailable');continue;}
        if(this.memory.read(scope,proof.id,'deleted',proof.revision,'internal')||proof.fences.some(f=>this.memory.suppressedEvidence(scope,f.contentHash,r=>this.sameSource(scope,r,f.ref))))include('deleted');
        else include(this.memory.read(scope,proof.id,'history',proof.revision,'internal')?'changed':'unavailable');
        continue;
      }
      const activity=this.db.prepare('SELECT receipt FROM observation_activities WHERE id=? AND agent_id=? AND route=?').get(proof.id,agentId,proof.route);if(!activity)return 'unavailable';
      const receipt=z.object({sources:z.array(z.object({ref:z.string(),version:z.number()})),contributions:z.array(z.object({memoryId:z.string(),revision:z.number()}))}).parse(JSON.parse(string(activity.receipt)));
      include('changed');
      for(const source of receipt.sources){const current=this.memory.observations.source(scope,source.ref,'internal');include(!current?'unavailable':current.deleted?'deleted':'changed');}
      for(const contribution of receipt.contributions){
        if(this.memory.read(scope,contribution.memoryId,'deleted',contribution.revision,'internal'))include('deleted');
        else if(!this.memory.read(scope,contribution.memoryId,'history',contribution.revision,'internal'))include('unavailable');
      }
    }
    return state;
  }
  observe(authority:ObservationAuthority,id:string,input:MemoryObservation){return this.transaction(()=>{
    const job=this.job(authority,id);if(job.status!=='running')throw new Error('task_work_closed');
    if(conversationKey(authority.agentId,input.conversation)!==job.body.authority.route)throw new Error('task_observation_scene_conflict');
    const prior=this.db.prepare('SELECT body FROM observation_activities WHERE agent_id=? AND route=? AND plugin=? AND request_id=?').get(authority.agentId,authority.route,authority.pluginId,input.requestId);
    if(prior&&z.object({taskWorkId:z.string().optional()}).parse(JSON.parse(string(prior.body))).taskWorkId!==id)throw new Error('task_observation_binding_conflict');
    if(this.sourceState(authority.agentId,id)!=='valid')throw new Error('task_source_unavailable');
    const privateResult=job.body.inputs.some(i=>i.proof.route!==authority.route||!this.evidence(authority.agentId,i.proof,'expression'));
    const guardedInput:MemoryObservation=privateResult?{...input,
      sources:input.sources.map(source=>{
        const existing=this.db.prepare("SELECT json_extract(body,'$.taskWorkId') AS job FROM observation_sources WHERE agent_id=? AND route=? AND source_key=?").get(authority.agentId,authority.route,source.key);
        return existing&&existing.job!==id?source:{...source,policy:{...source.policy,externalExpression:'none'}};
      }),
      contributions:input.contributions.map(c=>({...c,policy:{...c.policy,externalExpression:'none'}}))}:input;
    const late=!this.current(job),receipt=this.memory.observations.submit({...job.body.authority,agentTaskId:job.task.id,taskWorkId:id},guardedInput);
    const inserted=this.db.prepare('INSERT OR IGNORE INTO task_observations VALUES(?,?,?,?)').run(job.task.id,id,receipt.activityId,Number(late));
    // Association is durable even for a late result; it never selects another task or slot.
    if(inserted.changes){
      if(!late){
        const activity=this.capture(job.body.authority,{kind:'observation',id:receipt.activityId});if(activity)this.adopt(job.task.id,activity);
        for(const contribution of receipt.contributions){const memory=this.memory.read(job.body.authority,contribution.memoryId,'normal',contribution.revision,'internal');
          if(memory){const proof=this.capture(job.body.authority,{kind:'memory',id:memory.id,revision:memory.revision,version:memory.version,contentHash:memory.contentHash});if(proof)this.adopt(job.task.id,proof);}
        }
      }
      job.task.version++;this.revise(job.task);this.record(job.task,'task.observation.linked',{jobId:id,activityId:receipt.activityId,late},job.body.authority);
    }
    return receipt;
  });}
  complete(authority:ObservationAuthority,id:string,input:Parameters<TaskWorkspaceProvider['complete']>[2]):Record<string,unknown>{
    return this.request(authority,input.requestId,{kind:'complete',id,input},()=>{const job=this.job(authority,id);if(job.status!=='running')throw new Error('task_work_closed');
      const observations=this.db.prepare('SELECT activity_id,late FROM task_observations WHERE job_id=? ORDER BY rowid').all(id);
      const outputs=observations.map(row=>this.capture(job.body.authority,{kind:'observation',id:string(row.activity_id)}));
      const applied=this.current(job)&&observations.every(row=>row.late===0)&&outputs.every(p=>p!==null);
      const proofs=[...job.body.inputs.map(i=>i.proof),...outputs.filter((p):p is Witness=>p!==null)];
      const result={text:redactContent(input.text).value,proofs,recordedAt:new Date().toISOString()};
      this.db.prepare('UPDATE task_jobs SET status=?,result=? WHERE id=?').run(applied?'completed':'late',JSON.stringify(result),id);
      if(applied){this.db.prepare('INSERT INTO task_slots VALUES(?,?,?,?) ON CONFLICT(task_id,slot) DO UPDATE SET version=excluded.version,job_id=excluded.job_id')
        .run(job.task.id,job.body.slot,job.body.slotVersion+1,id);job.task.version++;this.revise(job.task);}
      this.record(job.task,applied?'task.work.completed':'task.work.late',{jobId:id,slot:job.body.slot,applied},job.body.authority);
      return {taskId:job.task.id,jobId:id,applied,status:applied?'completed':'late',taskVersion:job.task.version,slotVersion:applied?job.body.slotVersion+1:job.body.slotVersion};
    });
  }
  private entries(agentId:string,id:string){return this.db.prepare('SELECT s.slot,s.version,j.id,j.body,j.result FROM task_slots s JOIN task_jobs j ON j.id=s.job_id WHERE s.task_id=? ORDER BY s.rowid').all(id).map(row=>{
    const job=jobSchema.parse(JSON.parse(string(row.body))),result=z.object({text:z.string(),proofs:z.array(witnessSchema)}).parse(JSON.parse(string(row.result)));
    return {slot:string(row.slot),version:integer(row.version),jobId:string(row.id),job,result};});}
  read(agentId:string,id:string):Record<string,unknown>{const task=this.task(agentId,id);return {task,usage:'internal-only',
    scenes:this.db.prepare('SELECT route,plugin FROM task_members WHERE task_id=? ORDER BY rowid').all(id).map(row=>({route:string(row.route),plugin:string(row.plugin)})),
    links:this.links(agentId,id).map(link=>{const evidence=this.evidence(agentId,link.proof);return {id:link.id,proof:link.proof,valid:!!evidence,...(evidence?{text:evidence.text}:{})};}),
    entries:this.entries(agentId,id).map(entry=>{const valid=entry.job.taskEpoch===task.epoch&&entry.result.proofs.every(p=>!!this.evidence(agentId,p));return {slot:entry.slot,version:entry.version,valid,...(valid?{text:entry.result.text,proofs:entry.result.proofs}:{})};}),
    jobs:this.db.prepare('SELECT id,status FROM task_jobs WHERE task_id=? ORDER BY rowid').all(id).map(row=>({id:string(row.id),status:string(row.status)})),
    observations:this.db.prepare('SELECT activity_id,job_id,late FROM task_observations WHERE task_id=? ORDER BY rowid').all(id).map(row=>({activityId:string(row.activity_id),jobId:string(row.job_id),late:row.late===1}))};}
  sceneItems(scope:TimelineScope):ContextItem[]{const selection=this.selection(scope);if(!selection.taskId)return [];const task=this.task(scope.agentId,selection.taskId);if(task.status!=='active')return [];
    const items:ContextItem[]=[],expiresAt='9999-12-31T23:59:59.999Z';
    for(const link of this.links(scope.agentId,task.id)){
      if(link.proof.route!==scope.route)continue;const evidence=this.evidence(scope.agentId,link.proof,'expression');if(!evidence)continue;
      items.push({id:`task-link:${link.id}`,version:hash([selection.version,link.proof]),text:JSON.stringify({taskId:task.id,kind:'task-evidence',text:evidence.text}),expiresAt,
        sources:[{ref:`dafeiyu:task-link:${link.id}`,version:String(selection.version),hash:hash(link.proof)}]});
    }
    for(const entry of this.entries(scope.agentId,task.id)){
      if(entry.job.taskEpoch!==task.epoch||entry.job.authority.route!==scope.route||!entry.result.proofs.length||entry.result.proofs.some(p=>p.route!==scope.route||!this.evidence(scope.agentId,p,'expression')))continue;
      items.push({id:`task-slot:${task.id}:${entry.slot}`,version:hash([selection.version,entry.version,task.epoch]),text:JSON.stringify({taskId:task.id,kind:'task-result',text:entry.result.text}),expiresAt,
        sources:[{ref:`dafeiyu:task-work:${entry.jobId}`,version:String(entry.version),hash:hash(entry.result.proofs)}]});
    }
    return items.slice(0,12);
  }
  view(authority:ObservationAuthority,id:string):Record<string,unknown>{this.member(authority,id);return {taskId:id,selection:this.selection(authority),items:this.selection(authority).taskId===id?this.sceneItems(authority):[]};}
  recover(agentId:string):void {this.transaction(()=>{for(const row of this.db.prepare("SELECT j.id,j.task_id FROM task_jobs j JOIN task_workspaces t ON t.id=j.task_id WHERE t.agent_id=? AND j.status='running'").all(agentId)){
    this.db.prepare("UPDATE task_jobs SET status='interrupted' WHERE id=?").run(row.id!);this.record(this.task(agentId,string(row.task_id)),'task.work.interrupted',{jobId:string(row.id)});
  }});}
}
