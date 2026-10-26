import { DatabaseSync } from 'node:sqlite';
import { randomUUID,createHash } from 'node:crypto';
import { z } from 'zod';
import { DeliveryMaterialSchema } from '@dafeiyu/contracts';
import type { Conversation,SourceRef } from '@dafeiyu/contracts';
import type { Journal } from '@dafeiyu/journal';
import { CORE_VERSION } from './version.js';

export const deliveryDigest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const stateSchema=z.enum(['rendering','ready','sending','sent','not-sent','uncertain','rejected','interrupted']);
export type TaskDeliveryState=z.infer<typeof stateSchema>;
export const deliveryBindingSchema=z.strictObject({material:DeliveryMaterialSchema,route:z.string(),sessionId:z.string(),extensionId:z.string(),extensionVersion:z.string(),personaVersion:z.string(),modelHash:z.string()});
export type DeliveryBinding=z.infer<typeof deliveryBindingSchema>;
const string=(v:unknown)=>z.string().parse(v);
export class DeliveryStore {
  private readonly db:DatabaseSync;
  constructor(file:string,private readonly agentId:string,private readonly journal:Journal,deferRecovery=false){
    this.db=new DatabaseSync(file);try{this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    const version=this.db.prepare('PRAGMA user_version').get()?.user_version,app=this.db.prepare('PRAGMA application_id').get()?.application_id;
    const fresh=version===0&&app===0&&this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n===0;
    if(!fresh&&(version!==1||app!==0x44464433))throw new Error('Unsupported delivery ledger');
    if(fresh)this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE deliveries(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,task_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,job_id TEXT NOT NULL,inbound_id TEXT NOT NULL,state TEXT NOT NULL,binding TEXT NOT NULL,reply TEXT,credential TEXT,receipt TEXT,UNIQUE(agent_id,task_id,request_id),UNIQUE(agent_id,job_id),UNIQUE(agent_id,inbound_id));
      CREATE TABLE events(id TEXT PRIMARY KEY,body TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0);
      CREATE TRIGGER binding_immutable BEFORE UPDATE OF id,agent_id,task_id,request_id,fingerprint,job_id,inbound_id,binding ON deliveries BEGIN SELECT RAISE(ABORT,'Immutable delivery binding'); END;
      CREATE TRIGGER delivery_retain BEFORE DELETE ON deliveries BEGIN SELECT RAISE(ABORT,'Retain delivery outcome'); END;
      CREATE TRIGGER credential_immutable BEFORE UPDATE OF reply,credential ON deliveries WHEN OLD.credential IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable delivery credential'); END;
      CREATE TRIGGER event_body_immutable BEFORE UPDATE OF id,body ON events BEGIN SELECT RAISE(ABORT,'Immutable delivery event'); END;
      CREATE TRIGGER event_retain BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'Retain delivery event'); END;
      PRAGMA application_id=${0x44464433};PRAGMA user_version=1;COMMIT;`);
    if(!deferRecovery)this.recover();
    }catch(error){this.db.close();throw error;}
  }
  recover(){this.transaction(()=>{for(const row of this.db.prepare("SELECT id,state FROM deliveries WHERE agent_id=? AND state IN ('rendering','ready','sending')").all(this.agentId))this.transitionInside(string(row.id),stateSchema.parse(row.state),row.state==='sending'?'uncertain':'interrupted');});this.flush();}
  private transaction<T>(fn:()=>T){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  private event(id:string,state:TaskDeliveryState,sources:readonly SourceRef[]=[]){const row=this.get(id);this.db.prepare('INSERT INTO events(id,body) VALUES(?,?)').run(randomUUID(),JSON.stringify({agentId:this.agentId,route:row.binding.route,traceId:row.binding.material.inboundId,operationId:id,causedBy:null,
    type:`task.delivery.${state}`,plugin:'core',pluginVersion:CORE_VERSION,occurredAt:new Date().toISOString(),sources,data:{deliveryId:id,taskId:row.taskId,jobId:row.binding.material.jobId,status:state}}));}
  find(taskId:string,input:{requestId:string;jobId:string;target:Conversation}){
    const fingerprint=deliveryDigest({jobId:input.jobId,target:input.target});
    const row=this.db.prepare('SELECT id,fingerprint,task_id FROM deliveries WHERE agent_id=? AND task_id=? AND request_id=?').get(this.agentId,taskId,input.requestId)
      ??this.db.prepare('SELECT id,fingerprint,task_id FROM deliveries WHERE agent_id=? AND job_id=?').get(this.agentId,input.jobId);
    if(!row)return null;if(row.fingerprint!==fingerprint||row.task_id!==taskId)throw new Error('delivery_idempotency_conflict');return this.get(string(row.id));
  }
  create(taskId:string,input:{requestId:string;jobId:string;target:Conversation},binding:DeliveryBinding){return this.transaction(()=>{
    const old=this.find(taskId,input);if(old)return old;
    if(this.db.prepare('SELECT 1 FROM deliveries WHERE agent_id=? AND inbound_id=?').get(this.agentId,binding.material.inboundId))throw new Error('delivery_intent_already_exists');
    const id=randomUUID();this.db.prepare("INSERT INTO deliveries VALUES(?,?,?,?,?,?,?,'rendering',?,NULL,NULL,NULL)").run(id,this.agentId,taskId,input.requestId,deliveryDigest({jobId:input.jobId,target:input.target}),input.jobId,binding.material.inboundId,JSON.stringify(binding));this.event(id,'rendering');return this.get(id);
  });}
  get(id:string){const row=this.db.prepare('SELECT * FROM deliveries WHERE id=? AND agent_id=?').get(id,this.agentId);if(!row)throw new Error('delivery_not_found');return {
    id,taskId:string(row.task_id),state:stateSchema.parse(row.state),binding:deliveryBindingSchema.parse(JSON.parse(string(row.binding))),reply:row.reply===null?null:string(row.reply),credential:row.credential===null?null:JSON.parse(string(row.credential)) as unknown,receipt:row.receipt===null?null:string(row.receipt)};}
  status(taskId:string,id:string){const row=this.get(id);if(row.taskId!==taskId)throw new Error('delivery_not_found');return {deliveryId:id,jobId:row.binding.material.jobId,status:row.state,receiptId:row.receipt,simulationOnly:true};}
  private transitionInside(id:string,from:TaskDeliveryState,to:TaskDeliveryState,receipt?:string,sources:readonly SourceRef[]=[]){
    const allowed:Partial<Record<TaskDeliveryState,readonly TaskDeliveryState[]>>={rendering:['ready','rejected','interrupted'],ready:['sending','rejected','interrupted'],sending:['sent','not-sent','uncertain','rejected']};
    if(!allowed[from]?.includes(to))throw new Error('delivery_transition_forbidden');
    const result=this.db.prepare('UPDATE deliveries SET state=?,receipt=COALESCE(?,receipt) WHERE id=? AND agent_id=? AND state=?').run(to,receipt??null,id,this.agentId,from);if(result.changes!==1)throw new Error('delivery_state_conflict');this.event(id,to,sources);
  }
  transition(id:string,from:TaskDeliveryState,to:TaskDeliveryState,receipt?:string){this.transaction(()=>this.transitionInside(id,from,to,receipt));this.flush();}
  ready(id:string,reply:string,sources:readonly SourceRef[]){this.transaction(()=>{const row=this.get(id);if(row.state!=='rendering')throw new Error('delivery_state_conflict');
    const credential={schemaVersion:1,id,taskId:row.taskId,target:row.binding.material.target,inboundId:row.binding.material.inboundId,jobId:row.binding.material.jobId,
      bindingHash:deliveryDigest(row.binding),bodyHash:deliveryDigest(reply),expiresAt:row.binding.material.expiresAt,sources};
    this.db.prepare('UPDATE deliveries SET reply=?,credential=? WHERE id=?').run(reply,JSON.stringify(credential),id);this.transitionInside(id,'rendering','ready',undefined,sources);});this.flush();}
  verifyCredential(id:string){const row=this.get(id);const token=z.object({id:z.string(),bindingHash:z.string(),bodyHash:z.string(),expiresAt:z.string()}).parse(row.credential);
    if(row.reply===null||token.id!==id||token.bindingHash!==deliveryDigest(row.binding)||token.bodyHash!==deliveryDigest(row.reply)||Date.parse(token.expiresAt)<=Date.now())throw new Error('delivery_credential_invalid');return row.reply;}
  flush(){for(const row of this.db.prepare('SELECT id,body FROM events WHERE delivered=0 ORDER BY rowid').all()){
    try{this.journal.appendOnce(JSON.parse(string(row.body)),string(row.id));this.db.prepare('UPDATE events SET delivered=1 WHERE id=?').run(row.id!);}catch{return;}
  }}
  close(){this.flush();this.db.close();}
}
