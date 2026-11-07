import {foundationManifest} from '../packages/core/lib/persona-manifest.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { RuntimeStore,RUNTIME_SCHEMA_VERSION } from '@dafeiyu/core/runtime-store';
import { taskScopeKey } from '@dafeiyu/contracts';
import type { TaskResultAnchor } from '@dafeiyu/contracts';
import { testTempDir } from './test-temp.js';
const identity={agentId:'fish',profileId:'fixture'},digest='a'.repeat(64),body='纯账本测试正文';
async function file(){return join(await mkdtemp(join(testTempDir(),'dafeiyu-native-ledger-')),'runtime.sqlite');}
function setup(store:RuntimeStore){const taskId=randomUUID(),request=store.prepareRequest('fixture',randomUUID(),{kind:'fixture'});store.bindTask(request.id,taskId);let run=store.acceptRun(request.id,{taskId,scope:{kind:'task',agentId:'fish',taskId,scopeKey:taskScopeKey('fish',taskId)},origin:{kind:'native',producerId:'fixture',requestId:request.requestId},intentVersion:1,policyId:'fixture'});
  run=store.transition(run.id,run.version,'queued');run=store.start(run.id,run.version,{sessionId:'fixture-session',personaVersion:digest,model:{provider:'local-test',model:'scripted'},registryVersion:digest,authorityVersion:digest,inputs:[]},foundationManifest(run,{text:'fixture memory',version:digest,fileIdentity:digest},{provider:'local-test',model:'scripted'}));
  const ref={sessionId:'fixture-session',messageSeq:1,turnEndSeq:2,textHash:createHash('sha256').update(body).digest('hex')};store.complete(run.id,run.version,ref);
  const anchor:TaskResultAnchor={kind:'task-result',schemaVersion:1,taskId,runId:run.id,inboundId:randomUUID(),target:{channel:'qq',account:'12345678',kind:'group',id:'11223344'},intentVersion:1,authorityVersion:digest,expiresAt:'2030-01-01T00:00:00.000Z'};return {run,anchor,ref};}

test('native delivery binds one immutable anchor and credential, retaining facts through recovery',async()=>{
  const path=await file(),store=new RuntimeStore(path,identity,{create:true});try{const {run,anchor,ref}=setup(store),first=store.nativeDeliveries.create(anchor);assert.equal(store.nativeDeliveries.create(anchor).id,first.id);assert.throws(()=>store.nativeDeliveries.create({...anchor,target:{...anchor.target,id:'22334455'}}),/BINDING_CONFLICT/);
    store.nativeDeliveries.start(run.id,{packetId:randomUUID(),sourceStamp:digest,foundationHash:digest,personaHash:digest,modelHash:digest});store.nativeDeliveries.rendered(run.id,ref);store.nativeDeliveries.approve(run.id,body);assert.equal(store.nativeDeliveries.verifyCredential(run.id),body);
    const db=new DatabaseSync(path);try{assert.throws(()=>db.prepare('UPDATE native_deliveries SET body=?').run('被篡改'),/Immutable/);assert.throws(()=>db.prepare('DELETE FROM native_deliveries').run(),/Retain/);}finally{db.close();}
    store.nativeDeliveries.recover();assert.equal(store.nativeDeliveries.get(run.id)?.state,'ready');store.nativeDeliveries.sending(run.id);store.nativeDeliveries.recover();assert.equal(store.nativeDeliveries.get(run.id)?.state,'uncertain');assert.throws(()=>store.nativeDeliveries.sending(run.id),/STATE_CONFLICT/);
  }finally{store.close();}
});

test('unapproved candidates can be replaced before sealing, but never after approval or send',async()=>{
  const store=new RuntimeStore(await file(),identity,{create:true});try{const {run,anchor,ref}=setup(store);store.nativeDeliveries.create(anchor);store.nativeDeliveries.start(run.id,{packetId:randomUUID(),sourceStamp:digest,foundationHash:digest,personaHash:digest,modelHash:digest});
    store.nativeDeliveries.candidate(run.id,{...ref,sessionId:'rejected-first'});assert.equal(store.nativeDeliveries.get(run.id)?.renderRef,null);assert.throws(()=>store.nativeDeliveries.approve(run.id,body),/STATE_CONFLICT/);
    store.nativeDeliveries.repair(run.id);store.nativeDeliveries.candidate(run.id,ref);store.nativeDeliveries.rendered(run.id,ref);store.nativeDeliveries.approve(run.id,body);
    assert.equal(store.nativeDeliveries.verifyCredential(run.id),body);assert.throws(()=>store.nativeDeliveries.repair(run.id),/STATE_CONFLICT/);store.nativeDeliveries.sending(run.id);assert.throws(()=>store.nativeDeliveries.repair(run.id),/STATE_CONFLICT/);
  }finally{store.close();}
});

test('pre-dispatch rejection retains the approved text without inventing a send attempt',async()=>{
  const store=new RuntimeStore(await file(),identity,{create:true});try{const {run,anchor,ref}=setup(store);store.nativeDeliveries.create(anchor);store.nativeDeliveries.start(run.id,{packetId:randomUUID(),sourceStamp:digest,foundationHash:digest,personaHash:digest,modelHash:digest});store.nativeDeliveries.rendered(run.id,ref);store.nativeDeliveries.approve(run.id,body);
    store.nativeDeliveries.notSentBeforeDispatch(run.id,'DELIVERY_BUDGET_EXHAUSTED');assert.equal(store.nativeDeliveries.get(run.id)?.state,'not-sent');assert.equal(store.nativeDeliveries.sendAttempted(run.id),false);assert.equal(store.nativeDeliveries.get(run.id)?.receipt,null);
  }finally{store.close();}
});

test('queued autonomous shares start their validity window at admission and cooldown follows actual sent receipts',async()=>{
  const store=new RuntimeStore(await file(),identity,{create:true}),now=Date.now(),target={channel:'qq',account:'12345678',kind:'private' as const,id:'11223344'};
  try{const first=setup(store),share=store.queueActivityShare(first.run.id,'first',target,digest,60000,now-3600000);
    assert.ok(Date.parse(share.expiresAt)<now);assert.equal(store.prepareActivityShare(first.run.id,'b'.repeat(64),60000,now),false);
    assert.equal(store.prepareActivityShare(first.run.id,digest,60000,now),true);const ready=store.activityShare(first.run.id)!;assert.equal(Date.parse(ready.expiresAt),now+900000);
    const anchor:TaskResultAnchor={kind:'activity-result',schemaVersion:1,taskId:first.anchor.taskId,runId:first.run.id,shareId:ready.id,target,intentVersion:1,authorityVersion:digest,expiresAt:ready.expiresAt};
    store.nativeDeliveries.create(anchor);store.nativeDeliveries.start(first.run.id,{packetId:randomUUID(),sourceStamp:digest,foundationHash:digest,personaHash:digest,modelHash:digest});store.nativeDeliveries.rendered(first.run.id,first.ref);store.nativeDeliveries.approve(first.run.id,body);
    store.nativeDeliveries.sending(first.run.id);store.nativeDeliveries.finish(first.run.id,'sent','platform-1',null);
    const second=setup(store);store.queueActivityShare(second.run.id,'second',target,digest,60000,now-3000000);
    assert.equal(store.prepareActivityShare(second.run.id,digest,60000,now),false,'long foreground work must not cause a burst of queued shares');
    assert.equal(store.prepareActivityShare(second.run.id,digest,60000,now+61000),true);
    assert.equal(store.activityShare(first.run.id)?.expiresAt,ready.expiresAt,'an already created anchor stays immutable');
    assert.throws(()=>store.nativeDeliveries.deferActivity(first.run.id),/DELIVERY_STATE_CONFLICT/,'a confirmed delivery is never reopened');
  }finally{store.close();}
});

test('recovery receipt is durable and single-flight, preserving the immutable material and candidate across restart',async()=>{
  const path=await file();let store=new RuntimeStore(path,identity,{create:true});
  try{
    const {run,anchor,ref}=setup(store),delivery=store.nativeDeliveries;
    delivery.create(anchor);delivery.start(run.id,{packetId:randomUUID(),sourceStamp:digest,foundationHash:digest,personaHash:digest,modelHash:digest});
    delivery.candidate(run.id,ref);delivery.reject(run.id,'DELIVERY_VERIFICATION_MODEL_ERROR');
    const before=delivery.get(run.id)!,input={requestId:randomUUID(),expectedVersion:before.version};
    assert.throws(()=>delivery.requestRecovery(run.id,{...input,expectedVersion:before.version-1}),/VERSION_CONFLICT/);
    const receipt=delivery.requestRecovery(run.id,input);assert.equal(receipt.phase,'verification');
    assert.deepEqual(delivery.requestRecovery(run.id,input),receipt);
    assert.throws(()=>delivery.requestRecovery(run.id,{...input,expectedVersion:before.version+1}),/IDEMPOTENCY_CONFLICT/);
    assert.throws(()=>delivery.requestRecovery(run.id,{...input,requestId:randomUUID()}),/PENDING/);
    store.close();store=new RuntimeStore(path,identity);store.nativeDeliveries.recover();
    assert.deepEqual(store.nativeDeliveries.pendingRecovery(run.id),receipt);
    store.nativeDeliveries.beginRecovery(run.id,input.requestId);
    const after=store.nativeDeliveries.get(run.id)!;assert.equal(after.state,'verifying');assert.equal(after.id,before.id);
    assert.deepEqual(after.anchor,before.anchor);assert.deepEqual(after.material,before.material);assert.deepEqual(store.nativeDeliveries.work(run.id).candidate,ref);
    // A second crash during an authorized continuation resumes that request, not a new task.
    store.close();store=new RuntimeStore(path,identity);store.nativeDeliveries.recover();
    store.nativeDeliveries.beginRecovery(run.id,input.requestId);
    store.nativeDeliveries.rendered(run.id,ref);store.nativeDeliveries.approve(run.id,body);store.nativeDeliveries.sending(run.id);store.nativeDeliveries.finish(run.id,'sent','confirmed',null);
    store.nativeDeliveries.settleRecovery(run.id,input.requestId);
    assert.equal(store.nativeDeliveries.pendingRecovery(run.id),null);assert.deepEqual(store.nativeDeliveries.requestRecovery(run.id,input),receipt);
    assert.equal(store.nativeDeliveries.get(run.id)?.state,'sent');assert.deepEqual(store.get(run.id).result,ref);
    assert.throws(()=>store.nativeDeliveries.requestRecovery(run.id,{requestId:randomUUID(),expectedVersion:store.nativeDeliveries.get(run.id)!.version}),/RECOVERY_STATE/);
  }finally{store.close();}
});

test('repair history and three-draft limit survive interrupted verification and recovery',async()=>{
  const store=new RuntimeStore(await file(),identity,{create:true});
  try{const {run,anchor,ref}=setup(store),delivery=store.nativeDeliveries;
    delivery.create(anchor);delivery.start(run.id,{packetId:randomUUID(),sourceStamp:digest,foundationHash:digest,personaHash:digest,modelHash:digest});
    for(let i=0;i<3;i++){
      const candidate={...ref,sessionId:'draft-'+i};delivery.candidate(run.id,candidate);
      if(i===2){delivery.reject(run.id,'DELIVERY_VERIFICATION_MODEL_ERROR');const request={requestId:randomUUID(),expectedVersion:delivery.get(run.id)!.version};
        delivery.requestRecovery(run.id,request);delivery.beginRecovery(run.id,request.requestId);assert.deepEqual(delivery.work(run.id).candidate,candidate);delivery.settleRecovery(run.id,request.requestId);}
      store.appendExecutionEvent(run.id,'native.delivery.verification-rejected',{attempt:i,renderRef:candidate,feedback:{kind:'delivery-fidelity',issues:['issue-'+i]}});
      if(i<2)delivery.repair(run.id);else delivery.reject(run.id,'DELIVERY_UNFAITHFUL');
    }
    assert.deepEqual(delivery.work(run.id).issues,['issue-0','issue-1','issue-2']);assert.equal(delivery.work(run.id).candidate,null);
    assert.equal(delivery.recoveryView(run.id).reason,'DELIVERY_REPAIR_EXHAUSTED');
    assert.throws(()=>delivery.requestRecovery(run.id,{requestId:randomUUID(),expectedVersion:delivery.get(run.id)!.version}),/REPAIR_EXHAUSTED/);
  }finally{store.close();}
});

test('expired, stale and uncertain deliveries cannot be reopened as generation or verification work',async()=>{
  const store=new RuntimeStore(await file(),identity,{create:true});
  try{for(const failure of ['expired','stale','unknown'] as const){
    const {run,anchor,ref}=setup(store),delivery=store.nativeDeliveries;
    delivery.create(failure==='expired'?{...anchor,expiresAt:'2020-01-01T00:00:00.000Z'}:anchor);
    delivery.start(run.id,{packetId:randomUUID(),sourceStamp:digest,foundationHash:digest,personaHash:digest,modelHash:digest});
    if(failure==='unknown'){delivery.rendered(run.id,ref);delivery.approve(run.id,body);delivery.sending(run.id);delivery.recover();}
    else delivery.reject(run.id,failure==='stale'?'SOURCE_STALE':'NATIVE_DELIVERY_FAILED');
    const row=delivery.get(run.id)!;assert.equal(delivery.recoveryView(run.id).available,false);
    assert.throws(()=>delivery.requestRecovery(run.id,{requestId:randomUUID(),expectedVersion:row.version}),/RECOVERY_/);
    assert.deepEqual(delivery.get(run.id),row);
  }}finally{store.close();}
});
