import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ContinuityCheckpointSchema,ContextItemSchema,ExecutionContributionSchema,PersonaSourceRefSchema,PersonaRequestIdSchema,TaskIntentEventSchema,TaskObjectionSchema,TaskResolutionSchema,redactJson,SourceDependencySchema } from '@dafeiyu/contracts';
import type { PersonaAccess,PersonaSourceRef,ContinuityCheckpoint,TaskIntentEvent } from '@dafeiyu/contracts';
import type { MemoryStore } from './store.js';
import type { ExecutionSources } from './execution-sources.js';
import type { PersonaResolver } from './material.js';
import { personaDigest,personaScope,sourceKey } from './persona-digest.js';

export const evidenceSelectionSchema=z.strictObject({requestId:PersonaRequestIdSchema,expectedVersion:z.number().int().nonnegative(),entries:z.array(PersonaSourceRefSchema).max(16),reason:z.string().trim().min(1).max(1000)});
const selectionReceipt=z.strictObject({kind:z.literal('execution-selection'),version:z.number().int().nonnegative(),entries:z.array(PersonaSourceRefSchema).max(16)});

/** The existing memory database owns task evidence, intent events and continuity indexes.
 * No task goal or DSH message history is duplicated here. */
export class ExecutionMemoryState {
  constructor(private readonly db:DatabaseSync,private readonly memory:MemoryStore,private readonly sources:ExecutionSources,private readonly resolve:PersonaResolver){}
  private task(access:PersonaAccess){access.guard();const scope=access.view.scope;if(scope.kind!=='task')throw new Error('TASK_REQUIRED');
    const task=this.db.prepare('SELECT epoch,status FROM task_workspaces WHERE id=? AND agent_id=?').get(scope.taskId,scope.agentId);
    if(!task||task.epoch!==access.intentVersion||task.status!=='active')throw new Error('TASK_NOT_ACTIVE');return scope;}
  private event(access:PersonaAccess,type:string,data:unknown,id=randomUUID()){
    this.db.prepare('INSERT INTO execution_memory_outbox(id,body) VALUES(?,?)').run(id,JSON.stringify({id,type,scope:access.view.scope,runId:access.view.runId,origin:access.view.origin,
      operationId:access.operationId,causedBy:access.startedEventId,producer:access.producer,at:new Date().toISOString(),data}));
  }
  private bump(access:PersonaAccess){this.db.prepare('INSERT INTO scope_generations VALUES(?,?,1) ON CONFLICT(agent_id,route) DO UPDATE SET generation=generation+1').run(access.view.scope.agentId,personaScope(access.view.scope));}
  generation(access:PersonaAccess){const scope=this.task(access);return this.memory.generation({agentId:scope.agentId,route:scope.scopeKey})
    +Number(this.db.prepare('SELECT coalesce(sum(state_version),0) AS n FROM execution_sources WHERE scope_key=?').get(scope.scopeKey)?.n)
    +Number(this.db.prepare('SELECT coalesce(sum(version),0) AS n FROM memory_self WHERE agent_id=?').get(scope.agentId)?.n);}
  private writeHistory(kind:string,id:string,history:readonly import('@dafeiyu/contracts').SourceDependency[]){this.db.prepare('INSERT INTO persona_dependencies VALUES(?,?,?,?,?)').run(kind,id,1,'history',JSON.stringify(history));}
  private historyValid(access:PersonaAccess,kind:string,id:string,hash:string|undefined){if(!hash)return false;const row=this.db.prepare('SELECT body FROM persona_dependencies WHERE owner_kind=? AND owner_id=? AND source_key=?').get(kind,id,'history');
    if(!row)return false;const history=z.array(SourceDependencySchema).parse(JSON.parse(String(row.body)));return personaDigest(history)===hash&&(!history.length||!!access.validateHistory?.(history));}
  expose(access:PersonaAccess,ref:PersonaSourceRef){this.task(access);if(!this.resolve(access,ref))throw new Error('SOURCE_STALE');const receipt={kind:'source-exposure',operationId:access.operationId,source:ref};
    this.command(access,`exposure:${personaDigest(receipt)}`,receipt,z.json().parse,()=>{this.event(access,'execution.source.opened',{source:sourceKey(ref)});return z.json().parse(receipt);});}
  operationSources(access:PersonaAccess,id:string){return this.db.prepare("SELECT receipt FROM execution_memory_requests WHERE scope_key=? AND json_extract(receipt,'$.kind')='source-exposure' AND json_extract(receipt,'$.operationId')=?").all(personaScope(access.view.scope),id)
    .map(row=>z.object({source:PersonaSourceRefSchema}).parse(JSON.parse(String(row.receipt))).source).filter(ref=>!!this.resolve(access,ref));}
  changeContribution(access:PersonaAccess,raw:unknown){const input=z.strictObject({requestId:PersonaRequestIdSchema,id:z.uuid(),expectedVersion:z.number().int().positive(),deleted:z.boolean(),reason:z.string().trim().min(1).max(500)}).parse(raw),scope=this.task(access);
    const row=this.db.prepare('SELECT i.id FROM memory_items i JOIN execution_contributions c ON i.id=c.memory_id WHERE i.id=? AND i.agent_id=? AND i.route=?').get(input.id,scope.agentId,scope.scopeKey);if(!row)throw new Error('SCOPE_DENIED');
    return this.withSources(access,()=>this.memory.mutate({agentId:scope.agentId,route:scope.scopeKey,traceId:access.view.runId,operationId:access.operationId,startedEventId:access.startedEventId!},{action:input.deleted?'delete':'restore',requestId:`execution:${personaDigest([access.producer,input.requestId])}`,id:input.id,expectedVersion:input.expectedVersion,reason:input.reason},{executionScope:scope}));}
  private command<T>(access:PersonaAccess,requestId:string,input:unknown,parse:(raw:unknown)=>T,write:()=>T):T{
    const scope=this.task(access),fingerprint=personaDigest(input);return this.memory.atomic(()=>{
      const old=this.db.prepare('SELECT fingerprint,receipt FROM execution_memory_requests WHERE scope_key=? AND producer=? AND request_id=?').get(scope.scopeKey,access.producer,requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return parse(JSON.parse(String(old.receipt)));}
      const result=write();(access.commitGuard??access.guard)();this.db.prepare('INSERT INTO execution_memory_requests VALUES(?,?,?,?,?)').run(scope.scopeKey,access.producer,requestId,fingerprint,JSON.stringify(result));return result;
    });
  }
  withSources<T>(access:PersonaAccess,work:()=>T):T{return this.memory.withExecutionValidator((scope,evidence,purpose)=>{
    if(purpose!=='internal'||scope.agentId!==access.view.scope.agentId||scope.route!==personaScope(access.view.scope))return 'unavailable';
    const id=evidence.ref.slice('dafeiyu:execution-source:'.length),ref=this.sources.reference(access,id);
    if(!ref)return 'deleted';if(ref.version!==evidence.version||ref.contentHash!==evidence.contentHash)return 'changed';return this.resolve(access,ref)?'valid':'unavailable';
  },work);}
  memoryMaterial(access:PersonaAccess,ref:PersonaSourceRef){if(ref.kind!=='memory'||ref.scopeKey!==personaScope(access.view.scope)||ref.agentId!==access.view.scope.agentId||ref.authorization||ref.range||ref.selectionId)return null;
    return this.withSources(access,()=>{const item=this.memory.read({agentId:ref.agentId,route:ref.scopeKey},ref.id,'normal',ref.revision,'internal');
      if(!item||item.boundary.kind!=='task'||item.version!==ref.version||item.contentHash!==ref.contentHash)return null;
      const row=this.db.prepare('SELECT body FROM execution_contributions WHERE memory_id=?').get(ref.id);if(!row)return null;
      const body=z.object({source:PersonaSourceRefSchema,dependency:PersonaSourceRefSchema.optional()}).parse(JSON.parse(String(row.body))),material=this.resolve(access,body.dependency??body.source);
      return material?{text:item.content,dependencies:[body.dependency??body.source,...material.dependencies],rootSources:material.rootSources}:null;});
  }
  contribute(access:PersonaAccess,raw:unknown){const input=ExecutionContributionSchema.parse(raw);
    const receipt=z.strictObject({id:z.uuid(),revision:z.number().int().positive(),version:z.number().int().positive(),eventId:z.uuid(),generation:z.number().optional(),duplicate:z.boolean(),source:PersonaSourceRefSchema});
    return this.command(access,input.requestId,{kind:'contribute',input},value=>receipt.parse(value),()=>{
      const ref=this.sources.reference(access,input.source);if(!ref||ref.version!==input.version)throw new Error('SOURCE_STALE');const body=this.sources.metadata(access,ref);
      let content:string;
      if(input.mode==='original'){if(input.text!==undefined||input.start!==undefined||input.end!==undefined)throw new Error('INVALID_INPUT');content=body.text;}
      else if(input.mode==='excerpt'){const chars=Array.from(body.text);if(input.text!==undefined||input.start===undefined||input.end===undefined||input.start>=input.end||input.end>chars.length)throw new Error('INVALID_INPUT');content=chars.slice(input.start,input.end).join('');}
      else {if(!input.text||input.start!==undefined||input.end!==undefined)throw new Error('INVALID_INPUT');content=input.text;}
      if(content.length>8000)throw new Error('CAPACITY_EXCEEDED');if(redactJson({content,reason:input.reason}).redacted)throw new Error('PRIVATE_INPUT_REJECTED');
      // A summary is a new model statement with all actual input dependencies, not a primary fact.
      const dependency=input.mode==='summary'?this.sources.selfReport(access,`contribution:${personaDigest(input.requestId)}`,content,[ref]):ref;
      const scope=this.task(access),created=this.withSources(access,()=>this.memory.mutate({agentId:scope.agentId,route:scope.scopeKey,traceId:access.view.runId,operationId:access.operationId,startedEventId:access.startedEventId!},
        {action:'create',requestId:`execution:${personaDigest([access.producer,input.requestId])}`,value:{kind:'experience',claimType:input.mode==='summary'||body.kind==='digest'?'inference':body.kind==='primary'?'reported_claim':'self_report',content,
          sources:[{kind:'execution',ref:`dafeiyu:execution-source:${dependency.id}`,version:dependency.version,contentHash:dependency.contentHash}]}},{executionScope:scope}));
      this.db.prepare('INSERT INTO execution_contributions VALUES(?,?,?)').run(created.id,ref.id,JSON.stringify({schemaVersion:1,source:ref,dependency,mode:input.mode,reason:input.reason,
        range:input.mode==='excerpt'?{start:input.start,end:input.end}:null,coverage:body.schemaVersion===2?body.coverage:[],completeness:body.schemaVersion===2?body.completeness:'unknown'}));
      const memory=this.withSources(access,()=>this.memory.read({agentId:scope.agentId,route:scope.scopeKey},created.id,'normal',undefined,'internal'));
      if(!memory)throw new Error('SOURCE_STALE');return receipt.parse({...created,source:{kind:'memory',id:memory.id,agentId:scope.agentId,scopeKey:scope.scopeKey,revision:memory.revision,version:memory.version,contentHash:memory.contentHash}});
    });
  }
  selection(access:PersonaAccess){this.task(access);const row=this.db.prepare("SELECT receipt FROM execution_memory_requests WHERE scope_key=? AND json_extract(receipt,'$.kind')='execution-selection' ORDER BY rowid DESC LIMIT 1").get(personaScope(access.view.scope));
    return row?selectionReceipt.parse(JSON.parse(String(row.receipt))):selectionReceipt.parse({kind:'execution-selection',version:0,entries:[]});}
  select(access:PersonaAccess,raw:unknown){const input=evidenceSelectionSchema.parse(raw);return this.command(access,input.requestId,{kind:'select',input},value=>selectionReceipt.parse(value),()=>{
    if(this.selection(access).version!==input.expectedVersion)throw new Error('VERSION_CONFLICT');if(new Set(input.entries.map(sourceKey)).size!==input.entries.length)throw new Error('INVALID_INPUT');
    for(const ref of input.entries)if(!this.resolve(access,ref))throw new Error('SOURCE_STALE');const result=selectionReceipt.parse({kind:'execution-selection',version:input.expectedVersion+1,entries:input.entries});
    this.bump(access);this.event(access,'execution.evidence.selected',{version:result.version,sources:input.entries.map(sourceKey),reason:input.reason});return result;
  });}
  context(access:PersonaAccess){const selection=this.selection(access),items=[];let omitted=0;
    for(const ref of selection.entries){const material=this.resolve(access,ref);if(!material){omitted++;continue;}
      const meta=ref.kind==='execution-source'?this.sources.metadata(access,ref):null;
      const item=ContextItemSchema.safeParse({id:`execution:${sourceKey(ref)}`,version:String(ref.version),text:JSON.stringify({kind:'selected-task-evidence',source:ref,
        completeness:meta?.schemaVersion===2?meta.completeness:'unknown',coverage:meta?.schemaVersion===2?meta.coverage:[],text:material.text}),expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:`dafeiyu:execution-evidence:${ref.id}`,version:String(ref.version),hash:ref.contentHash}]});if(item.success)items.push(item.data);else omitted++;}
    if(omitted)items.push(ContextItemSchema.parse({id:'execution:omitted',version:String(selection.version),text:`有${omitted}项已选内部证据失效、过大或不可用，不能补造正文。`,expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:'dafeiyu:execution-omitted',version:String(selection.version),hash:personaDigest(omitted)}]}));return items;
  }
  validateContext(access:PersonaAccess,item:import('@dafeiyu/contracts').ContextItem):boolean{return this.context(access).some(current=>personaDigest(current)===personaDigest(item));}
  acceptIntent(access:PersonaAccess){const scope=this.task(access);this.appendIntent(access,`accepted:${access.view.runId}`,{kind:'accepted',motivation:access.motivation,category:'none',blocking:false,reason:'受信生产者提交；任务目标仍以原Task和epoch为准',evidence:[],resolves:null},scope.taskId);}
  private appendIntent(access:PersonaAccess,requestId:string,body:Pick<TaskIntentEvent,'kind'|'motivation'|'category'|'blocking'|'reason'|'evidence'|'resolves'|'actions'>,taskId=this.task(access).taskId){
    const fingerprint=personaDigest({taskId,epoch:access.intentVersion,body}),scope=access.view.scope;
    return this.memory.atomic(()=>{const old=this.db.prepare('SELECT fingerprint,body FROM task_intent_events WHERE agent_id=? AND producer=? AND request_id=?').get(scope.agentId,access.producer,requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return TaskIntentEventSchema.parse(JSON.parse(String(old.body)));}
      for(const ref of body.evidence)if(!this.resolve(access,ref))throw new Error('SOURCE_STALE');if(redactJson({reason:body.reason}).redacted)throw new Error('PRIVATE_INPUT_REJECTED');
      const history=access.historyDependencies??[];if(history.length&&!access.validateHistory?.(history))throw new Error('SOURCE_STALE');
      const event=TaskIntentEventSchema.parse({schemaVersion:1,id:randomUUID(),agentId:scope.agentId,taskId,taskEpoch:access.intentVersion,runId:access.view.runId,requestId,producer:access.producer,...body,historyHash:personaDigest(history),createdAt:new Date().toISOString()});
      this.db.prepare('INSERT INTO task_intent_events(id,agent_id,task_id,task_epoch,producer,request_id,fingerprint,body) VALUES(?,?,?,?,?,?,?,?)').run(event.id,scope.agentId,taskId,access.intentVersion,access.producer,requestId,fingerprint,JSON.stringify(event));
      this.writeHistory('task-intent-history',event.id,history);
      this.bump(access);this.event(access,`task.intent.${event.kind}`,{id:event.id,category:event.category,blocking:event.blocking,resolves:event.resolves});(access.commitGuard??access.guard)();return event;
    });
  }
  intent(access:PersonaAccess){const scope=this.task(access),events=this.db.prepare('SELECT body FROM task_intent_events WHERE agent_id=? AND task_id=? AND task_epoch=? ORDER BY ordinal').all(scope.agentId,scope.taskId,access.intentVersion).map(row=>TaskIntentEventSchema.parse(JSON.parse(String(row.body))));
    return {motivation:events.find(event=>event.kind==='accepted')?.motivation??{kind:'unknown' as const,basis:[]},blocking:events.some(event=>event.kind==='objection'&&event.blocking&&!events.some(resolved=>resolved.kind==='resolved'&&resolved.resolves===event.id)),
      events:events.map(event=>event.evidence.every(ref=>!!this.resolve(access,ref))&&this.historyValid(access,'task-intent-history',event.id,event.historyHash)?event:{...event,reason:'该记录的依据已不可核验，正文停止使用；保留事件和阻断状态，需重新讨论。',evidence:[]})};}
  object(access:PersonaAccess,raw:unknown){const input=TaskObjectionSchema.parse(raw);if(input.blocking&&['preference','method'].includes(input.category))throw new Error('INVALID_OBJECTION');
    return this.appendIntent(access,input.requestId,{kind:'objection',motivation:this.intent(access).motivation,category:input.category,blocking:input.blocking,actions:input.actions,reason:input.reason,evidence:input.evidence,resolves:null});}
  resolveIntent(access:PersonaAccess,raw:unknown){const input=TaskResolutionSchema.parse(raw),intent=this.intent(access),event=intent.events.find(event=>event.id===input.objectionId&&event.kind==='objection');
    if(!event)throw new Error('SCOPE_DENIED');return this.appendIntent(access,input.requestId,{kind:'resolved',motivation:intent.motivation,category:event.category,blocking:false,reason:input.reason,evidence:[],resolves:event.id});}
  capture(access:PersonaAccess,raw:ContinuityCheckpoint){const scope=this.task(access),checkpoint=ContinuityCheckpointSchema.parse(raw);
    if(checkpoint.agentId!==scope.agentId||checkpoint.taskId!==scope.taskId||checkpoint.runId!==access.view.runId||checkpoint.taskEpoch!==access.intentVersion)throw new Error('SCOPE_DENIED');
    for(const ref of checkpoint.dependencies)if(!this.resolve(access,ref))throw new Error('SOURCE_STALE');const hash=personaDigest(checkpoint);
    const history=access.historyDependencies??[];if(checkpoint.historyHash!==personaDigest(history)||history.length&&!access.validateHistory?.(history))throw new Error('SOURCE_STALE');
    return this.memory.atomic(()=>{const old=this.db.prepare('SELECT body_hash FROM continuity_checkpoints WHERE id=?').get(checkpoint.id);if(old){if(old.body_hash!==hash)throw new Error('IDEMPOTENCY_CONFLICT');return {id:checkpoint.id,hash};}
      this.db.prepare('INSERT INTO continuity_checkpoints VALUES(?,?,?,?,?,?)').run(checkpoint.id,scope.agentId,scope.taskId,access.view.runId,JSON.stringify(checkpoint),hash);
      this.writeHistory('continuity-history',checkpoint.id,history);
      for(const ref of checkpoint.dependencies)this.db.prepare('INSERT INTO persona_dependencies VALUES(?,?,?,?,?)').run('continuity',checkpoint.id,1,sourceKey(ref),JSON.stringify(ref));
      this.event(access,'continuity.captured',{checkpointId:checkpoint.id,hash});access.guard();return {id:checkpoint.id,hash};
    });
  }
  checkpoint(access:PersonaAccess,id:string,historical=false){const scope=this.task(access),row=this.db.prepare('SELECT body,body_hash FROM continuity_checkpoints WHERE id=? AND agent_id=? AND task_id=?').get(id,scope.agentId,scope.taskId);if(!row)return null;
    const checkpoint=ContinuityCheckpointSchema.parse(JSON.parse(String(row.body)));return personaDigest(checkpoint)===row.body_hash&&(historical||checkpoint.taskEpoch===access.intentVersion)&&checkpoint.dependencies.every(ref=>!!this.resolve(access,ref))&&this.historyValid(access,'continuity-history',checkpoint.id,checkpoint.historyHash)?checkpoint:null;}
  bindResult(taskId:string,runId:string,epoch:number,body:unknown){z.uuid().parse(taskId);z.uuid().parse(runId);z.number().int().positive().parse(epoch);const value=z.json().parse(body),hash=personaDigest(value);
    this.memory.atomic(()=>{const old=this.db.prepare('SELECT task_id,task_epoch,body_hash FROM task_execution_results WHERE run_id=?').get(runId);if(old){if(old.task_id!==taskId||old.task_epoch!==epoch||old.body_hash!==hash)throw new Error('RESULT_BINDING_CONFLICT');return;}
      this.db.prepare('INSERT INTO task_execution_results VALUES(?,?,?,?,?)').run(taskId,runId,epoch,JSON.stringify(value),hash);});}
}
