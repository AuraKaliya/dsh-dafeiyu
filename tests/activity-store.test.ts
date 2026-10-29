import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ActivityStore,activityHash } from '../packages/activity/lib/store.js';
import { nextAllowed,daySlices } from '../packages/activity/lib/time.js';
import { taskScopeKey } from '@dafeiyu/contracts';
import type { ActivityScheduleBody,ActivityConfigSchema,WakeOccurrenceBody } from '@dafeiyu/contracts';
import type { z } from 'zod';
import { testTempDir } from './test-temp.js';

const base=Date.parse('2026-10-25T00:00:00Z'),iso=(time:number)=>new Date(time).toISOString();
async function fixture(config:z.input<typeof ActivityConfigSchema>={}){
  const root=await mkdtemp(join(testTempDir(),'activity-store-')),file=join(root,'activity.sqlite'),identity={agentId:'fictional-fish',profileId:'fixture'},taskId=randomUUID();
  const scope={kind:'task' as const,agentId:identity.agentId,taskId,scopeKey:taskScopeKey(identity.agentId,taskId)},store=new ActivityStore(file,identity,config,true);
  const input={schemaVersion:1,requestId:'create',agentId:identity.agentId,owner:scope,purpose:'exploration',goal:'自主比较虚构蓝灯，允许休息',basis:[],
    anchor:{schemaVersion:1,id:randomUUID(),runId:randomUUID(),operationId:randomUUID(),scope,intentVersion:1,kind:'execution',hash:'a'.repeat(64)},maintenanceId:null,policyId:'activity-explore',configHash:activityHash(config),
    trigger:{kind:'interval',anchorAt:iso(base),intervalMs:60000},missed:'coalesce',timeZone:'Asia/Shanghai',quiet:[],state:'active'};
  const create=(patch:Record<string,unknown>={},now=base)=>{const result=store.create({...input,...patch},now);store.bindTask(result.id,1,randomUUID(),1);return result;};
  return {root,file,identity,scope,store,input,create,close:()=>store.close()};
}
function complete(store:ActivityStore,occurrence:WakeOccurrenceBody,start:number,end:number,unknownEffects=false){const runId=randomUUID();store.acknowledge(occurrence.id,runId,start);
  store.runEvent({id:randomUUID(),occurrenceId:occurrence.id,runId,state:'running',at:iso(start),unknownEffects:false});
  const event={id:randomUUID(),occurrenceId:occurrence.id,runId,state:'completed',at:iso(end),unknownEffects};store.runEvent(event);return event;}

test('activity storage preserves immutable history, exact request identity, scope and compare-and-swap',async()=>{
  const f=await fixture();try{const first=f.create();assert.deepEqual(f.store.create(f.input,base+1000),first);
    assert.throws(()=>f.store.create({...f.input,goal:'不同目的'},base),/IDEMPOTENCY_CONFLICT/);
    const updated=f.store.update(first.id,f.scope,{requestId:'pause',expectedVersion:1,state:'paused'},base+2000);assert.equal(updated.version,2);
    assert.deepEqual(f.store.update(first.id,f.scope,{requestId:'pause',expectedVersion:1,state:'paused'},base+3000),updated);
    assert.throws(()=>f.store.update(first.id,f.scope,{requestId:'stale',expectedVersion:1,state:'active'},base),/VERSION_CONFLICT/);
    const foreignId=randomUUID(),foreign={...f.scope,taskId:foreignId,scopeKey:taskScopeKey(f.identity.agentId,foreignId)};
    assert.throws(()=>f.store.get(first.id,foreign),/SCOPE_DENIED/);assert.equal(f.store.list(foreign).length,0);
    const bound=f.store.task(first.id)!;assert.equal(f.store.get(first.id,{...f.scope,taskId:bound.taskId,scopeKey:taskScopeKey(f.identity.agentId,bound.taskId)}).body.goal,f.input.goal);
    const db=new DatabaseSync(f.file);try{assert.equal(db.prepare('SELECT count(*) AS n FROM activity_schedule_revisions').get()?.n,2);assert.throws(()=>db.exec("UPDATE activity_schedule_revisions SET body='{}'"),/Immutable/);}finally{db.close();}
  }finally{f.close();}
});

test('coalesced late intervals produce one durable occurrence and clock rollback never duplicates it',async()=>{
  const f=await fixture();try{const plan=f.create(),now=base+5*60000+1000,occurrence=f.store.issue(plan.id,now)!;assert.equal(occurrence.dueAt,iso(base+5*60000));
    assert.equal(f.store.get(plan.id).nextDue,base+6*60000);assert.equal(f.store.issue(plan.id,base+60000),null);assert.equal(f.store.outbox().length,1);
    const event=complete(f.store,occurrence,now,now+1000);f.store.runEvent(event);assert.equal(f.store.used(now),1000);assert.equal(f.store.outbox().length,0);
    assert.equal(f.store.issue(plan.id,now+2000),null);assert.notEqual(f.store.issue(plan.id,base+6*60000+2000)?.id,occurrence.id);
  }finally{f.close();}
});

test('skip and run-once policies do not replay each missed period',async()=>{
  const f=await fixture();try{const skipped=f.create({missed:'skip'});assert.equal(f.store.issue(skipped.id,base+10*60000),null);assert.equal(f.store.get(skipped.id).nextDue,base+11*60000);
    const once=f.create({requestId:'once',missed:'run-once'});const occurrence=f.store.issue(once.id,base+10*60000)!;assert.equal(f.store.get(once.id).status,'exhausted');
    complete(f.store,occurrence,base+10*60000,base+10*60000+1000);assert.equal(f.store.issue(once.id,base+20*60000),null);
  }finally{f.close();}
});

test('quiet periods span midnight and follow real DST gaps and folds',async()=>{
  assert.equal(nextAllowed(Date.parse('2026-10-24T15:59:30Z'),'Asia/Shanghai',[{start:'23:00',end:'08:00'}]),Date.parse('2026-10-25T00:00:00Z'));
  assert.equal(nextAllowed(Date.parse('2026-03-29T00:30:00Z'),'Europe/Berlin',[{start:'01:00',end:'03:00'}]),Date.parse('2026-03-29T01:00:00Z'));
  assert.equal(nextAllowed(Date.parse('2026-10-25T00:30:00Z'),'Europe/Berlin',[{start:'02:00',end:'03:00'}]),Date.parse('2026-10-25T02:00:00Z'));
  assert.throws(()=>nextAllowed(base,'UTC',[{start:'00:00',end:'12:00'},{start:'12:00',end:'00:00'}]),/QUIET_ALL_DAY/);
  assert.deepEqual(daySlices(Date.parse('2026-03-28T23:00:00Z'),Date.parse('2026-03-29T22:00:00Z'),'Europe/Berlin'),[{day:'2026-03-29',milliseconds:23*3600000}]);
  assert.deepEqual(daySlices(Date.parse('2026-10-25T15:59:00Z'),Date.parse('2026-10-25T16:01:00Z'),'Asia/Shanghai'),[{day:'2026-10-25',milliseconds:60000},{day:'2026-10-26',milliseconds:60000}]);
});

test('condition ids and watermarks deduplicate, and derived activity never triggers itself',async()=>{
  const f=await fixture();try{const plan=f.create({trigger:{kind:'condition',event:'task-settled',key:'fictional-task'}});
    const event={id:'event-1',type:'task-settled' as const,key:'fictional-task',watermark:'v1',occurredAt:iso(base),origin:'primary' as const,causedBy:null};
    assert.equal(f.store.event(event),f.store.event(event));assert.throws(()=>f.store.event({...event,watermark:'changed'}),/IDEMPOTENCY_CONFLICT/);
    const occurrence=f.store.issue(plan.id,base)!;complete(f.store,occurrence,base,base+1000);
    f.store.event({...event,id:'repeated-watermark'});f.store.event({...event,id:'own-event',watermark:'v2',origin:'activity'});assert.equal(f.store.issue(plan.id,base+60000),null);
    f.store.event({...event,id:'new-event',watermark:'v2'});assert.ok(f.store.issue(plan.id,base+60000));
  }finally{f.close();}
});

test('due cursor, occurrence and outbox are atomic and survive reopening with the same id',async()=>{
  const f=await fixture();let reopened:ActivityStore|undefined;try{const plan=f.create();const db=new DatabaseSync(f.file);db.exec("CREATE TRIGGER injected BEFORE INSERT ON activity_outbox BEGIN SELECT RAISE(ABORT,'injected');END;");
    assert.throws(()=>f.store.issue(plan.id,base),/injected/);assert.equal(f.store.get(plan.id).nextDue,base);assert.equal(db.prepare('SELECT count(*) AS n FROM activity_occurrences').get()?.n,0);
    db.exec('DROP TRIGGER injected');db.close();const occurrence=f.store.issue(plan.id,base)!;f.close();
    reopened=new ActivityStore(f.file,f.identity);assert.equal(reopened.outbox()[0]?.body.id,occurrence.id);assert.equal(reopened.issue(plan.id,base+60000),null);
    const runId=randomUUID();reopened.acknowledge(occurrence.id,runId,base);reopened.acknowledge(occurrence.id,runId,base);assert.throws(()=>reopened!.acknowledge(occurrence.id,randomUUID(),base),/RECEIPT_CONFLICT/);
  }finally{reopened?.close();f.close();}
});

test('editing cancels queued occurrences and a late acceptance cannot reactivate them',async()=>{
  const f=await fixture();try{const plan=f.create(),occurrence=f.store.issue(plan.id,base)!;
    f.store.update(plan.id,f.scope,{requestId:'rest',expectedVersion:1,state:'paused'},base);assert.equal(f.store.occurrence(occurrence.id).state,'cancelled');assert.equal(f.store.outbox().length,0);
    f.store.acknowledge(occurrence.id,randomUUID(),base+1000);assert.equal(f.store.occurrence(occurrence.id).state,'cancelled');assert.equal(f.store.issue(plan.id,base+60000),null);
  }finally{f.close();}
});

test('unknown effects block future wakes and completed usage is charged only once',async()=>{
  const f=await fixture({roundDurationMs:1000});try{const plan=f.create(),occurrence=f.store.issue(plan.id,base)!;const event=complete(f.store,occurrence,base,base+1000,true);
    f.store.runEvent(event);assert.equal(f.store.get(plan.id).status,'blocked');assert.equal(f.store.used(base),1000);assert.equal(f.store.issue(plan.id,base+60000),null);
    f.store.rounds.settle(occurrence.id,{tokens:12,knownTokens:12},1000,base+1000);const second=f.create({requestId:'another'});assert.equal(f.store.issue(second.id,base+60000),null);
  }finally{f.close();}
});

test('unexpected schemas, identity changes and all-day quiet configuration fail without replacing the database',async()=>{
  const f=await fixture();f.create();f.close();const original=await readFile(f.file);
  assert.throws(()=>new ActivityStore(f.file,{...f.identity,agentId:'other'}),/IDENTITY_MISMATCH/);assert.deepEqual(await readFile(f.file),original);
  const db=new DatabaseSync(f.file);db.exec('PRAGMA user_version=99');db.close();const future=await readFile(f.file);assert.throws(()=>new ActivityStore(f.file,f.identity),/SCHEMA_UNSUPPORTED/);assert.deepEqual(await readFile(f.file),future);
  assert.throws(()=>new ActivityStore(join(f.root,'missing.sqlite'),f.identity),/INITIALIZATION_REQUIRED|SCHEMA_UNSUPPORTED/);
});

test('activities continue within a round and the interval starts after round completion',async()=>{
  const f=await fixture();try{const first=f.create(),second=f.create({requestId:'second'}),occurrence=f.store.issue(first.id,base)!;
    complete(f.store,occurrence,base,base+1000);f.store.rounds.settle(occurrence.id,{tokens:10,knownTokens:10},1000,base+1000);f.store.rounds.end('rest',base+1000);assert.equal(f.store.issue(second.id,base+60000),null);assert.ok(f.store.issue(second.id,base+61000));
  }finally{f.close();}
});

test('failed periodic runs back off and replacement of paused work cannot charge its elapsed time twice',async()=>{
  const f=await fixture();try{const plan=f.create(),occurrence=f.store.issue(plan.id,base)!,runId=randomUUID();f.store.acknowledge(occurrence.id,runId,base);
    f.store.runEvent({id:randomUUID(),occurrenceId:occurrence.id,runId,state:'running',at:iso(base),unknownEffects:false});
    f.store.runEvent({id:randomUUID(),occurrenceId:occurrence.id,runId,state:'failed',at:iso(base+1000),unknownEffects:false});
    assert.equal(f.store.get(plan.id).failures,1);assert.equal(f.store.issue(plan.id,base+60000),null);
    const next=f.store.issue(plan.id,base+61000)!;assert.ok(next);const resumedId=randomUUID();f.store.acknowledge(next.id,resumedId,base+61000);
    f.store.runEvent({id:randomUUID(),occurrenceId:next.id,runId:resumedId,state:'running',at:iso(base+61000),unknownEffects:false});
    f.store.runEvent({id:randomUUID(),occurrenceId:next.id,runId:resumedId,state:'waiting',at:iso(base+62000),unknownEffects:false});
    f.store.update(plan.id,f.scope,{requestId:'replace-paused',expectedVersion:1,trigger:{kind:'once',at:iso(base+120000)}},base+62000);
    f.store.runEvent({id:randomUUID(),occurrenceId:next.id,runId:resumedId,state:'cancelled',at:iso(base+63000),unknownEffects:false});
    assert.equal(f.store.used(base),2000);assert.equal(f.store.occurrence(next.id).state,'cancelled');assert.equal(f.store.get(plan.id).status,'active');
  }finally{f.close();}
});
