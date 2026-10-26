import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile,link,mkdir,mkdtemp,readFile,readdir,rename,symlink,writeFile } from 'node:fs/promises';
import { join,relative } from 'node:path';
import { ServerRuntimeStatusWriter,readServerRuntimeStatus,SERVER_RUNTIME_STATUS_FILE,SERVER_RUNTIME_STATUS_MAX_BYTES } from '../packages/server-runtime/lib/launch-state.js';
import type { ServerRuntimeStatusIdentity,ServerRuntimeStatusInput } from '../packages/server-runtime/lib/launch-state.js';
import { testTempDir } from './test-temp.js';

const identity:ServerRuntimeStatusIdentity={profileId:'fixture',agentId:'dafeiyu',accountingId:'synthetic-status-only',manifestHash:'a'.repeat(64),configHash:'b'.repeat(64)};
const counts={activeRuns:0,queuedRuns:0,queuedRoutes:0,pendingMessages:0,outbox:0};
async function fixture(){const root=await mkdtemp(join(testTempDir(),'launch-state-')),coreDir=join(root,'core');await mkdir(coreDir);const now=Date.now(),instanceId=randomUUID();
  const parentProof={pid:process.pid,creationId:'133000000000000000',nodeHash:'c'.repeat(64),ownerSid:'S-1-5-21-123-456-789-1001',observedAt:new Date(now).toISOString()};
  const host={instanceId,observedAt:new Date(now).toISOString(),phase:'ready' as const,accepting:true,counts};
  const starting:ServerRuntimeStatusInput={state:'starting',host:null,parentProof:null,stop:null,closure:{drained:false,proof:'not-created'}};
  const running:ServerRuntimeStatusInput={state:'running',host,parentProof,stop:null,closure:{drained:false,proof:'open'}};
  const stop:ServerRuntimeStatusInput={state:'stopping',host:{...host,phase:'draining',accepting:false},parentProof,stop:{kind:'accounting-stop',code:'RUNTIME_USAGE_UNKNOWN',reason:'unknown-cost'},closure:{drained:false,proof:'open'}};
  const stopped:ServerRuntimeStatusInput={...stop,state:'stopped',host:{...host,phase:'stopped',accepting:false},closure:{drained:true,proof:'closed'}};
  return {root,coreDir,now,starting,running,stop,stopped,writer:()=>new ServerRuntimeStatusWriter({coreDir,...identity}),read:(time=now)=>readServerRuntimeStatus(coreDir,identity,{now:time,maxAgeMs:1000})};
}

test('missing status is read without creating a file, directory, model, process proof or accounting window',async()=>{
  const f=await fixture(),before=await readdir(f.coreDir);assert.deepEqual(f.read(),{kind:'missing',live:'unverified',fresh:false,code:'SERVER_RUNTIME_STATUS_MISSING'});assert.deepEqual(await readdir(f.coreDir),before);
  const missing=join(f.root,'missing');assert.equal(readServerRuntimeStatus(missing,identity,{maxAgeMs:1000}).kind,'invalid');assert.equal(existsSync(missing),false);
});

test('program snapshots retain actual accepting=false and never claim live merely because running is fresh',async()=>{
  const f=await fixture(),writer=f.writer();const first=writer.write(f.starting,f.now),second=writer.write({...f.running,host:{...f.running.host!,accepting:false}},f.now+1);
  assert.equal(first.sequence,1);assert.equal(second.sequence,2);assert.equal(second.writerId,first.writerId);assert.equal(second.writerPid,process.pid);assert.ok(Object.isFrozen(second));
  const read=f.read(f.now+2);assert.equal(read.kind,'snapshot');if(read.kind!=='snapshot')throw new Error('Missing fixture snapshot');
  assert.equal(read.live,'unverified');assert.equal(read.fresh,true);assert.equal(read.snapshot.host!.accepting,false);assert.equal('healthy'in read,false);assert.equal(read.accountingStopped,false);assert.equal(read.recordedAccountingStopReceipt,false);
  assert.deepEqual((await readdir(f.coreDir)).filter(name=>name.endsWith('.tmp')),[]);
});

test('accounting terminal receipt appears only after actual-close metadata, with original cause retained',async()=>{
  const f=await fixture(),writer=f.writer();writer.write(f.starting,f.now);writer.write(f.running,f.now+1);writer.write(f.stop,f.now+2);
  const pending=f.read(f.now+2);assert.equal(pending.kind,'snapshot');if(pending.kind!=='snapshot')throw new Error('Missing fixture snapshot');assert.equal(pending.accountingStopped,true);assert.equal(pending.recordedAccountingStopReceipt,false);
  writer.write(f.stopped,f.now+3);const ended=f.read(f.now+3);assert.equal(ended.kind,'snapshot');if(ended.kind!=='snapshot')throw new Error('Missing fixture snapshot');
  assert.equal(ended.recordedAccountingStopReceipt,true);assert.equal(ended.snapshot.stop!.code,'RUNTIME_USAGE_UNKNOWN');assert.equal(ended.snapshot.closure.proof,'closed');assert.equal(ended.live,'unverified');
  const old=f.read(f.now+30000);assert.equal(old.kind,'snapshot');if(old.kind==='snapshot'){assert.equal(old.fresh,false);assert.equal(old.live,'unverified');assert.equal(old.code,'SERVER_RUNTIME_STATUS_STALE');}
});

test('a FUNDING-prefixed configuration fault stays a runtime failure and is not inferred to be budget exhaustion',async()=>{
  const f=await fixture(),writer=f.writer();writer.write(f.starting,f.now);
  writer.write({state:'failed',host:null,parentProof:null,stop:{kind:'runtime-failure',code:'ACCOUNTING_FILE_CHANGED'},closure:{drained:true,proof:'not-created'}},f.now+1);
  const read=f.read(f.now+2);assert.equal(read.kind,'snapshot');if(read.kind==='snapshot'){assert.equal(read.accountingStopped,false);assert.equal(read.recordedAccountingStopReceipt,false);assert.equal(read.snapshot.parentProof,null);}
});

test('inconsistent drain/proof/ingress claims fail before replacing the prior snapshot',async()=>{
  const f=await fixture(),writer=f.writer();writer.write(f.running,f.now);const before=await readFile(writer.file);
  const bad:readonly {input:ServerRuntimeStatusInput;message:string}[]=[
    {input:{...f.stopped,closure:{drained:false,proof:'closed'}},message:'SERVER_RUNTIME_STATUS_INPUT_INVALID'},
    {input:{...f.stop,closure:{drained:true,proof:'closed'}},message:'SERVER_RUNTIME_STATUS_INPUT_INVALID'},
    {input:{...f.stopped,closure:{drained:true,proof:'open'}},message:'SERVER_RUNTIME_STATUS_INPUT_INVALID'},
    // Identity continuity is checked before the final snapshot's closure consistency.
    {input:{...f.stopped,parentProof:null},message:'SERVER_RUNTIME_STATUS_PROCESS_CHANGED'},
    {input:{...f.stopped,host:{...f.stopped.host!,accepting:true}},message:'SERVER_RUNTIME_STATUS_INPUT_INVALID'},
    {input:{...f.stopped,state:'failed',closure:{drained:true,proof:'unconfirmed'}},message:'SERVER_RUNTIME_STATUS_INPUT_INVALID'},
  ];
  for(const {input,message} of bad)assert.throws(()=>writer.write(input,f.now+1),{message});
  assert.deepEqual(await readFile(writer.file),before);assert.deepEqual((await readdir(f.coreDir)).filter(name=>name.endsWith('.tmp')),[]);
});

test('old Host observations and future timestamps do not become fresh by rewriting the status envelope',async()=>{
  const f=await fixture(),writer=f.writer();writer.write(f.running,f.now);writer.write(f.running,f.now+5000);
  const staleHost=f.read(f.now+5000);assert.equal(staleHost.kind,'snapshot');if(staleHost.kind==='snapshot'){assert.equal(staleHost.ageMs,0);assert.equal(staleHost.hostAgeMs,5000);assert.equal(staleHost.fresh,false);assert.equal(staleHost.live,'unverified');}
  const future=f.read(f.now+4000);assert.equal(future.kind,'snapshot');if(future.kind==='snapshot'){assert.equal(future.fresh,false);assert.equal(future.code,'SERVER_RUNTIME_STATUS_FUTURE');}
  assert.throws(()=>writer.write(f.running,f.now+4999),/CLOCK_MOVED_BACKWARDS/);
});

test('snapshot identity, directory relocation and file aliases cannot become another profile current state',async()=>{
  const f=await fixture(),writer=f.writer();writer.write(f.running,f.now);
  const foreign=readServerRuntimeStatus(f.coreDir,{...identity,manifestHash:'d'.repeat(64)},{now:f.now,maxAgeMs:1000});assert.equal(foreign.kind,'invalid');assert.equal(foreign.code,'SERVER_RUNTIME_STATUS_IDENTITY_MISMATCH');
  const copied=join(f.root,'copied');await mkdir(copied);await copyFile(writer.file,join(copied,SERVER_RUNTIME_STATUS_FILE));assert.equal(readServerRuntimeStatus(copied,identity,{now:f.now,maxAgeMs:1000}).kind,'invalid');
  await link(writer.file,join(f.root,'alias.json'));assert.equal(f.read().kind,'invalid');assert.throws(()=>f.writer(),/PATH_INVALID/);
});

test('a stale writer cannot overwrite a newer generation, and a finalized writer cannot resurrect itself',async()=>{
  const f=await fixture(),one=f.writer(),other=f.writer();one.write(f.running,f.now);assert.throws(()=>other.write(f.starting,f.now+1),/WRITER_CHANGED/);
  const final=one.write(f.stopped,f.now+1);assert.equal(one.write(f.stopped,f.now+100).sequence,final.sequence);assert.equal(one.write(f.stopped,f.now+100).at,final.at);
  assert.throws(()=>one.write(f.running,f.now+2),/FINALIZED/);
  const next=f.writer(),start=next.write(f.starting,f.now+3);assert.notEqual(start.writerId,final.writerId);assert.equal(start.sequence,final.sequence+1);
  assert.throws(()=>one.write(f.stopped,f.now+4),/WRITER_CHANGED/);
});

test('same writer cannot substitute the Windows creation identity or Host instance',async()=>{
  const f=await fixture(),writer=f.writer();writer.write(f.running,f.now);
  assert.throws(()=>writer.write({...f.running,parentProof:{...f.running.parentProof!,creationId:'133999999999999999'}},f.now+1),/PROCESS_CHANGED/);
  assert.throws(()=>writer.write({...f.running,host:{...f.running.host!,instanceId:randomUUID()}},f.now+1),/HOST_INSTANCE_CHANGED/);
  assert.throws(()=>writer.write({...f.running,host:{...f.running.host!,observedAt:new Date(f.now+100).toISOString()}},f.now+1),/INPUT_INVALID/);
});

test('bounded parsing rejects corrupt/oversized or private payloads without returning those contents',async()=>{
  const f=await fixture(),file=join(f.coreDir,SERVER_RUNTIME_STATUS_FILE),sentinel='FICTIONAL_PRIVATE_STATUS_SENTINEL';
  await writeFile(file,JSON.stringify({apiKey:sentinel,modelText:sentinel}));const bad=f.read();assert.equal(bad.kind,'invalid');assert.ok(!JSON.stringify(bad).includes(sentinel));assert.throws(()=>f.writer());
  await writeFile(file,'x'.repeat(SERVER_RUNTIME_STATUS_MAX_BYTES+1));assert.equal(f.read().kind,'invalid');
});

test('directory replacement and junction redirection are rejected without touching redirected data',async()=>{
  const f=await fixture(),writer=f.writer();writer.write(f.starting,f.now);const old=join(f.root,'old-core'),foreign=join(f.root,'foreign');
  // Both exact move targets are within this managed test's newly created directory.
  for(const path of [f.coreDir,old,foreign])assert.ok(relative(f.root,path)&&!relative(f.root,path).startsWith('..'));
  await rename(f.coreDir,old);await mkdir(f.coreDir);assert.throws(()=>writer.write(f.starting,f.now+1),/DIRECTORY_CHANGED/);assert.equal(existsSync(join(f.coreDir,SERVER_RUNTIME_STATUS_FILE)),false);
  const redirected=join(f.root,'redirected');await mkdir(foreign);await writeFile(join(foreign,SERVER_RUNTIME_STATUS_FILE),'DO_NOT_REPLACE');await symlink(foreign,redirected,'junction');
  assert.equal(readServerRuntimeStatus(redirected,identity,{now:f.now,maxAgeMs:1000}).kind,'invalid');assert.throws(()=>new ServerRuntimeStatusWriter({coreDir:redirected,...identity}),/DIRECTORY_INVALID/);
  assert.equal(await readFile(join(foreign,SERVER_RUNTIME_STATUS_FILE),'utf8'),'DO_NOT_REPLACE');
});

test('an actual-UTC clock-stop receipt survives regression while staying explicitly non-live and non-fresh',async()=>{
  const f=await fixture(),writer=f.writer(),before=writer.write(f.running,f.now),actualEarlier=f.now-1000;
  const stopped=writer.write({...f.stopped,stop:{kind:'accounting-stop',code:'ACCOUNTING_CLOCK_MOVED_BACKWARDS',reason:'clock-stop'}},actualEarlier);
  assert.equal(stopped.at,new Date(actualEarlier).toISOString());assert.equal(stopped.clockRegressed,true);assert.equal(stopped.sequence,2);assert.equal(stopped.writerPid,before.writerPid);assert.equal(stopped.writerId,before.writerId);
  const read=readServerRuntimeStatus(f.coreDir,identity,{now:actualEarlier,maxAgeMs:1000});assert.equal(read.kind,'snapshot');
  if(read.kind==='snapshot'){assert.equal(read.live,'unverified');assert.equal(read.fresh,false);assert.equal(read.code,'SERVER_RUNTIME_STATUS_CLOCK_REGRESSED');assert.equal(read.recordedAccountingStopReceipt,true);}
});
