import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { taskScopeKey } from '@dafeiyu/contracts';
import { ExecutorStore,EXECUTOR_APPLICATION_ID,EXECUTOR_SCHEMA_VERSION } from '../packages/server-executor/lib/store.js';
import { ExecutorJobSpecSchema,ExecutorTerminalSchema,ExecutorReceiptSchema,executorHash } from '../packages/server-executor/lib/types.js';
import type { ExecutorHandshake,StoredExecutorJob } from '../packages/server-executor/lib/types.js';
import { testTempDir } from './test-temp.js';

const base=Date.parse('2026-10-26T12:00:00.000Z'),hash='a'.repeat(64);
async function fixture(){const root=await mkdtemp(join(testTempDir(),'server-executor-store-')),file=join(root,'executor.sqlite'),identity={agentId:'fictional-executor',profileId:'fixture'},taskId=randomUUID(),
  scope={kind:'task' as const,agentId:identity.agentId,taskId,scopeKey:taskScopeKey(identity.agentId,taskId)},spec=ExecutorJobSpecSchema.parse({schemaVersion:1,scope,intentVersion:1,requestId:'fictional-request',
    authorizationKey:hash,goalHash:'b'.repeat(64),inputHash:'c'.repeat(64),profileHash:'d'.repeat(64),commandHash:'e'.repeat(64),executableHash:'f'.repeat(64),budgetAuthorizationId:'offline-fixture'}),
  binding={runId:randomUUID(),operationId:randomUUID(),authorizationHash:hash},store=new ExecutorStore(file,identity,true);
  return {root,file,identity,scope,spec,binding,store};}
const handshake=(job:StoredExecutorJob,creationId='fictional-process-creation'):ExecutorHandshake=>({nonceHash:job.nonceHash!,profileHash:job.spec.profileHash,process:{pid:42,creationId,executableHash:job.spec.executableHash}});
function start(f:Awaited<ReturnType<typeof fixture>>){const prepared=f.store.prepare(f.spec,f.binding,base).job,launching=f.store.claimLaunch(prepared.id,f.scope,prepared.version,'1'.repeat(64),base+1);return f.store.running(prepared.id,f.scope,launching.version,handshake(launching),base+2);}
const completed=(job:StoredExecutorJob)=>ExecutorTerminalSchema.parse({state:'completed',effects:'confirmed',sessionId:'fictional-session',exit:{code:0,signal:null,verified:true},output:{relative:'results/'+job.id+'.txt',hash,bytes:6},gaps:[]});
const unknown=()=>ExecutorTerminalSchema.parse({state:'unknown',effects:'unknown',sessionId:null,exit:null,output:null,gaps:['EXECUTOR_RECEIPT_MISSING']});

test('executor storage requires explicit initialization, exact identity and supported schema',async()=>{
  const root=await mkdtemp(join(testTempDir(),'executor-init-')),file=join(root,'executor.sqlite'),identity={agentId:'fixture',profileId:'fixture'};
  assert.throws(()=>new ExecutorStore(file,identity),/INITIALIZATION_REQUIRED|SCHEMA_UNSUPPORTED/);assert.equal(existsSync(file),false);
  const store=new ExecutorStore(file,identity,true);store.close();const reopened=new ExecutorStore(file,identity);assert.equal(reopened.unresolved(),0);reopened.close();
  assert.throws(()=>new ExecutorStore(file,{...identity,agentId:'other'}),/IDENTITY_MISMATCH/);
  const db=new DatabaseSync(file);try{assert.equal(db.prepare('PRAGMA application_id').get()?.application_id,EXECUTOR_APPLICATION_ID);assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,EXECUTOR_SCHEMA_VERSION);
    assert.equal(db.prepare('SELECT count(*) AS n FROM executor_budget_links').get()?.n,0);db.exec('PRAGMA user_version=999');}finally{db.close();}
  assert.throws(()=>new ExecutorStore(file,identity),/SCHEMA_UNSUPPORTED/);
});

test('request and operation identities return the same job but never permit changed content or scope',async()=>{
  const f=await fixture();try{const first=f.store.prepare(f.spec,f.binding,base);assert.equal(first.created,true);
    assert.deepEqual(f.store.prepare(f.spec,f.binding,base+20),{job:first.job,created:false});
    const nextBinding={runId:randomUUID(),operationId:randomUUID(),authorizationHash:'2'.repeat(64)},same=f.store.prepare(f.spec,nextBinding,base+30);assert.equal(same.job.id,first.job.id);assert.equal(same.created,false);assert.deepEqual(f.store.operations(first.job.id,f.scope),[f.binding,nextBinding]);
    assert.throws(()=>f.store.prepare({...f.spec,inputHash:'0'.repeat(64)},nextBinding),/REQUEST_CONFLICT/);
    assert.throws(()=>f.store.prepare({...f.spec,requestId:'different'},f.binding),/OPERATION_CONFLICT/);
    assert.throws(()=>f.store.prepare({...f.spec,requestId:'different'},{...f.binding,operationId:randomUUID()}),/PROFILE_UNRESOLVED/);
    const taskId=randomUUID(),foreign={...f.scope,taskId,scopeKey:taskScopeKey(f.identity.agentId,taskId)};assert.throws(()=>f.store.get(first.job.id,foreign),/SCOPE_DENIED/);assert.deepEqual(f.store.list(foreign),[]);
    assert.equal(f.store.events(first.job.id,f.scope).length,1);
  }finally{f.store.close();}
});

test('launch claim is persisted once and handshakes bind exact nonce, profile, executable and process creation',async()=>{
  const f=await fixture();const other=new ExecutorStore(f.file,f.identity);try{const job=f.store.prepare(f.spec,f.binding,base).job,claimed=f.store.claimLaunch(job.id,f.scope,1,'1'.repeat(64),base+1);
    assert.equal(other.get(job.id,f.scope).state,'launching');assert.throws(()=>other.claimLaunch(job.id,f.scope,1,'2'.repeat(64)),/VERSION_CONFLICT/);
    assert.throws(()=>f.store.claimLaunch(job.id,f.scope,claimed.version,'2'.repeat(64)),/DISPATCH_FORBIDDEN/);
    const proof=handshake(claimed);for(const bad of [{...proof,nonceHash:'2'.repeat(64)},{...proof,profileHash:'2'.repeat(64)},{...proof,process:{...proof.process,executableHash:'2'.repeat(64)}}])assert.throws(()=>f.store.running(job.id,f.scope,claimed.version,bad),/HANDSHAKE_MISMATCH/);
    const running=f.store.running(job.id,f.scope,claimed.version,proof,base+2);assert.equal(running.state,'running');assert.deepEqual(f.store.running(job.id,f.scope,claimed.version,proof),running);
    assert.throws(()=>f.store.running(job.id,f.scope,running.version,{...proof,process:{...proof.process,creationId:'another-process'}}),/PROCESS_CONFLICT/);
    assert.deepEqual(f.store.events(job.id,f.scope).map(event=>event.type),['prepared','launching','running']);
    const corrupt=new DatabaseSync(f.file);try{corrupt.prepare('UPDATE executor_jobs SET process=? WHERE id=?').run(JSON.stringify({...proof.process,creationId:'tampered-pid-identity'}),job.id);}finally{corrupt.close();}
    assert.throws(()=>f.store.get(job.id,f.scope),/EVIDENCE_CHANGED/);
  }finally{other.close();f.store.close();}
});

test('sealed receipt is immutable and replay returns its existing result without another launch',async()=>{
  const f=await fixture();try{const job=start(f),terminal=completed(job),receipt=f.store.seal(job.id,f.scope,job.version,terminal,base+3);
    assert.equal(receipt.state,'completed');assert.equal(receipt.process?.creationId,'fictional-process-creation');assert.equal(f.store.unresolved(),0);
    assert.deepEqual(f.store.seal(job.id,f.scope,job.version,terminal,base+100),receipt);assert.throws(()=>f.store.seal(job.id,f.scope,job.version,unknown()),/RECEIPT_CONFLICT/);
    const duplicate=f.store.prepare(f.spec,{runId:randomUUID(),operationId:randomUUID(),authorizationHash:'2'.repeat(64)});assert.equal(duplicate.created,false);assert.deepEqual(duplicate.job.receipt,receipt);
    assert.throws(()=>f.store.claimLaunch(job.id,f.scope,duplicate.job.version,'3'.repeat(64)),/DISPATCH_FORBIDDEN/);
    const db=new DatabaseSync(f.file);try{for(const table of ['executor_events','executor_receipts','executor_job_operations'])assert.throws(()=>db.exec('UPDATE '+table+" SET body='{}'"),/Immutable/);assert.throws(()=>db.prepare('DELETE FROM executor_jobs WHERE id=?').run(job.id),/Retain/);}finally{db.close();}
    assert.equal(executorHash(f.store.get(job.id,f.scope).receipt),executorHash(receipt));
  }finally{f.store.close();}
});

test('cancellation preserves confirmed effects and cannot be used to reclassify unknown effects as none',async()=>{
  const f=await fixture();try{const job=start(f),cancelled=f.store.requestCancel(job.id,f.scope,'EXECUTOR_CANCEL_REQUESTED',base+3);assert.equal(cancelled.cancelRequested,true);assert.equal(f.store.requestCancel(job.id,f.scope,'EXECUTOR_CANCEL_REQUESTED').version,cancelled.version);
    const receipt=f.store.seal(job.id,f.scope,cancelled.version,{state:'cancelled',effects:'confirmed',sessionId:null,exit:{code:null,signal:'SIGTERM',verified:true},output:null,gaps:['EXECUTOR_CANCELLED_AFTER_EFFECT']},base+4);
    assert.equal(receipt.effects,'confirmed');assert.equal(receipt.state,'cancelled');
    assert.throws(()=>ExecutorTerminalSchema.parse({...unknown(),state:'cancelled'}));
    assert.throws(()=>f.store.seal(job.id,f.scope,cancelled.version,{state:'cancelled',effects:'none',sessionId:null,exit:{code:null,signal:'SIGTERM',verified:true},output:null,gaps:[]}),/RECEIPT_CONFLICT/);
    assert.throws(()=>ExecutorTerminalSchema.parse({...completed(job),effects:'unknown'}));
  }finally{f.store.close();}
});

test('recovery closes only proven unstarted work and keeps every ambiguous dispatch blocked across reopen',async()=>{
  const f=await fixture();let store=f.store;try{const unstarted=store.prepare(f.spec,f.binding,base).job;store.close();store=new ExecutorStore(f.file,f.identity);
    assert.equal(store.get(unstarted.id,f.scope).state,'prepared');const first=store.recover(base+10);assert.equal(first[0]?.state,'failed');assert.equal(first[0]?.effects,'none');assert.deepEqual(store.recover(base+20),[]);
    const next=store.prepare({...f.spec,requestId:'next'},{runId:randomUUID(),operationId:randomUUID(),authorizationHash:hash},base+30).job;store.claimLaunch(next.id,f.scope,next.version,'2'.repeat(64),base+31);store.close();store=new ExecutorStore(f.file,f.identity);
    assert.equal(store.get(next.id,f.scope).state,'launching');const recovered=store.recover(base+40);assert.equal(recovered[0]?.state,'unknown');assert.equal(recovered[0]?.effects,'unknown');assert.equal(store.unresolved(),1);
    assert.throws(()=>store.prepare({...f.spec,requestId:'replace-request',profileHash:'0'.repeat(64)},{runId:randomUUID(),operationId:randomUUID(),authorizationHash:hash}),/PROFILE_UNRESOLVED/);
    assert.throws(()=>store.seal(next.id,f.scope,store.get(next.id,f.scope).version,{state:'failed',effects:'none',sessionId:null,exit:null,output:null,gaps:[]}),/RECEIPT_CONFLICT/);assert.deepEqual(store.recover(),[]);
  }finally{store.close();}
});

test('a PID cannot be reused as the same process identity and an old launch nonce cannot be recycled',async()=>{
  const f=await fixture();try{const one=start(f);f.store.seal(one.id,f.scope,one.version,completed(one),base+3);
    const two=f.store.prepare({...f.spec,requestId:'new-known-job'},{runId:randomUUID(),operationId:randomUUID(),authorizationHash:hash},base+4).job;
    assert.throws(()=>f.store.claimLaunch(two.id,f.scope,two.version,'1'.repeat(64)),/NONCE_REUSED/);const launching=f.store.claimLaunch(two.id,f.scope,two.version,'2'.repeat(64),base+5);
    assert.throws(()=>f.store.running(two.id,f.scope,launching.version,handshake(launching)),/PROCESS_REUSED/);
    assert.equal(f.store.running(two.id,f.scope,launching.version,handshake(launching,'new-creation-for-same-pid'),base+6).state,'running');
  }finally{f.store.close();}
});

test('executor schema rejects conversation authority, unsafe output paths and unclassified private payloads',async()=>{
  const f=await fixture();try{assert.throws(()=>ExecutorJobSpecSchema.parse({...f.spec,scope:{kind:'conversation',agentId:f.identity.agentId,route:'fixture'}}));assert.throws(()=>ExecutorJobSpecSchema.parse({...f.spec,ownerId:'forged'}));
    const job=start(f);for(const relative of ['../secret','/absolute','C:/private','result/../../private'])assert.throws(()=>ExecutorTerminalSchema.parse({...completed(job),output:{relative,hash,bytes:1}}));
    assert.throws(()=>ExecutorTerminalSchema.parse({...completed(job),thinking:'SYNTHETIC_PRIVATE_SENTINEL'}));assert.throws(()=>ExecutorReceiptSchema.parse({...unknown(),schemaVersion:1,id:randomUUID(),jobId:job.id,createdAt:new Date(base).toISOString(),nonceHash:job.nonceHash,process:job.process,stderr:'SYNTHETIC_PRIVATE_SENTINEL'}));
    assert.throws(()=>f.store.seal(job.id,f.scope,job.version,{state:'failed',effects:'none',sessionId:null,exit:null,output:null,gaps:[]}),/TERMINAL_UNPROVEN/);
  }finally{f.store.close();}
});
