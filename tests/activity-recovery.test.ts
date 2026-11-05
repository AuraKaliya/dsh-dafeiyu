import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import type {Context} from '@deepseek-ai/cordis';
import {ActivityStore,createActivityStorageSchema} from '../packages/activity/lib/store.js';
import {IdleActivity} from '../packages/activity/lib/idle.js';
import {ActivityModelRecovery} from '../packages/activity/lib/model-recovery.js';
import {inspectActivityMigration,migrateActivityStorage} from '../packages/activity/lib/migration.js';
import {testTempDir} from './test-temp.js';
import {sdkFixture,FixtureAdapter,textResponse} from './sdk-fixture.js';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import type {DafeiyuService} from '@dafeiyu/core';

async function fixture(explorationIntervalMs=60000){
  const root=await mkdtemp(join(testTempDir(),'activity-recovery-')),file=join(root,'activity.sqlite'),identity={agentId:'fish',profileId:'recovery'};
  let store=new ActivityStore(file,identity,{explorationIntervalMs,ownerSharing:{enabled:false}},true);
  const taskId=randomUUID(),runs=new Map<string,{state:string;error:string|null;taskId:string;version:number;checkpoints:string[];operations:{state:string;status:string;effects:string}[]}>();
  const requests=new Map<string,string>();let submits=0,resumes=0,taskState='active';
  const create=()=>{const id=randomUUID();runs.set(id,{state:'running',error:null,taskId,version:1,checkpoints:[randomUUID()],operations:[]});return id;};
  const port={submitTask:()=>{submits++;return {run:{id:create()}};},restoreRun:(id:string)=>({id}),status:(ref:{id:string})=>runs.get(ref.id)!,openTask:(id:string)=>({id}),taskState:()=>({status:taskState,version:1}),
    resume:(_task:unknown,input:{requestId:string;taskId:string;parentRunId:string;checkpointId:string})=>{assert.equal(input.taskId,taskId);assert.ok(runs.get(input.parentRunId)?.checkpoints.includes(input.checkpointId));
      let id=requests.get(input.requestId);if(!id){resumes++;id=create();requests.set(input.requestId,id);}return {run:{id}};}};
  const ctx={dafeiyu:{requestActivityShare:()=>null,explorationCandidates:async()=>[{key:'bili:same',revision:'v1',provider:'bilibili',reference:'same',title:'unchanged',prior:submits?'blocked':'none'}],managementUsage:()=>({tokens:1,knownTokens:1,calls:1}),executionProducer:()=>port}} as unknown as Context;
  let idle=new IdleActivity(ctx,store);
  return {root,file,identity,ctx,port,runs,get store(){return store;},get idle(){return idle;},get submits(){return submits;},get resumes(){return resumes;},
    fail(code='MODEL_HTTP_402'){const id=store.idle.pending()!.runs.at(-1)!;Object.assign(runs.get(id)!,{state:'failed',error:code});},
    cancelTask(){taskState='cancelled';},restart(){store.close();store=new ActivityStore(file,identity);idle=new IdleActivity(ctx,store);},close(){store.close();}};
}

test('restored model resumes the same task and checkpoint even when catalog says already blocked, once across restart',async()=>{
  const f=await fixture();try{
    assert.equal(await f.idle.start(0),true);f.idle.control(1,false);const original=f.store.idle.pending()!;f.fail();f.idle.control(2,false);
    for(let i=1;i<=100;i++)assert.equal(await f.idle.start(i*60000),false);
    const gate=f.store.admission.gate('idle.model')!;assert.equal(f.store.admission.restore('idle.model',gate.generation-1,6100000),false);
    assert.equal(f.store.admission.restore('idle.model',gate.generation,6100000),true);f.restart();
    assert.equal(await f.idle.start(6100001),true);const pending=f.store.idle.pending()!,intent=f.store.recovery.byWork(pending.id)!;
    assert.equal(intent.parentRunId,original.runs[0]);assert.notEqual(pending.candidate?.claim,original.candidate?.claim);
    // Core accepted the durable intent, but the process died before activity acknowledged it.
    f.port.resume(f.port.openTask(intent.resume!.taskId),intent.resume!);f.restart();f.idle.control(6100002,false);
    assert.equal(f.submits,1);assert.equal(f.resumes,1);assert.equal(f.store.idle.pending()!.runs.length,1);
    const resumed=f.store.idle.pending()!.runs[0]!;Object.assign(f.runs.get(resumed)!,{state:'completed',error:null});f.idle.control(6100003,false);
    f.restart();for(let i=1;i<=100;i++){f.idle.control(6200000+i*60000,false);assert.equal(await f.idle.start(6200000+i*60000),false);}
    assert.equal(f.submits,1);assert.equal(f.resumes,1);assert.equal(f.store.admission.read('bili:same')?.state,'complete');
    assert.equal(f.store.rounds.list().reduce((n,r)=>n+r.knownTokens,0),2,'old run usage must not be counted again');
  }finally{f.close();}
});

test('expired transport cooldown alone cannot launch a heavy task and repeated failed continuations stop after three attempts',async()=>{
  const f=await fixture();try{
    await f.idle.start(0);f.idle.control(1,false);
    for(let attempt=0;attempt<4;attempt++){
      const at=attempt*1000000+2;f.fail('MODEL_HTTP_503');f.idle.control(at,false);
      assert.equal(await f.idle.start(at+999999),false,'a cooldown is not proof of recovery');
      const gate=f.store.admission.gate('idle.model')!;f.store.admission.restore('idle.model',gate.generation,at+1000000);
      assert.equal(await f.idle.start(at+1000001),attempt<3);if(attempt<3)f.idle.control(at+1000002,false);
    }
    assert.equal(f.submits,1);assert.equal(f.resumes,3);assert.equal(f.store.recovery.list().at(-1)?.code,'ACTIVITY_RECOVERY_LIMIT');
  }finally{f.close();}
});

test('unknown side effects and a cancelled task remain held after dependency recovery',async()=>{
  for(const reason of ['unknown','cancelled']){const f=await fixture();try{
    await f.idle.start(0);f.idle.control(1,false);if(reason==='unknown')f.runs.get(f.store.idle.pending()!.runs[0]!)!.operations.push({state:'unknown',status:'unknown',effects:'unknown'});
    f.fail();f.idle.control(2,false);if(reason==='cancelled')f.cancelTask();const gate=f.store.admission.gate('idle.model')!;f.store.admission.restore('idle.model',gate.generation,100000);
    assert.equal(await f.idle.start(100001),false);assert.equal(f.resumes,0);assert.equal(f.store.recovery.list()[0]?.code,reason==='unknown'?'OPERATION_UNCERTAIN':'TASK_NOT_ACTIVE');
  }finally{f.close();}}
});

test('one model probe owns a failure generation; stale success cannot clear a newer block and failed probes are bounded',async()=>{
  const f=await fixture();let now=100000,finish!:(value:{okay:boolean;code:string})=>void,calls=0;
  const ctx={root:{on:()=>()=>{}},dafeiyu:{analysisModelRoute:()=>({provider:'fixture',model:'one'}),probeModelRecovery:()=>{calls++;return new Promise<{okay:boolean;code:string}>(resolve=>{finish=resolve;});}}} as unknown as Context;
  const recovery=new ActivityModelRecovery(ctx,f.store,()=>now);try{
    const old=f.store.admission.block('idle.model','MODEL_HTTP_402',null,now),first=recovery.probe({requestId:randomUUID(),expectedGeneration:old.generation});
    const duplicate=recovery.probe({requestId:randomUUID(),expectedGeneration:old.generation});assert.equal(first,duplicate);await Promise.resolve();assert.equal(calls,1);
    const newer=f.store.admission.block('idle.model','MODEL_HTTP_503',now,now);finish({okay:true,code:''});assert.equal((await first).state,'stale');assert.equal(f.store.admission.gate('idle.model')?.generation,newer.generation);
    for(let i=0;i<3;i++){now+=10000000;recovery.schedule(now);await Promise.resolve();finish({okay:false,code:'MODEL_HTTP_503'});await recovery.probe({requestId:randomUUID(),expectedGeneration:newer.generation});}
    now+=10000000;recovery.schedule(now);assert.equal(calls,4);assert.equal(f.store.admission.gate('idle.model')?.until,null);
    const requestId=randomUUID(),manual=recovery.probe({requestId,expectedGeneration:newer.generation});await Promise.resolve();finish({okay:true,code:''});assert.equal((await manual).state,'succeeded');
    assert.equal((await recovery.probe({requestId,expectedGeneration:newer.generation})).state,'succeeded');assert.equal(calls,5);
  }finally{await recovery.close();f.close();}
});

test('activity v3 to v4 preserves old blocked candidates and rejects old-schema startup',async()=>{
  const root=await mkdtemp(join(testTempDir(),'activity-v4-migration-')),file=join(root,'activity.sqlite'),backup=join(root,'before.sqlite'),identity={agentId:'fish',profileId:'upgrade'};
  const db=new DatabaseSync(file);try{createActivityStorageSchema(db,true,false);db.prepare('INSERT INTO activity_metadata VALUES(1,?)').run(JSON.stringify(identity));
    db.prepare('INSERT INTO activity_control VALUES(?,?)').run('idle.model',JSON.stringify({generation:4,reason:'MODEL_HTTP_402',until:null,updatedAt:10}));
  }finally{db.close();}
  assert.equal(inspectActivityMigration(file,identity).state,'upgradable');assert.throws(()=>new ActivityStore(file,identity),/ACTIVITY_SCHEMA_UNSUPPORTED/);
  const result=migrateActivityStorage(file,identity,backup);assert.equal(result.version,4);assert.equal(result.verified.length,19);assert.equal(inspectActivityMigration(backup,identity).version,3);
  const store=new ActivityStore(file,identity);try{assert.equal(store.admission.gate('idle.model')?.generation,4);assert.deepEqual(store.recovery.list(),[]);}finally{store.close();}
});

test('a verified recovery continues old work before the next catalog interval while respecting explicit rest',async()=>{
  const f=await fixture(1800000);try{await f.idle.start(0);f.idle.control(1,false);f.fail();f.idle.control(2,false);
    const gate=f.store.admission.gate('idle.model')!;f.store.admission.restore('idle.model',gate.generation,60002);
    f.store.admission.block('idle.rest','agent-requested-rest',70000,60002);assert.equal(await f.idle.start(60003),false);assert.equal(await f.idle.start(70000),true);
  }finally{f.close();}
});

test('only a successful request begun after the current failure on the same model route can confirm recovery',async()=>{
  const f=await fixture();let release!:()=>void,started!:()=>void,hold=true,now=1;
  const adapter=new FixtureAdapter(async function*(){started();if(hold)await new Promise<void>(resolve=>{release=resolve;});yield* textResponse('OK');});
  const ctx=await sdkFixture(join(f.root,'sessions'),adapter);ctx.provide('dafeiyu',{analysisModelRoute:()=>({provider:'fixture',model:'one'})} as unknown as DafeiyuService);
  const recovery=new ActivityModelRecovery(ctx,f.store,()=>now);
  const consume=async(model='one')=>{for await(const _ of ctx.llm.stream({provider:'fixture',model,messages:[createUserMessage({source:{kind:'user'},content:[{type:'text',text:'fixture'}]})]})){/* drain */}};
  try{
    let began=new Promise<void>(resolve=>{started=resolve;}),request=consume();await began;const first=f.store.admission.block('idle.model','MODEL_HTTP_402',null,now++);release();await request;
    assert.equal(f.store.admission.gate('idle.model')?.generation,first.generation,'a pre-failure request is not recovery evidence');
    began=new Promise<void>(resolve=>{started=resolve;});request=consume();await began;const second=f.store.admission.block('idle.model','MODEL_HTTP_403',null,now++);release();await request;
    assert.equal(f.store.admission.gate('idle.model')?.generation,second.generation,'late success cannot clear a newer failure');
    hold=false;started=()=>{};await consume('other');assert.equal(f.store.admission.gate('idle.model')?.reason,'MODEL_HTTP_403');
    await consume();assert.equal(f.store.admission.gate('idle.model')?.reason,'restored');assert.equal(f.store.admission.gate('idle.model')?.generation,second.generation+1);
  }finally{await recovery.close();await ctx.fiber.dispose();f.close();}
});
