import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {auditAcceptance,auditScenario} from '../../scripts/acceptance/audit.ts';
import {catalog,criteriaVersion,offlineConfiguration} from '../../scripts/acceptance/catalog.ts';
import {hash} from '../../scripts/acceptance/io.mjs';
import {waitForStage} from '../../scripts/acceptance/wait.ts';
import type {StageObservation} from '../../scripts/acceptance/wait.ts';

function fixture() {
  const runId=randomUUID(),taskId=randomUUID(),run=randomUUID(),sourceHash='a'.repeat(64),driverHash='b'.repeat(64),runtimeHash='c'.repeat(64);
  const target={kind:'private',id:'200001'},text='GROUP_TEXT_MUST_REACH_OWNER 确实提到了我';
  const requests=Array.from({length:7},(_,index)=>({id:randomUUID(),body:{sessionId:'session-'+index,phase:index<3?'rendering':'verification'},settlement:{receipt:{tokens:null}}}));
  const database={runs:[{id:run,state:'completed',definition:{taskId,intentVersion:1}}],deliveries:[{run_id:run,state:'sent',receipt:'receipt-current',body:text,anchor:{taskId,target}}],requests,operations:[{action:'qq_browse',outcome:{status:'succeeded'}}]};
  const measurements=requests.map(row=>({sessionId:row.body.sessionId,inputBytes:100,toolResultBytes:20,repeatedToolResultBytes:10}));
  const plan={body:{id:randomUUID(),version:1,owner:{kind:'task',taskId},trigger:{kind:'interval',intervalMs:60000},watch:{mode:'joined'},quiet:[]},status:'active'};
  const after={...plan,body:{...plan.body,version:2,trigger:{kind:'interval',intervalMs:120000}}};
  const patrol={before:plan,after,afterRestart:after,planCount:1,cursor:1,configurationWaits:Array.from({length:2},()=>({sourceState:'pending',foregroundBusy:true,patrolBefore:0,patrolAfter:0})),patrolCalls:1,
    delivered:[{text,conversation:target},{text:'合法群回复',conversation:{kind:'group',id:'300001'}}],database,requests:measurements};
  const readId=randomUUID();
  const evidence:Record<string,unknown>={
    'patrol-new':patrol,'patrol-amend':patrol,'owner-report':{database,requests:measurements,delivered:[{text,conversation:target}]},
    'dsh-result-read':{taskId,resultId:readId,page:{resultId:readId,execution:{isError:false,effect:'none'},view:{entries:[{key:'lines',value:Array.from({length:70},(_,index)=>({number:400+index,text:`if (message.group_id === group_${index}) return allowed;`}))}],coverage:{complete:true}}}},
    'video-reading':{videos:Array.from({length:8},(_,i)=>'video-'+i),platformCalls:8,progress:{kind:'bilibili-reading-progress',total:8},
      requests:Array.from({length:17},()=>({sessionId:'reading',inputBytes:100,toolResultBytes:20,repeatedToolResultBytes:10})),
      database:{...database,deliveries:[],operations:Array.from({length:16},(_,i)=>({action:i%2?'bili_reading_save':'bili_video',outcome:{status:'succeeded'}})),
        requests:Array.from({length:17},()=>({id:randomUUID(),body:{sessionId:'reading',phase:'task'},settlement:{receipt:{tokens:null}}}))}},
  };
  for(const id of ['delivery-render-recovery','delivery-verifier-recovery']){
    const deliveryId=randomUUID(),phases=id==='delivery-render-recovery'?['rendering','rendering','verification']:['rendering','verification','verification'];
    const recoveryRequests=phases.map(phase=>({id:randomUUID(),body:{sessionId:phase,phase},settlement:{receipt:{tokens:null}}}));
    evidence[id]={before:{deliveryId,taskId,runId:run,state:'rejected'},after:{deliveryId,taskId,runId:run,state:'sent'},delivered:[{text,conversation:target}],verificationInputs:['same candidate','same candidate'],
      requests:recoveryRequests.map(row=>({sessionId:row.body.sessionId,inputBytes:100,toolResultBytes:20,repeatedToolResultBytes:10})),
      database:{...database,requests:recoveryRequests,recoveryEvents:[{runId:run,type:'native.delivery.recovery.requested',data:{requestId:'r'}},{runId:run,type:'native.delivery.recovery.settled',data:{requestId:'r',state:'sent',error:null}}]}};
  }
  const owner={channel:'qq',account:'100001',kind:'private',id:'200001'},inboundId=randomUUID();
  const progress={taskId,runId:run,version:'f'.repeat(64),goal:{status:'uncertain',source:'none',programVerified:false},execution:{state:'completed'},delivery:{state:'rejected'}};
  for(const id of ['fault-notice','fault-notice-unknown','execution-fault-notice']){
    const failed=id==='execution-fault-notice',unknown=id==='fault-notice-unknown';
    evidence[id]={progress:{...progress,execution:{state:failed?'failed':'completed'},delivery:{state:failed?'none':'rejected'}},failedModelCalls:1,
      database:{...database,runs:[{...database.runs[0]!,state:failed?'failed':'completed'}],sources:[{runId:run,inboundId,target:owner}]},requests:measurements,
      notices:[{id:'notice',text:'本次处理未完成，记录已保存。',conversation:owner}],feedback:[{id:randomUUID(),runId:run,taskId,sourceMessageId:inboundId,statusVersion:progress.version,state:unknown?'unknown':'sent',attempts:1,deliveryId:'notice',...(unknown?{}:{receiptId:'receipt'})}]};
  }
  for(const id of ['task-send-text','task-send-media','task-send-not-sent','task-send-unknown']){
    const unknown=id==='task-send-unknown',deliveryId=randomUUID(),state=unknown?'uncertain':'sent';
    evidence[id]={before:{deliveryId,taskId,runId:run,state:id==='task-send-not-sent'?'not-sent':'partial'},after:{deliveryId,taskId,runId:run,state},
      database,requests:measurements,progress:{...progress,delivery:{state}},sends:unknown?['one']:['one','two'],attempts:['one','two'],acquisitions:1,mediaManifests:['same','same'],modelCallsBeforeRecovery:measurements.length,
      transport:{state,total:2,confirmed:unknown?1:2,pending:0,unknown:unknown?1:0,segments:[{state:'sent',receipt:'1'},{state:unknown?'unknown':'sent',receipt:unknown?null:'2'}]}};
  }
  const code='source excerpt',sourceDigest=hash(code),operationId=randomUUID();
  evidence['diagnostic-flow']={progress:{...progress,goal:{status:'met',source:'agent',programVerified:false},delivery:{state:'sent'}},requests:measurements,reads:1,sent:[sourceDigest],source:{version:'0.28.7',text:code,sha256:sourceDigest},
    database:{...database,operations:[{id:operationId,action:'dsh_tool_read',outcome:{status:'succeeded',data:{page:{view:{coverage:{complete:true},entries:[{key:'sha256',value:sourceDigest},{key:'version',value:'0.28.7'},{key:'sourceLines',value:[code]}]}}},receipts:[{kind:'dsh-operation',id:operationId}]}}]}};
  const manifest={schemaVersion:1,runId,mode:'offline-sdk',criteriaVersion,revision:'d'.repeat(40),version:'0.28.7',apiVersion:7,sourceHash,driverHash,configHash:hash(offlineConfiguration),catalogHash:hash(catalog),startedAt:'2026-11-07T00:00:00.000Z',scenarios:catalog.map(row=>row.id)};
  const artifacts=new Map(catalog.map(spec=>[spec.id,{schemaVersion:1,runId,scenarioId:spec.id,capturedAt:'2026-11-07T00:01:00.000Z',version:manifest.version,apiVersion:7,sourceHash,driverHash,runtimeHash,evidence:evidence[spec.id]}]));
  const completion={schemaVersion:1,runId,finishedAt:'2026-11-07T00:02:00.000Z',testExitCode:0,sourceHash,driverHash,runtimeHash,artifactHashes:Object.fromEntries([...artifacts].map(([id,row])=>[id,hash(row)]))};
  return {manifest,completion,artifacts,evidence,database,patrol};
}

test('independent offline audit accepts evidence without promoting it to release or semantic acceptance',()=>{
  const f=fixture(),result=auditAcceptance(f.manifest,f.completion,f.artifacts);
  assert.equal(result.passed,true);assert.equal(result.releaseAccepted,false);
  assert.ok(result.requirements.every(row=>row.fullAcceptance==='not-executed'));
});

test('wrong source/runtime version, old request artifacts and missing scenarios cannot be masked by success flags',()=>{
  for (const change of ['runtime','version','run','time','missing','manifest-scope','driver']) {
    const f=fixture(),row=f.artifacts.get('owner-report')!;
    if(change==='runtime')row.runtimeHash='e'.repeat(64);
    if(change==='version')row.version='0.1.0';
    if(change==='run')row.runId=randomUUID();
    if(change==='time')row.capturedAt='2020-01-01T00:00:00.000Z';
    if(change==='missing')f.artifacts.delete('owner-report');
    if(change==='manifest-scope')f.manifest.scenarios=['owner-report'];
    if(change==='driver')f.completion.driverHash='f'.repeat(64);
    f.completion.artifactHashes=Object.fromEntries([...f.artifacts].map(([id,value])=>[id,hash(value)]));
    assert.equal(auditAcceptance({...f.manifest},f.completion,f.artifacts).passed,false,change);
  }
});

test('plan identity, watermarks, input omission and unknown delivery are audited from records',()=>{
  const changed=fixture();changed.patrol.after={...changed.patrol.after,body:{...changed.patrol.after.body,id:randomUUID()}};
  assert.ok(auditScenario('patrol-new',changed.patrol).checks.some(row=>row.id==='same-plan-id'&&!row.passed));
  const cursor=fixture();cursor.patrol.cursor=0;
  assert.ok(auditScenario('patrol-new',cursor.patrol).checks.some(row=>row.id==='watermark-retained'&&!row.passed));
  const delivery=fixture();delivery.database.deliveries[0]!.state='uncertain';
  assert.ok(auditScenario('owner-report',delivery.evidence['owner-report']).checks.some(row=>row.id==='delivery-receipts'&&!row.passed));
  assert.throws(()=>auditScenario('owner-report',{delivered:[]}),/./);
  const missing=fixture();missing.database.requests.pop();
  assert.ok(auditScenario('owner-report',missing.evidence['owner-report']).checks.some(row=>row.id==='requests-reconciled'&&!row.passed));
});

test('actual source lines work independently of tool/function names; listing a directory is insufficient',()=>{
  const f=fixture();assert.ok(auditScenario('dsh-result-read',f.evidence['dsh-result-read']).checks.every(row=>row.passed));
  assert.throws(()=>auditScenario('dsh-result-read',{resultId:'r',page:{resultId:'r',execution:{isError:false,effect:'none'},view:{entries:[{key:'files',value:['source.ts']}],coverage:{complete:true}}}}));
});

test('configuration waits for its source task even after the foreground acknowledgement has ended',()=>{
  const f=fixture();f.patrol.configurationWaits.forEach(row=>{row.foregroundBusy=false;});
  assert.ok(auditScenario('patrol-amend',f.patrol).checks.every(row=>row.passed));
  f.patrol.configurationWaits[0]!.sourceState='valid';f.patrol.configurationWaits[0]!.foregroundBusy=true;
  assert.ok(auditScenario('patrol-amend',f.patrol).checks.some(row=>row.id==='no-configuration-self-wait'&&!row.passed));
});

test('phase-one audit rejects model-dependent notices, changed targets and falsely confirmed parts',()=>{
  const f=fixture();
  const calledModel=Object.assign({},f.evidence['fault-notice'],{failedModelCalls:2});
  assert.ok(auditScenario('fault-notice',calledModel).checks.some(row=>row.id==='no-notice-model-call'&&!row.passed));
  const foreign=Object.assign({},f.evidence['fault-notice'],{notices:[{id:'notice',text:'处理未完成',conversation:{channel:'qq',account:'100001',kind:'private',id:'foreign'}}]});
  assert.ok(auditScenario('fault-notice',foreign).checks.some(row=>row.id==='original-source-and-target'&&!row.passed));
  const unknown=Object.assign({},f.evidence['task-send-text'],{transport:{state:'uncertain',total:2,confirmed:1,pending:0,unknown:1,segments:[{state:'sent',receipt:'1'},{state:'unknown',receipt:null}]}});
  assert.ok(auditScenario('task-send-text',unknown).checks.some(row=>row.id==='confirmed-only-once'&&!row.passed));
});

test('a diagnostic report must match actual returned source bytes, not a supplied success flag',()=>{
  const f=fixture(),wrong=Object.assign({},f.evidence['diagnostic-flow'],{source:{version:'0.28.7',text:'different file',sha256:hash('source excerpt')},passed:true});
  assert.ok(auditScenario('diagnostic-flow',wrong).checks.some(row=>row.id==='actual-file-and-report'&&!row.passed));
});

test('stage-aware waiting permits a valid 322-second report and reports a real deadline failure',async()=>{
  let now=0;
  const read=async():Promise<StageObservation>=>now>=322000?{state:'finished',result:'receipt'}:{state:'active',phase:'verification',progressId:'candidate-1',deadlineAt:600000};
  const clock={now:()=>now,sleep:async(ms:number)=>{now+=ms;},signal:new AbortController().signal,inactivityMs:300000};
  assert.equal(await waitForStage(read,clock),'receipt');
  now=0;
  await assert.rejects(waitForStage(async()=>({state:'active',phase:'verification',progressId:'candidate-1',deadlineAt:500}),clock),/ACCEPTANCE_STAGE_TIMEOUT/);
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(waitForStage(read,{...clock,signal:aborted.signal}));
});
