import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { conversationKey,ConversationSchema,ExpressionPolicySchema,redactContent,redactJson } from '@dafeiyu/contracts';
import type { TaskExpressionProvider,Conversation,Json } from '@dafeiyu/contracts';
import type { NewEvent } from '@dafeiyu/journal';
import type { MemoryStore } from './store.js';
import { TaskWorkspace,witnessSchema } from './task-workspace.js';
import type { Witness } from './task-workspace.js';
import { digest,canonical } from './retrieval-profile.js';
import { rebuildExpression,verifyPersonaDelivery } from './expression-runtime.js';
import { MEMORY_VERSION } from './types.js';

const text=(v:unknown)=>z.string().parse(v),integer=(v:unknown)=>z.number().int().parse(v),hash=(v:unknown)=>digest(canonical(z.json().parse(v)));
const questionSchema=z.strictObject({inboundId:z.uuid(),target:ConversationSchema,route:z.string(),text:z.string(),ref:z.string(),hash:z.string(),fence:z.string()});
const policyProofSchema=z.strictObject({id:z.string(),version:z.number().int().positive()});
const evidenceSchema=z.strictObject({id:z.string(),text:z.string(),proof:witnessSchema});
const conclusionSchema=z.strictObject({slot:z.string(),version:z.number().int(),jobId:z.string(),text:z.string(),proofs:z.array(witnessSchema)});
const packetSchema=z.strictObject({taskEpoch:z.number().int(),question:questionSchema,policy:policyProofSchema.nullable(),evidence:z.array(evidenceSchema),conclusions:z.array(conclusionSchema),expiresAt:z.string()});
type Packet=z.infer<typeof packetSchema>;
const policyBodySchema=z.strictObject({input:ExpressionPolicySchema,proofs:z.array(witnessSchema)});

export function migrateExpression(db:DatabaseSync){
  const version=db.prepare('PRAGMA user_version').get()?.user_version;
  if(version===6||version===7){for(const name of ['expression_policies','expression_policy_revisions','expression_requests','expression_packets','expression_jobs'])db.prepare(`SELECT * FROM ${name} LIMIT 0`).all();return;}
  if(version!==5)throw new Error('Unsupported expression schema');
  db.exec(`CREATE TABLE expression_policies(agent_id TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,id));
    CREATE TABLE expression_policy_revisions(agent_id TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,id,version));
    CREATE TABLE expression_requests(agent_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,request_id));
    CREATE TABLE expression_packets(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES task_workspaces(id),version INTEGER NOT NULL,withdrawn INTEGER NOT NULL,body TEXT NOT NULL);
    CREATE TABLE expression_jobs(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,task_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,packet_id TEXT NOT NULL REFERENCES expression_packets(id),status TEXT NOT NULL,body TEXT,UNIQUE(agent_id,task_id,request_id));
    CREATE TRIGGER expression_policy_revision_immutable BEFORE UPDATE ON expression_policy_revisions BEGIN SELECT RAISE(ABORT,'Immutable expression policy'); END;
    CREATE TRIGGER expression_policy_revision_retain BEFORE DELETE ON expression_policy_revisions BEGIN SELECT RAISE(ABORT,'Retain expression policy'); END;
    CREATE TRIGGER expression_packet_immutable BEFORE UPDATE OF id,agent_id,task_id,body ON expression_packets BEGIN SELECT RAISE(ABORT,'Immutable expression inputs'); END;
    CREATE TRIGGER expression_packet_retain BEFORE DELETE ON expression_packets BEGIN SELECT RAISE(ABORT,'Withdraw expression packet'); END;
    CREATE TRIGGER expression_job_binding_immutable BEFORE UPDATE OF id,agent_id,task_id,request_id,fingerprint,packet_id ON expression_jobs BEGIN SELECT RAISE(ABORT,'Immutable generation binding'); END;
    CREATE TRIGGER expression_job_result_immutable BEFORE UPDATE ON expression_jobs WHEN OLD.status<>'running' BEGIN SELECT RAISE(ABORT,'Terminal generation result'); END;
    CREATE TRIGGER expression_job_retain BEFORE DELETE ON expression_jobs BEGIN SELECT RAISE(ABORT,'Retain generation record'); END;
    PRAGMA user_version=6;`);
}

export class TaskExpression {
  private readonly stop=new AbortController();
  private readonly pending=new Set<Promise<Record<string,unknown>>>();
  constructor(private readonly db:DatabaseSync,private readonly transaction:<T>(work:()=>T)=>T,private readonly store:MemoryStore,private readonly tasks:TaskWorkspace,private readonly ctx:Context){}
  private audit(agentId:string,taskId:string|null,type:string,data:Record<string,Json>){const id=randomUUID(),event:NewEvent={agentId,
    route:conversationKey(agentId,{channel:'agent-task',account:agentId,kind:'local',id:taskId??'$expression-policy'}),traceId:taskId??id,operationId:taskId??id,causedBy:null,
    plugin:'memory',pluginVersion:MEMORY_VERSION,type,occurredAt:new Date().toISOString(),sources:[],data};this.db.prepare('INSERT INTO memory_events VALUES(?,?,?)').run(id,JSON.stringify(event),'');this.db.prepare('INSERT INTO outbox(event_id) VALUES(?)').run(id);}
  private request<T extends Record<string,unknown>>(agentId:string,requestId:string,input:unknown,write:()=>T):T{return this.transaction(()=>{
    const fingerprint=hash(input),old=this.db.prepare('SELECT * FROM expression_requests WHERE agent_id=? AND request_id=?').get(agentId,requestId);
    if(old){if(old.fingerprint!==fingerprint)throw new Error('expression_idempotency_conflict');return z.record(z.string(),z.unknown()).parse(JSON.parse(text(old.receipt))) as T;}
    const result=write();this.db.prepare('INSERT INTO expression_requests VALUES(?,?,?,?)').run(agentId,requestId,fingerprint,JSON.stringify(result));return result;});}
  policy(agentId:string,input:Parameters<TaskExpressionProvider['policy']>[1]){return this.request(agentId,input.requestId,{kind:'policy',input},()=>{
    const old=this.db.prepare('SELECT version FROM expression_policies WHERE agent_id=? AND id=?').get(agentId,input.id);if((old?integer(old.version):0)!==input.expectedVersion)throw new Error('expression_policy_conflict');
    const proofs=input.enabled?input.sources.map(s=>{const scope={agentId,route:conversationKey(agentId,s.conversation)},memory=this.store.read(scope,s.id,'normal',s.revision,'expression');
      const proof=this.tasks.memoryProof(scope,s.id,s.revision,s.version,s.contentHash);if(!memory||!proof)throw new Error('expression_source_forbidden');return proof;}):[];
    if(new Set(proofs.map(p=>hash(p))).size!==proofs.length)throw new Error('duplicate_expression_source');
    const version=input.expectedVersion+1,body=JSON.stringify({input:{...input,reason:redactContent(input.reason).value},proofs});
    this.db.prepare('INSERT INTO expression_policies VALUES(?,?,?,?) ON CONFLICT(agent_id,id) DO UPDATE SET version=excluded.version,body=excluded.body').run(agentId,input.id,version,body);
    this.db.prepare('INSERT INTO expression_policy_revisions VALUES(?,?,?,?)').run(agentId,input.id,version,body);this.audit(agentId,null,'task.expression.policy',{id:input.id,version,enabled:input.enabled});return {id:input.id,version};});}
  private expressionPolicy(agentId:string,ref:Packet['policy'],target:Conversation){if(!ref)return null;
    const row=this.db.prepare('SELECT * FROM expression_policies WHERE agent_id=? AND id=?').get(agentId,ref.id);if(!row||row.version!==ref.version)throw new Error('expression_policy_unavailable');
    const policy=policyBodySchema.parse(JSON.parse(text(row.body)));if(!policy.input.enabled||conversationKey(agentId,policy.input.target)!==conversationKey(agentId,target))throw new Error('expression_policy_unavailable');return policy;}
  private allowed(agentId:string,proof:Witness,target:Conversation,policy:ReturnType<TaskExpression['expressionPolicy']>):boolean{
    if(!this.tasks.validProof(agentId,proof))return false;const scope={agentId,route:proof.route},targetRoute=conversationKey(agentId,target);
    if(proof.kind==='observation')return proof.route===targetRoute&&!!this.store.observations.activity(scope,proof.id,'expression');
    // Internal grant validity and original expression restrictions are both required.
    if(!this.store.read(scope,proof.id,'normal',proof.revision,'expression'))return false;
    if(proof.route===targetRoute)return true;
    const {authorization:_authorization,range:_range,...base}=proof;
    return !!policy?.proofs.some(p=>hash(p)===hash(base)&&this.tasks.validProof(agentId,p));
  }
  private question(agentId:string,inboundId:string,knownRef?:string){
    const message=this.ctx.dafeiyu.journal.get(inboundId),scope={agentId,route:message.route};
    if(conversationKey(agentId,message.message.conversation)!==message.route)throw new Error('expression_question_unavailable');
    const anchor=knownRef?/^dafeiyu:source:([a-f0-9-]+):0$/.exec(knownRef)?.[1]:undefined;
    const event=knownRef?(anchor?this.ctx.dafeiyu.journal.scopedEvent(scope,anchor):null):this.ctx.dafeiyu.journal.searchTimeline(scope,{type:'message.accepted',traceId:inboundId,limit:1}).items[0];
    if(!event||event.agentId!==agentId||event.type!=='message.accepted'||event.traceId!==inboundId)throw new Error('expression_question_unavailable');
    const ref=`dafeiyu:source:${event.id}:0`,body=redactContent(JSON.stringify(redactJson({sender:message.message.sender,occurredAt:message.message.occurredAt,text:message.message.text}).value,null,2)).value;
    const contentHash=digest(body),same=(a:string,b:string)=>this.ctx.dafeiyuTimeline.sameArchivedSource(scope,a,b);
    if(!this.ctx.dafeiyuTimeline.checkArchivedSource(scope,ref,contentHash)||this.store.suppressedEvidence(scope,contentHash,r=>same(r,ref)))throw new Error('expression_question_unavailable');
    return {inboundId,target:message.message.conversation,route:message.route,text:redactContent(message.message.text).value,ref,hash:contentHash,fence:this.store.sourceFence(scope,contentHash,r=>same(r,ref))};
  }
  prepare(agentId:string,taskId:string,input:Parameters<TaskExpressionProvider['prepare']>[2]){return this.request(agentId,input.requestId,{kind:'prepare',taskId,input},()=>{
    const task=this.tasks.state(agentId,taskId);if(task.status!=='active')throw new Error('task_not_active');
    if(new Set(input.linkIds).size!==input.linkIds.length||new Set(input.slots).size!==input.slots.length)throw new Error('duplicate_expression_item');
    const question=this.question(agentId,input.inboundId),policy=this.expressionPolicy(agentId,input.policy??null,question.target),evidence:Packet['evidence']=[],conclusions:Packet['conclusions']=[],decisions:{kind:string;id:string;allowed:boolean}[]=[];
    for(const id of input.linkIds){const link=this.tasks.expressionLink(agentId,taskId,id),allowed=!!link&&link.proof.kind==='memory'&&this.allowed(agentId,link.proof,question.target,policy);
      decisions.push({kind:'link',id,allowed});if(allowed&&link)evidence.push({id:`S${evidence.length+1}`,text:link.text,proof:link.proof});}
    for(const slot of input.slots){const entry=this.tasks.expressionSlot(agentId,taskId,slot),allowed=!!entry&&entry.proofs.every(p=>this.allowed(agentId,p,question.target,policy));
      decisions.push({kind:'slot',id:slot,allowed});if(allowed&&entry)conclusions.push(entry);}
    const packet:Packet={taskEpoch:task.epoch,question,policy:input.policy??null,evidence,conclusions,expiresAt:new Date(Date.now()+900000).toISOString()};
    if(Buffer.byteLength(JSON.stringify({question:question.text,evidence:evidence.map(e=>({id:e.id,text:e.text}))}))>24000)throw new Error('expression_input_capacity');
    const packetId=randomUUID();this.db.prepare('INSERT INTO expression_packets VALUES(?,?,?,1,0,?)').run(packetId,agentId,taskId,JSON.stringify(packet));
    this.audit(agentId,taskId,'task.expression.prepared',{packetId,allowedEvidence:evidence.length,allowedConclusions:conclusions.length});
    return {packetId,version:1,target:question.target,decisions,usage:'target-material-only',sendAuthorized:false};});}
  private packet(agentId:string,taskId:string,id:string,target?:Conversation){
    const row=this.db.prepare('SELECT * FROM expression_packets WHERE id=? AND agent_id=? AND task_id=?').get(id,agentId,taskId);if(!row||row.withdrawn!==0)throw new Error('expression_packet_unavailable');
    const packet=packetSchema.parse(JSON.parse(text(row.body))),task=this.tasks.state(agentId,taskId);
    if(task.status!=='active'||task.epoch!==packet.taskEpoch||Date.parse(packet.expiresAt)<=Date.now()||target&&conversationKey(agentId,target)!==packet.question.route)throw new Error('expression_packet_unavailable');
    if(hash(this.question(agentId,packet.question.inboundId,packet.question.ref))!==hash(packet.question))throw new Error('expression_question_changed');
    const policy=this.expressionPolicy(agentId,packet.policy,packet.question.target);
    for(const evidence of packet.evidence)if(!this.allowed(agentId,evidence.proof,packet.question.target,policy))throw new Error('expression_source_unavailable');
    for(const entry of packet.conclusions){const current=this.tasks.expressionSlot(agentId,taskId,entry.slot);
      if(!current||hash(current)!==hash(entry)||entry.proofs.some(p=>!this.allowed(agentId,p,packet.question.target,policy)))throw new Error('expression_conclusion_unavailable');}
    return packet;
  }
  open(agentId:string,taskId:string,input:Parameters<TaskExpressionProvider['open']>[2]){return this.transaction(()=>{const packet=this.packet(agentId,taskId,input.packetId,input.target);
    return {packetId:input.packetId,target:packet.question.target,usage:'target-material-only',sendAuthorized:false,question:packet.question.text,
      evidence:packet.evidence.map(({id,text})=>({id,text})),conclusions:packet.conclusions.map(({slot,text})=>({slot,text}))};});}
  withdraw(agentId:string,taskId:string,input:Parameters<TaskExpressionProvider['withdraw']>[2]){return this.request(agentId,input.requestId,{kind:'withdraw',taskId,input},()=>{
    const row=this.db.prepare('SELECT version,withdrawn FROM expression_packets WHERE id=? AND agent_id=? AND task_id=?').get(input.packetId,agentId,taskId);
    if(!row||row.version!==input.expectedVersion||row.withdrawn!==0)throw new Error('expression_version_conflict');
    this.db.prepare('UPDATE expression_packets SET version=version+1,withdrawn=1 WHERE id=?').run(input.packetId);this.audit(agentId,taskId,'task.expression.withdrawn',{packetId:input.packetId});return {packetId:input.packetId,version:input.expectedVersion+1};});}
  async generate(agentId:string,taskId:string,input:Parameters<TaskExpressionProvider['generate']>[2],signal:AbortSignal,outerGuard:()=>void){
    const work=this.execute(agentId,taskId,input,AbortSignal.any([signal,this.stop.signal]),outerGuard);this.pending.add(work);
    try{return await work;}finally{this.pending.delete(work);}
  }
  async close(){this.stop.abort();await Promise.allSettled([...this.pending]);}
  private async execute(agentId:string,taskId:string,input:Parameters<TaskExpressionProvider['generate']>[2],signal:AbortSignal,outerGuard:()=>void){
    const started=this.transaction(()=>{outerGuard();signal.throwIfAborted();const packet=this.packet(agentId,taskId,input.packetId,input.target),fingerprint=hash(input);
      const old=this.db.prepare('SELECT * FROM expression_jobs WHERE agent_id=? AND task_id=? AND request_id=?').get(agentId,taskId,input.requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new Error('expression_idempotency_conflict');if(old.status!=='completed')throw new Error('expression_job_not_completed');return {id:text(old.id),duplicate:true};}
      if(!packet.evidence.length)throw new Error('expression_insufficient_evidence');
      const id=randomUUID();this.db.prepare("INSERT INTO expression_jobs VALUES(?,?,?,?,?,?,'running',NULL)").run(id,agentId,taskId,input.requestId,fingerprint,input.packetId);
      this.audit(agentId,taskId,'task.expression.started',{jobId:id,packetId:input.packetId});return {id,duplicate:false};});
    if(started.duplicate)return this.result(agentId,taskId,{jobId:started.id,target:input.target});
    const guard=()=>{outerGuard();signal.throwIfAborted();this.packet(agentId,taskId,input.packetId,input.target);};
    try{
      const packet=this.packet(agentId,taskId,input.packetId,input.target);
      const output=await rebuildExpression(this.ctx,{question:packet.question.text,evidence:packet.evidence.map(({id,text})=>({id,text}))},signal,guard);
      this.transaction(()=>{guard();const result={...output,packetVersion:1,packetHash:hash(packet),exposure:packet.evidence.map(e=>e.proof),question:packet.question};
        this.db.prepare("UPDATE expression_jobs SET status='completed',body=? WHERE id=?").run(JSON.stringify(result),started.id);this.audit(agentId,taskId,'task.expression.completed',{jobId:started.id,packetId:input.packetId});});
      return this.result(agentId,taskId,{jobId:started.id,target:input.target});
    }catch(error){this.transaction(()=>{this.db.prepare("UPDATE expression_jobs SET status='failed' WHERE id=? AND status='running'").run(started.id);this.audit(agentId,taskId,'task.expression.failed',{jobId:started.id});});throw error;}
  }
  result(agentId:string,taskId:string,input:Parameters<TaskExpressionProvider['result']>[2]){return this.transaction(()=>{
    const row=this.db.prepare("SELECT * FROM expression_jobs WHERE id=? AND agent_id=? AND task_id=? AND status='completed'").get(input.jobId,agentId,taskId);if(!row)throw new Error('expression_result_unavailable');
    const packet=this.packet(agentId,taskId,text(row.packet_id),input.target),body=z.object({answer:z.string(),citations:z.array(z.string()),insufficient:z.boolean(),packetHash:z.string(),exposure:z.array(witnessSchema),question:questionSchema}).parse(JSON.parse(text(row.body)));
    if(body.packetHash!==hash(packet)||hash(body.exposure)!==hash(packet.evidence.map(e=>e.proof))||hash(body.question)!==hash(packet.question))throw new Error('expression_result_unavailable');
    return {jobId:input.jobId,packetId:text(row.packet_id),target:packet.question.target,answer:body.answer,citations:body.citations,insufficient:body.insufficient,usage:'target-draft-only',sendAuthorized:false};});
  }
  deliveryMaterial(agentId:string,taskId:string,jobId:string,target:Conversation){return this.transaction(()=>{
    const result=this.result(agentId,taskId,{jobId,target}),packet=this.packet(agentId,taskId,result.packetId,target),selection=this.tasks.selection({agentId,route:packet.question.route});
    if(selection.taskId!==taskId)throw new Error('delivery_task_not_selected');
    return {jobId,packetId:result.packetId,inboundId:packet.question.inboundId,target:packet.question.target,question:packet.question.text,draft:result.answer,
      evidence:packet.evidence.map(({id,text})=>({id,text})),sourceStamp:hash({packet,result}),selectionVersion:selection.version,expiresAt:packet.expiresAt};
  });}
  async verifyDelivery(agentId:string,taskId:string,jobId:string,target:Conversation,answer:string,signal:AbortSignal,guard:()=>void){
    const material=this.deliveryMaterial(agentId,taskId,jobId,target);await verifyPersonaDelivery(this.ctx,{question:material.question,evidence:material.evidence},answer,signal,()=>{
      guard();if(hash(this.deliveryMaterial(agentId,taskId,jobId,target))!==hash(material))throw new Error('delivery_material_changed');});
  }
  recover(agentId:string){this.transaction(()=>{for(const row of this.db.prepare("SELECT id,task_id FROM expression_jobs WHERE agent_id=? AND status='running'").all(agentId)){
    this.db.prepare("UPDATE expression_jobs SET status='interrupted' WHERE id=?").run(row.id!);this.audit(agentId,text(row.task_id),'task.expression.interrupted',{jobId:text(row.id)});}});}
}
