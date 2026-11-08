import {randomUUID} from 'node:crypto';
export function combinedAuditEvidence(mode:string):unknown{
  const run=randomUUID(),task=randomUUID(),next=randomUUID(),deliveryId=randomUUID(),target={channel:'qq',account:'100001',kind:'private',id:'200001'};
  const requests=Array.from({length:3},(_,i)=>({id:randomUUID(),body:{sessionId:'s'+i,phase:'task'},settlement:{receipt:{tokens:null}}}));
  const measured=requests.map(row=>({sessionId:row.body.sessionId,inputBytes:100,toolResultBytes:10,repeatedToolResultBytes:0}));
  const definition={taskId:task,intentVersion:1};
  const database={runs:[{id:run,state:'completed',definition}],requests,deliveries:[{run_id:run,state:'sent',receipt:'1',body:'fixture',anchor:{runId:run,taskId:task,target}}],operations:[{action:'qq_browse',outcome:{status:'succeeded',effects:'none',data:{}}}],recoveryEvents:['rendering','verification','sending'].map(phase=>({runId:run,type:'native.delivery.recovery.requested',data:{phase}}))};
  if(mode==='probe-business')return {database:{...database,runs:[{id:run,state:'failed',definition},{id:next,state:'failed',definition},{id:randomUUID(),state:'completed',definition}],operations:[{action:'bili_video',outcome:{status:'succeeded'}}]},requests:measured,videoReads:1,delivered:[{text:'result'}],gates:{first:{generation:1},failedContinuation:{generation:3,reason:'MODEL_HTTP_402'},current:{generation:4,reason:'restored'}},probes:[{state:'succeeded'},{state:'succeeded'}]};
  if(mode==='media-revoke')return {database,requests:measured,before:{runId:run,taskId:task,deliveryId},after:{runId:run,taskId:task,deliveryId,state:'partial'},sends:['text'],attempts:['text'],acquisitions:1,modelCallsBeforeRecovery:3,transport:{state:'partial',total:2,confirmed:1,pending:1,unknown:0}};
  const amount=mode==='chain'?2:['cancel','revise','unknown','revoke-between'].includes(mode)?1:0;
  const state=mode==='chain'?'sent':mode==='unknown'?'uncertain':amount?'partial':'rejected';database.deliveries[0]!.state=state;
  if(mode==='revoke-query')database.deliveries=[];
  if(mode==='cancel'||mode==='revise')database.operations.push({action:'fixture_task_control',outcome:{status:'succeeded',effects:'confirmed',data:{}}});
  const sends=Array.from({length:amount},(_,i)=>({runId:run,text:'part-'+i,receipt:String(i+1),target,sourceMessageId:'owner-original'}));
  const attempts=Array.from({length:mode==='unknown'?2:amount},(_,i)=>({runId:run,text:'part-'+i,target}));
  if(mode==='revise'){database.runs.push({id:next,state:'completed',definition:{...definition,intentVersion:2}});database.deliveries.push({run_id:next,state:'sent',receipt:'3',body:'REVISED_RESULT',anchor:{runId:next,taskId:task,target}});sends.push({runId:next,text:'REVISED_RESULT',receipt:'3',target,sourceMessageId:'owner-interruption'});}
  const stage=(label:string,status:string,phase:string|null)=>({label,requestCount:3,delivery:{runId:run,taskId:task,deliveryId,state:status,recovery:{phase}}});
  const stages=mode==='revoke-query'?[{label:'source-revoked-after-query',requestCount:3,delivery:null}]:[stage('render-failed','rejected','rendering'),stage('verification-failed','rejected','verification'),stage('after-repair-and-dispatch',mode==='chain'?'partial':state,'sending'),...(mode==='chain'?[stage('delivered','sent',null)]:[])];
  return {mode,originalRun:run,taskId:task,database,requests:measured,stages,sends,attempts,verificationInputs:['candidate','candidate','repaired'],notices:['交付遇到阻塞。'],finalProgress:{currentIntent:!['cancel','revise'].includes(mode),currentRun:mode!=='revise',taskState:mode==='cancel'?'paused':'active'},transport:mode==='revoke-query'?null:{state,total:2,confirmed:amount,pending:mode==='unknown'?0:2-amount,unknown:mode==='unknown'?1:0,segments:Array.from({length:2},(_,i)=>({state:i<amount?'sent':mode==='unknown'?'unknown':'pending',receipt:i<amount?String(i+1):null}))}};
}
