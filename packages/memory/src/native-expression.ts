import type { Context } from '@deepseek-ai/cordis';
import type { DatabaseSync } from 'node:sqlite';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { NativeExpressionPacketSchema,NativeExpressionCandidateSchema,TaskResultAnchorSchema,redactJson } from '@dafeiyu/contracts';
import type { NativeExpressionAccess,NativeExpressionPacket,NativeExpressionPort } from '@dafeiyu/contracts';
import type { MemoryStore } from './store.js';
import type { TaskExpression } from './expression.js';
import { verifyPersonaDelivery } from './expression-runtime.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function migrateNativeExpression(db:DatabaseSync){const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if(version===10||version===11||version===12){db.prepare('SELECT * FROM native_expression_packets LIMIT 0').all();return;}
  if(version!==9)throw new Error('Unsupported native expression database');
  db.exec(`CREATE TABLE native_expression_packets(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,task_id TEXT NOT NULL,run_id TEXT NOT NULL,version INTEGER NOT NULL,withdrawn INTEGER NOT NULL,body TEXT NOT NULL,UNIQUE(agent_id,run_id));
    CREATE TRIGGER native_expression_immutable BEFORE UPDATE OF id,agent_id,task_id,run_id,body ON native_expression_packets BEGIN SELECT RAISE(ABORT,'Immutable native expression'); END;
    CREATE TRIGGER native_expression_retain BEFORE DELETE ON native_expression_packets BEGIN SELECT RAISE(ABORT,'Withdraw native expression'); END;
    PRAGMA user_version=10;`);
  db.prepare('INSERT INTO memory_schema_migrations VALUES(10,?,0,?)').run(new Date().toISOString(),'add-target-bound-native-expression-without-copying-rejected-private-bodies-v1');
}
export class NativeExpression implements NativeExpressionPort {
  private readonly stop=new AbortController();
  readonly signal=this.stop.signal;
  private readonly pending=new Set<Promise<void>>();
  constructor(private readonly ctx:Context,private readonly db:DatabaseSync,private readonly store:MemoryStore,private readonly expression:TaskExpression,readonly ready:()=>boolean,private readonly flush:()=>void){}
  private audit(access:NativeExpressionAccess,type:string,data:unknown){const id=randomUUID();this.db.prepare('INSERT INTO execution_memory_outbox(id,body) VALUES(?,?)').run(id,JSON.stringify({id,type,scope:access.execution.view.scope,runId:access.anchor.runId,origin:access.execution.view.origin,operationId:access.anchor.runId,causedBy:null,producer:'memory-native-expression',at:new Date().toISOString(),data}));}
  private build(access:NativeExpressionAccess,allowExpired=false){access.guard();if(!this.ready())throw new Error('DEPENDENCY_UNAVAILABLE');const anchor=TaskResultAnchorSchema.parse(access.anchor),scope=access.execution.view.scope;
    if(scope.kind!=='task'||scope.taskId!==anchor.taskId||access.execution.view.runId!==anchor.runId||access.execution.intentVersion!==anchor.intentVersion||!allowExpired&&Date.parse(anchor.expiresAt)<=Date.now())throw new Error('SOURCE_STALE');
    if(access.media&&hash(this.ctx.dafeiyu.nativeMediaTargetMaterial(access))!==hash(access.media))throw new Error('SOURCE_STALE');
    const candidates=z.array(NativeExpressionCandidateSchema).max(64).parse(access.candidates),evidence:NativeExpressionPacket['evidence']=[],proofs:unknown[]=[],targetInferences:number[]=[];let forbidden=false;
    for(const candidate of candidates){const source=candidate.source;let material:string|null=null,fence:string|null=null,kind:'reported'|'inference'='reported',mediaStamp:string|null=null,targetStamp:string|null=null;
      if(source.kind==='memory')material=this.expression.nativeMemoryMaterial(scope.agentId,source,anchor.target,access.expressionPolicy??null);
      else if(candidate.view!==null){const observed=this.store.capabilities.withAccess(access.execution,()=>{const media=this.ctx.dafeiyu.nativeMediaObservedMaterial(access.execution,source,anchor.target,candidate.view!);if(media){kind=media.kind;mediaStamp=media.stamp;}
        return this.store.capabilities.expressionView(access.execution,source,anchor.target,candidate.view!,!!media,(proof,view)=>this.ctx.dafeiyu.capabilityPublicView(proof,view),
          (proof,view)=>this.ctx.dafeiyu.capabilityTargetView(proof,view,anchor.target,scope));});material=observed?.text??null;fence=observed?.fence??null;
        if(observed?.target){kind=observed.target.kind;targetStamp=observed.target.stamp;}}
      if(material===null){forbidden=true;continue;}
      proofs.push({source,viewHash:hash(material),fence,...(mediaStamp?{mediaStamp}:{}),...(targetStamp?{targetStamp}:{})});
      if(access.selectedSourceIds?.length&&!access.selectedSourceIds.includes(source.id))continue;
      if(evidence.length>=16)throw new Error('NATIVE_EXPRESSION_CAPACITY');
      if(targetStamp&&kind==='inference')targetInferences.push(evidence.length);
      evidence.push({id:`S${evidence.length+1}`,kind,text:material});
    }
    if(targetInferences.length&&(forbidden||access.derivedInputComplete!==true)){
      for(const index of targetInferences.reverse()){evidence.splice(index,1);proofs.splice(index,1);}evidence.forEach((item,index)=>{item.id=`S${index+1}`;});forbidden=true;
    }
    const resultIncluded=!forbidden&&!access.opaqueInfluence;
    for(const receipt of access.operationalEvidence??[]){if(evidence.length>=16)throw new Error('NATIVE_EXPRESSION_CAPACITY');evidence.push({...receipt,id:'O'+evidence.length});}
    if(anchor.outcome==='waiting')evidence.push({id:'W',kind:'reported',text:'程序状态：任务仍在等待，尚未完成。只能讨论需要补充或确认的事项，不能把它描述为已经完成。'});
    if(resultIncluded)evidence.push({id:'R',kind:'inference',text:z.string().min(1).max(32000).parse(access.output)});
    if(resultIncluded&&access.assessment)evidence.push({id:'A',kind:'inference',text:JSON.stringify({kind:'model-result-assessment',...access.assessment,note:'模型对目标满足程度和价值的判断，不是程序事实或发送回执。'})});
    if(access.media)evidence.push({id:'M',kind:'reported',text:JSON.stringify({note:'程序已核验可用于此目标的媒体部件。以下仅为字节／类型元信息，不表示读懂其内容；正文只据其他获准证据描述内容。',parts:access.media.parts})});
    if(!evidence.length)throw new Error('NATIVE_EXPRESSION_NO_PUBLIC_MATERIAL');
    const question=z.string().min(1).max(2000).parse(access.question);if(Buffer.byteLength(JSON.stringify({question,evidence}))>128000)throw new Error('NATIVE_EXPRESSION_CAPACITY');
    if(redactJson(z.json().parse({question,evidence})).redacted)throw new Error('PRIVATE_INPUT_REJECTED');
    access.guard();return {anchor,question,evidence,resultIncluded,...(access.media?{media:access.media}:{}),sourceStamp:hash({anchor,proofs,outputHash:resultIncluded?hash(access.output):null,opaque:access.opaqueInfluence,policy:access.expressionPolicy??null,...(access.media?{media:access.media}:{})})};
  }
  prepare(access:NativeExpressionAccess){try{return this.store.atomic(()=>{const built=this.build(access),old=this.db.prepare('SELECT id FROM native_expression_packets WHERE agent_id=? AND run_id=?').get(access.execution.view.scope.agentId,built.anchor.runId);
    if(old)return this.open(access,String(old.id));const packet=NativeExpressionPacketSchema.parse({id:randomUUID(),version:1,...built});
    this.db.prepare('INSERT INTO native_expression_packets VALUES(?,?,?,?,1,0,?)').run(packet.id,access.execution.view.scope.agentId,packet.anchor.taskId,packet.anchor.runId,JSON.stringify(packet));this.audit(access,'native.expression.prepared',{packetId:packet.id,evidence:packet.evidence.length,resultIncluded:packet.resultIncluded,sourceStamp:packet.sourceStamp});return packet;});}finally{this.flush();}}
  open(access:NativeExpressionAccess,id:string,purpose:'send'|'context'='send'){if(!this.ready())throw new Error('DEPENDENCY_UNAVAILABLE');const row=this.db.prepare('SELECT version,withdrawn,body FROM native_expression_packets WHERE id=? AND agent_id=? AND task_id=? AND run_id=?').get(z.uuid().parse(id),access.execution.view.scope.agentId,access.anchor.taskId,access.anchor.runId);
    if(!row||row.withdrawn!==0||row.version!==1)throw new Error('NATIVE_EXPRESSION_UNAVAILABLE');const packet=NativeExpressionPacketSchema.parse(JSON.parse(String(row.body))),current=this.build(access,purpose==='context');
    if(packet.sourceStamp!==current.sourceStamp||JSON.stringify(packet.anchor)!==JSON.stringify(current.anchor)||JSON.stringify(packet.evidence)!==JSON.stringify(current.evidence)||JSON.stringify(packet.media)!==JSON.stringify(current.media)||packet.question!==current.question||packet.resultIncluded!==current.resultIncluded)throw new Error('SOURCE_STALE');return packet;
  }
  withdraw(access:NativeExpressionAccess,id:string,version:number){try{this.store.atomic(()=>{const packet=this.open(access,id);if(packet.version!==version)throw new Error('VERSION_CONFLICT');this.db.prepare('UPDATE native_expression_packets SET version=version+1,withdrawn=1 WHERE id=? AND version=?').run(id,version);this.audit(access,'native.expression.withdrawn',{packetId:id,version:version+1});});}finally{this.flush();}}
  async verify(access:NativeExpressionAccess,id:string,answer:string,signal:AbortSignal,guard:()=>void){const packet=this.open(access,id),work=verifyPersonaDelivery(this.ctx,{question:packet.question,evidence:packet.evidence},answer,AbortSignal.any([signal,this.stop.signal]),()=>{guard();this.open(access,id);},{maxAnswerChars:32000,maxInputBytes:Math.min(256000,access.requestMaxBytes)});this.pending.add(work);try{await work;}finally{this.pending.delete(work);}}
  cancel(){this.stop.abort();}
  async whenIdle(){await Promise.allSettled([...this.pending]);}
  async close(){this.cancel();await this.whenIdle();}
}
