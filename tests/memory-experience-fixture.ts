import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MemoryStore } from '@dafeiyu/memory/store';
import { taskScopeKey } from '@dafeiyu/contracts';
import type { PersonaAccess,PersonaSourceRef,ExecutionLifecycle } from '@dafeiyu/contracts';
import { testTempDir } from './test-temp.js';

export async function experienceFixture(){
  const directory=await mkdtemp(join(testTempDir(),'memory-experience-')),file=join(directory,'memory.sqlite'),memory=new MemoryStore(file),db=new DatabaseSync(file);
  const taskId=randomUUID(),runId=randomUUID(),scope={kind:'task' as const,agentId:'fictional-fish',taskId,scopeKey:taskScopeKey('fictional-fish',taskId)};
  db.prepare('INSERT INTO task_workspaces VALUES(?,?,?,?,?,?)').run(taskId,scope.agentId,1,1,'active',JSON.stringify({title:'虚构测试',goal:'比较虚构蓝灯方案'}));
  const values=new Map<string,{text:string;rootSources:string[]}>();
  const ref=(text:string,roots=['shared-root']):PersonaSourceRef=>{const id=randomUUID();values.set(id,{text,rootSources:roots});return {kind:'execution-source',id,agentId:scope.agentId,scopeKey:scope.scopeKey,version:1,contentHash:createHash('sha256').update(text).digest('hex')};};
  const a=ref('蓝灯方案在雨天失败'),b=ref('同一经历的摘要'),body=ref('有条件的经验',['shared-root']);
  const access:PersonaAccess={view:{runId,taskId,scope,origin:{kind:'native',producerId:'fixture',requestId:'run'},signal:new AbortController().signal},producer:'fixture',operationId:randomUUID(),startedEventId:randomUUID(),
    intentVersion:1,motivation:{kind:'explicit-task',basis:['fictional-instruction']},inputs:[],admittedSources:[a,b],historyDependencies:[],guard:()=>{},validateHistory:()=>true};
  const store=memory.experienceStore((access,r)=>{const value=values.get(r.id);return r.agentId===access.view.scope.agentId&&r.scopeKey===(access.view.scope.kind==='task'?access.view.scope.scopeKey:'')&&r.version===1&&value?{...value,dependencies:[]}:null;});
  const content={observation:'雨天出现失败',action:'执行虚构蓝灯任务',outcome:'失败，仅适用于虚构样本',interpretation:'可能需要调整防雨措施',conditions:['仅雨天的虚构测试'],unknowns:['未验证晴天']};
  const draft={content,contentRef:body,supports:[a],counters:[b],target:null};
  const event:ExecutionLifecycle={id:randomUUID(),scope,runId,taskEpoch:1,origin:access.view.origin,motivation:access.motivation,type:'run.completed',goal:'比较虚构蓝灯方案',at:new Date().toISOString(),operations:[{id:randomUUID(),action:'fixture_action',status:'failed',effects:'none',completeness:'unknown'}],omittedOperations:0};
  return {directory,file,memory,db,store,access,values,ref,a,b,body,draft,event,close:()=>{db.close();memory.close();}};
}
