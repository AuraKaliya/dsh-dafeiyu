import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {MemoryStore,MEMORY_SCHEMA_VERSION} from '@dafeiyu/memory/store';
import type {PersonaAccess,SourceDependency,ExecutionScope} from '@dafeiyu/contracts';
import {testTempDir} from './test-temp.js';
import {qqCapabilityFixture,outcomes} from './qq-capabilities-fixture.js';
import {call,textReply} from './harness.js';

const scope=(route:string):ExecutionScope=>({kind:'conversation',agentId:'fixture',route});
const access=(route='a'):PersonaAccess=>({view:{scope:scope(route),runId:randomUUID(),taskId:null,origin:{kind:'message',inboundId:randomUUID(),conversation:{channel:'fixture',account:'local',kind:'group',id:route}},signal:new AbortController().signal},producer:'fixture',operationId:randomUUID(),startedEventId:null,intentVersion:0,motivation:{kind:'unknown',basis:[]},inputs:[],admittedSources:[],guard:()=>{}});
const sources:SourceDependency[]=[{kind:'inbound',agentId:'fixture',route:'a',id:'source',hash:'fixture',fence:'fixture'}];
const input=()=>({requestId:randomUUID(),expectedVersion:0,text:'我最近想了解海洋。',topics:['海洋'],motivation:'self-directed',status:'active',expiresAt:new Date(Date.now()+3600000).toISOString()});

test('recent attention is durable, scoped and never mutates the personality or task tables',async t=>{
  const root=await mkdtemp(join(testTempDir(),'recent-state-')),file=join(root,'memory.sqlite');let memory=new MemoryStore(file);t.after(()=>memory.close());
  const owner=access(),state=memory.recentStateStore(()=>true),args=input(),receipt=state.save(owner,args,sources);
  assert.deepEqual(state.save(owner,args,sources),receipt);assert.equal(receipt.personalityAdopted,false);
  assert.equal(state.prepare(scope('b'),'海洋',false,3000).length,0);assert.equal(state.prepare(scope('a'),'海洋',false,3000).length,1);
  assert.throws(()=>state.save(owner,{...args,text:'changed'},sources),/IDEMPOTENCY_CONFLICT/);
  memory.close();memory=new MemoryStore(file);assert.equal(memory.recentStateStore(()=>true).prepare(scope('a'),'海洋',false,3000).length,1);
  const db=new DatabaseSync(file,{readOnly:true});try{assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,MEMORY_SCHEMA_VERSION);assert.equal(db.prepare('SELECT count(*) AS n FROM persona_candidates').get()?.n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM task_workspaces').get()?.n,0);}finally{db.close();}
});
test('only the exact independently reviewed publication can cross scopes; edits and revocation retire it',async t=>{
  const root=await mkdtemp(join(testTempDir(),'recent-publication-')),memory=new MemoryStore(join(root,'memory.sqlite'));t.after(()=>memory.close());let current=true;
  const state=memory.recentStateStore(()=>current),owner=access(),saved=state.save(owner,{...input(),topics:['海洋','PRIVATE_TOPIC']},sources),publish={requestId:randomUUID(),id:saved.id,expectedVersion:1,view:'我最近对海洋有一些好奇。'},review={selfOnly:true,privateDetails:false,thirdPartyClaims:false} as const;
  assert.throws(()=>state.publish(owner,publish,review,false),/SCOPE_DENIED/);state.publish(owner,publish,review,true);
  const shared=state.prepare(scope('b'),'海洋',true,3000);assert.equal(shared.length,1);assert.ok(shared[0]?.text.includes(publish.view));assert.ok(!shared[0]?.text.includes('我最近想了解海洋'));
  assert.equal(state.prepare(scope('b'),'无关话题',true,3000).length,0);assert.throws(()=>state.read(access('b'),saved.id),/SCOPE_DENIED/);
  assert.equal(state.prepare(scope('b'),'PRIVATE_TOPIC',true,3000).length,0);
  const published=state.published(scope('b'))[0]!;state.unpublish(access('b'),{requestId:'withdraw-view',publication:published.publication,expectedVersion:1},true);
  assert.equal(state.prepare(scope('b'),'海洋',true,3000).length,0);assert.equal(state.read(owner,saved.id).version,1);
  state.publish(owner,{...publish,requestId:'publish-again'},review,true);
  current=false;assert.equal(state.prepare(scope('b'),'海洋',true,3000).length,0);current=true;
  state.save(owner,{...input(),id:saved.id,expectedVersion:1,status:'dormant'},sources);assert.equal(state.prepare(scope('b'),'海洋',true,3000).length,0);
});
test('runtime tool retains recent self report without adopting it and rejects an unfaithful sharing review',async t=>{
  const h=await qqCapabilityFixture({context:{assembly:{mode:'unified',recentState:{shared:true}}},extraConversationActions:['dafeiyu_recent_state_save','dafeiyu_recent_state_status','dafeiyu_recent_state_publish']});t.after(h.close);
  let step=0,savedId='';h.setResponse(request=>{if(String(request.sessionId).startsWith('recent-state-review-'))return textReply(JSON.stringify({selfOnly:false,privateDetails:true,thirdPartyClaims:true}));
    if(++step===1)return call('dafeiyu_recent_state_save',input());
    if(step===2){const result=outcomes(request).find(outcome=>outcome.status==='succeeded');assert.ok(result);savedId=z.object({id:z.string()}).parse(result.data).id;assert.match(JSON.stringify(request.messages),/recent-self-state/);return call('dafeiyu_recent_state_publish',{requestId:'publish',id:savedId,expectedVersion:1,view:'他人的私人事实不应跨会话。'});}
    assert.ok(outcomes(request).some(outcome=>outcome.errorCode==='PRIVATE_INPUT_REJECTED'));return textReply('fixture');
  });await h.message('说说最近对海洋的关注',{trigger:true});assert.ok(savedId);assert.ok(h.adapter.requests.some(request=>String(request.sessionId).startsWith('recent-state-review-')));
});

test('schema twelve migration retains existing memory bytes and begins with no invented attention',async t=>{
  const root=await mkdtemp(join(testTempDir(),'recent-upgrade-')),file=join(root,'memory.sqlite');let memory=new MemoryStore(file);t.after(()=>memory.close());
  const operation={agentId:'fixture',route:'a',traceId:randomUUID(),operationId:randomUUID(),startedEventId:randomUUID()};
  const receipt=memory.mutate(operation,{action:'create',requestId:'seed',value:{kind:'knowledge',claimType:'reported_claim',content:'PRESERVE_ORIGINAL_MEMORY',sources:[{kind:'timeline',ref:'fixture:source',contentHash:'a'.repeat(64)}]}});
  const before=memory.read(operation,receipt.id);memory.close();
  const db=new DatabaseSync(file);try{db.exec('DROP TABLE recent_state_publications; DROP TABLE recent_state_requests; DROP TABLE recent_state_revisions; DROP TABLE recent_self_states; DELETE FROM memory_schema_migrations WHERE version=13; PRAGMA user_version=12;');}finally{db.close();}
  memory=new MemoryStore(file);assert.deepEqual(memory.read(operation,receipt.id),before);assert.deepEqual(memory.recentStateStore(()=>true).list(scope('a')),[]);
});
