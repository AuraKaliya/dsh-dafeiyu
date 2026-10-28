import {z} from 'zod';
import {fixtureAction} from './fixture-action.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { API_VERSION,conversationKey } from '@dafeiyu/contracts';
import type { ExtensionHandle,ConversationAccess } from '@dafeiyu/contracts';
import { observationFixture,observationReport,observationConversation } from './observation-fixture.js';
import { call,textReply } from './harness.js';

test('a producer submits original, exact Unicode fragment and summary with full declared exposure and no model turn',async t=>{
  const h=await observationFixture();t.after(h.close);
  const body='甲🙂乙丙。仅作虚构测试。',input=observationReport({sources:[{key:'source-a',occurredAt:'2026-10-19T10:00:00.000Z',archive:{kind:'text',text:body}}],
    contributions:[{id:'original',form:'original',source:'source-a',exposure:['source-a']},{id:'fragment',form:'fragment',source:'source-a',start:1,end:3,text:'🙂乙',exposure:['source-a']},
      {id:'summary',form:'summary',text:'插件筛选的摘要，仍需核实。',exposure:['source-a']}]});
  const result=h.handle.observeMemory(input);assert.equal(result.contributions.length,3);assert.equal(h.adapter.requests.length,0);assert.equal(h.simulator.deliveries.length,0);
  const items=result.contributions.map(c=>h.store.read(h.scope,c.memoryId)!);assert.deepEqual(items.map(i=>i.content),[body,'🙂乙','插件筛选的摘要，仍需核实。']);
  assert.equal(items[2]!.claimType,'inference');assert.ok(items.every(i=>i.analysisStatus==='not_analyzed'&&i.sources[0]!.kind==='observation'));
  assert.equal(items[0]!.boundary.sourceScene.kind,'conversation');assert.ok(items.every(i=>i.observation));
  const events=h.core.journal.events(h.scope.route);assert.deepEqual(events.map(e=>e.type),['observation.recorded','memory.created','memory.created','memory.created']);
  assert.ok(events.slice(1).every(e=>e.causedBy===result.eventId));assert.equal(events[0]!.plugin,'fictional-observer');assert.ok(!JSON.stringify(events).includes(body));
});
test('uninteresting and failed activities can contain no contribution and do not create memory or archive full messages',async t=>{
  const h=await observationFixture();t.after(h.close);const db=new DatabaseSync(join(h.root,'memory.sqlite'));t.after(()=>db.close());
  for(const outcome of ['completed','failed'] as const){const receipt=h.handle.observeMemory(observationReport({outcome,sources:[],contributions:[],counts:{received:100,processed:100,modelExposed:100},selection:{policyId:'fictional-interest',policyVersion:'2',reasonCode:'nothing-selected'}}));assert.equal(receipt.contributions.length,0);}
  assert.equal(db.prepare('SELECT count(*) AS n FROM observation_activities').get()?.n,2);assert.equal(db.prepare('SELECT count(*) AS n FROM observation_sources').get()?.n,0);
  assert.equal([...h.store.current(h.scope)].length,0);assert.equal(h.adapter.requests.length,0);
});
test('digest-only observations retain summary and batch proof without claiming the original is recoverable',async t=>{
  const h=await observationFixture();t.after(h.close);const ignored='UNRETAINED_RAW_SENTINEL';
  const receipt=h.handle.observeMemory(observationReport({counts:{received:100,processed:100,modelExposed:100},exposedSources:['batch'],sources:[{key:'batch',occurredAt:'2026-10-19T10:00:00.000Z',archive:{kind:'digest',hash:createHash('sha256').update(ignored).digest('hex')}}],
    contributions:[{id:'summary',form:'summary',text:'本次批量观察没有新的确定结论。',exposure:['batch']}]}));
  assert.equal(h.handle.openObservationSource({conversation:observationConversation,ref:receipt.sources[0]!.ref}).status,'digest_only');
  const db=new DatabaseSync(join(h.root,'memory.sqlite'));t.after(()=>db.close());assert.ok(!JSON.stringify(db.prepare('SELECT body FROM observation_sources').all()).includes(ignored));
  assert.equal(h.store.read(h.scope,receipt.contributions[0]!.memoryId)!.sources[0]!.kind,'observation');
});
test('shared model exposure cannot be omitted from a contribution or replaced by just its selected citation',async t=>{
  const h=await observationFixture();t.after(h.close);const a=observationReport().sources[0]!;
  const input=observationReport({counts:{received:2,processed:2,modelExposed:2},sources:[a,{...a,key:'source-b'}],exposedSources:['source-a','source-b']});
  assert.throws(()=>h.handle.observeMemory(input));assert.equal(h.core.journal.events(h.scope.route).length,0);
  input.contributions=[{id:'summary',form:'summary',text:'虽然只说A，实际读过A与B。',exposure:['source-a','source-b']}];
  const receipt=h.handle.observeMemory(input),item=h.store.read(h.scope,receipt.contributions[0]!.memoryId)!;assert.equal(item.sources.length,2);
});
test('scope, channel ownership, actor fields, invalid times and mismatched fragments are rejected without partial writes',async t=>{
  const h=await observationFixture();t.after(h.close);const base=observationReport();
  for(const invalid of [{...base,pluginId:'other'},{...base,owner:'other'},{...base,taskId:'forged'},{...base,conversation:{...base.conversation,account:'other'}},
    {...base,finishedAt:'2026-10-20T09:00:00.000Z'},{...base,contributions:[{id:'bad',form:'fragment',source:'source-a',start:0,end:2,text:'伪造',exposure:['source-a']}]}])assert.throws(()=>h.handle.observeMemory(invalid));
  const db=new DatabaseSync(join(h.root,'memory.sqlite'));t.after(()=>db.close());for(const table of ['observation_sources','observation_activities','observation_contributions','memory_items','memory_events'])assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,0);
});
test('source privacy restricts contributions, archives and mixed summaries; consumers cannot widen it',async t=>{
  const h=await observationFixture();t.after(h.close);const base=observationReport(),a={...base.sources[0]!,policy:{externalExpression:'none' as const}};
  const receipt=h.handle.observeMemory({...base,sources:[a]});const id=receipt.contributions[0]!.memoryId;
  assert.equal(h.store.read(h.scope,id),null);assert.ok(h.store.read(h.scope,id,'normal',undefined,'internal'));
  assert.equal(h.handle.openObservationSource({conversation:observationConversation,ref:receipt.sources[0]!.ref}).status,'not_found');
  assert.throws(()=>h.handle.observeMemory({...base,requestId:randomUUID(),sources:[a],contributions:[{...base.contributions[0]!,policy:{externalExpression:'conversation'}}]}),/scope_expansion/);
});
test('source deletion invalidates contributions and descendants; restore cannot revive captured old versions',async t=>{
  const h=await observationFixture();t.after(h.close);const receipt=h.handle.observeMemory(observationReport()),source=receipt.sources[0]!,id=receipt.contributions[0]!.memoryId,item=h.store.read(h.scope,id)!;
  const child=h.store.mutate(h.scope,{action:'create',requestId:'child',value:{kind:'knowledge',claimType:'inference',content:'派生资料',sources:[{kind:'memory',id,revision:item.revision,contentHash:item.contentHash}]}});
  h.handle.changeObservationSource({conversation:observationConversation,ref:source.ref,requestId:'delete',expectedVersion:1,action:'delete'});
  assert.equal(h.store.read(h.scope,id),null);assert.equal(h.store.read(h.scope,child.id),null);assert.ok(h.store.read(h.scope,id,'deleted'));
  assert.equal(h.handle.openObservationSource({conversation:observationConversation,ref:source.ref}).status,'not_found');
  assert.equal(h.handle.openObservationSource({conversation:observationConversation,ref:source.ref,mode:'deleted'}).status,'ok');
  h.handle.changeObservationSource({conversation:observationConversation,ref:source.ref,requestId:'restore',expectedVersion:2,action:'restore'});
  assert.equal(h.store.read(h.scope,id),null);assert.equal(h.store.read(h.scope,child.id),null);assert.equal(h.store.read(h.scope,id,'history')!.basisStatus,'changed');
});
test('deleting a contributed memory prevents re-extraction under a new activity and idempotent retries never recreate it',async t=>{
  const h=await observationFixture();t.after(h.close);const input=observationReport(),receipt=h.handle.observeMemory(input),id=receipt.contributions[0]!.memoryId;
  h.store.mutate(h.scope,{action:'delete',id,requestId:'delete-memory',expectedVersion:1,reason:'虚构遗忘'});
  assert.equal(h.handle.observeMemory(input).duplicate,true);assert.throws(()=>h.handle.observeMemory({...input,requestId:randomUUID(),contributions:[{id:'renamed',form:'summary',text:'试图换句话重新记住',exposure:['source-a']}]}),/source_unavailable/);
  assert.equal(h.store.read(h.scope,id),null);
});
test('same text from independent source identities remains usable when another source is deleted',async t=>{
  const h=await observationFixture();t.after(h.close);const input=observationReport();const first=h.handle.observeMemory(input);
  const second=h.handle.observeMemory({...input,requestId:randomUUID(),sources:[{...input.sources[0]!,key:'independent-b'}],contributions:[{id:'b',form:'original',source:'independent-b',exposure:['independent-b']}]});
  h.handle.changeObservationSource({conversation:observationConversation,ref:first.sources[0]!.ref,requestId:'delete-a',expectedVersion:1,action:'delete'});
  assert.ok(h.store.read(h.scope,second.contributions[0]!.memoryId));assert.equal(h.handle.openObservationSource({conversation:observationConversation,ref:second.sources[0]!.ref}).status,'ok');
});
test('restart and plugin upgrade preserve source identity, receipts, deletion and event order without replaying tools',async()=>{
  const h=await observationFixture(),input=observationReport(),receipt=h.handle.observeMemory(input),root=h.root;
  h.handle.changeObservationSource({conversation:observationConversation,ref:receipt.sources[0]!.ref,requestId:'delete',expectedVersion:1,action:'delete'});const eventIds=h.core.journal.events(h.scope.route).map(e=>e.id);await h.close();
  const next=await observationFixture(root,'fixture-v2');try{
    assert.equal(next.handle.observeMemory(input).activityId,receipt.activityId);assert.deepEqual(next.core.journal.events(next.scope.route).map(e=>e.id),eventIds);
    assert.equal(next.store.read(next.scope,receipt.contributions[0]!.memoryId),null);assert.equal(next.adapter.requests.length,0);
    next.handle.observeMemory({...input,requestId:randomUUID(),sources:input.sources.map(s=>({...s,expectedVersion:2})),contributions:[]});
    assert.equal(next.core.journal.events(next.scope.route).at(-1)!.pluginVersion,'fixture-v2');
    assert.equal(next.store.observations.source(next.scope,receipt.sources[0]!.ref,'internal')!.producerVersion,'fixture-v1');
  }finally{await next.close();}
});
test('scoped source lookup denies other conversations and state updates reject stale versions',async t=>{
  const h=await observationFixture();t.after(h.close);const receipt=h.handle.observeMemory(observationReport()),ref=receipt.sources[0]!.ref;
  assert.equal(h.handle.openObservationSource({conversation:{...observationConversation,id:'another-group'},ref}).status,'not_found');
  assert.throws(()=>h.handle.changeObservationSource({conversation:observationConversation,ref,requestId:'stale',expectedVersion:7,action:'delete'}),/version_conflict/);
  const changed=h.handle.changeObservationSource({conversation:observationConversation,ref,requestId:'same',expectedVersion:1,action:'delete'});
  assert.equal(h.handle.changeObservationSource({conversation:observationConversation,ref,requestId:'same',expectedVersion:1,action:'delete'}).duplicate,true);assert.equal(changed.version,2);
});
test('capability plugins without channels use only their own active core-issued action context',async t=>{
  const h=await observationFixture();t.after(h.close);let handle:ExtensionHandle,saved:ConversationAccess|undefined,observed=false,memoryId:string|undefined;
  handle=h.core.registerExtension({id:'fictional-explorer',version:'1',protocolVersion:4,agentId:'dafeiyu',actions:[fixtureAction(h.core,'fictional-explorer',{id:'fictional_explore',description:'虚构观察',inputSchema:z.strictObject({}),work:async(_args,context)=>{
    saved=context;const report=observationReport({conversation:context.conversation});const receipt=handle.observeMemory(report,context);observed=receipt.contributions.length===1;memoryId=receipt.contributions[0]!.memoryId;return {activityId:receipt.activityId};
  }})]});t.after(()=>handle.dispose());assert.throws(()=>handle.observeMemory(observationReport()),/owned channel/);
  let calls=0;h.setResponse(()=>++calls===1?call('fictional_explore',{}):textReply('虚构探索完成'));h.simulator.send('a','虚构探索',{id:randomUUID()});await h.core.whenIdle();assert.equal(observed,true);
  const events=h.core.journal.events(conversationKey('dafeiyu',saved!.conversation)),observedEvent=events.find(e=>e.type==='observation.recorded')!,parent=events.find(e=>e.id===observedEvent.causedBy)!;
  assert.equal(parent.type,'operation.started');assert.equal(parent.plugin,'fictional-explorer');assert.equal(observedEvent.traceId,parent.traceId);
  const memory=h.store.read({agentId:'dafeiyu',route:observedEvent.route},memoryId!)!;assert.equal(memory.boundary.sourceScene.kind,'conversation');
  if(memory.boundary.sourceScene.kind==='conversation')assert.equal(memory.boundary.sourceScene.ingressPluginId,'channel-simulator');
  assert.match(JSON.stringify(memory.observation),/fictional-explorer/);
  assert.throws(()=>handle.observeMemory(observationReport({conversation:saved!.conversation}),saved!),/active core-issued/);
  await h.probe('a',context=>{assert.throws(()=>handle.observeMemory(observationReport({conversation:context.conversation}),context),/does not belong/);return {checked:true};});
});
test('unloading producer or memory provider revokes the interface immediately',async t=>{
  const h=await observationFixture();t.after(h.close);await h.memoryFiber.dispose();assert.throws(()=>h.handle.observeMemory(observationReport()),/provider unavailable/);
  h.handle.dispose();assert.throws(()=>h.handle.observeMemory(observationReport()),/unregistered/);
});
test('archive text is redacted before hashing and paging; credentials cannot be hidden in metadata identifiers',async t=>{
  const h=await observationFixture();t.after(h.close);const input=observationReport();input.sources[0]!.archive={kind:'text',text:'token=fictional-sensitive-value\n正文'};
  const receipt=h.handle.observeMemory(input),opened=h.handle.openObservationSource({conversation:observationConversation,ref:receipt.sources[0]!.ref});
  assert.equal(opened.status,'ok');assert.ok(!JSON.stringify(opened).includes('fictional-sensitive-value'));assert.match(String(opened.text),/REDACTED/);
  assert.throws(()=>h.handle.observeMemory({...input,requestId:'token=hidden-secret'}));
});
test('activity, archive, all contributions and outbox roll back together on a durable write failure',async t=>{
  const h=await observationFixture();t.after(h.close);const db=new DatabaseSync(join(h.root,'memory.sqlite'));t.after(()=>db.close());
  db.exec("CREATE TRIGGER fail_observation_commit BEFORE INSERT ON memory_events WHEN json_extract(NEW.body,'$.type')='memory.created' BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END;");
  assert.throws(()=>h.handle.observeMemory(observationReport()),/storage failure/);
  for(const table of ['observation_sources','observation_activities','observation_contributions','memory_items','memory_revisions','memory_boundaries','memory_events','outbox'])assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,0);
  assert.equal(h.core.journal.events(h.scope.route).length,0);
});
test('publish-before-ack interruption replays the transactional outbox without duplicating activity or memory',async()=>{
  const h=await observationFixture(),root=h.root,input=observationReport(),publish=h.core.journal.appendOnce.bind(h.core.journal);let interrupted=false;
  h.core.journal.appendOnce=(event,id)=>{const result=publish(event,id);if(!interrupted){interrupted=true;throw new Error('fixture interruption');}return result;};
  const receipt=h.handle.observeMemory(input);assert.equal(receipt.auditPending,true);assert.equal(h.core.journal.events(h.scope.route).length,1);
  h.core.journal.appendOnce=publish;await h.close();const next=await observationFixture(root);
  try{const events=next.core.journal.events(next.scope.route);assert.equal(events.length,2);assert.equal(new Set(events.map(e=>e.id)).size,2);
    assert.equal(next.handle.observeMemory(input).activityId,receipt.activityId);assert.equal([...next.store.current(next.scope)].length,1);
  }finally{await next.close();}
});
test('arrival sequence remains monotonic even when later reports describe older observations',async t=>{
  const h=await observationFixture();t.after(h.close);const first=h.handle.observeMemory(observationReport({sources:[],contributions:[]}));
  const second=h.handle.observeMemory(observationReport({sources:[],contributions:[],startedAt:'2026-10-18T00:00:00Z',observedAt:'2026-10-18T00:00:01Z',finishedAt:'2026-10-18T00:00:02Z'}));
  assert.ok(second.sequence>first.sequence);const events=h.core.journal.events(h.scope.route);assert.ok(events[1]!.seq>events[0]!.seq);assert.ok(Date.parse(events[1]!.occurredAt)<Date.parse(events[0]!.occurredAt));
  assert.equal(events[1]!.data.observedAt,'2026-10-18T00:00:01Z');assert.ok(events[1]!.data.activityRecordedAt);
});
test('source identity cannot silently change body or ownership, and a summary cannot quote unretained originals',async t=>{
  const h=await observationFixture();t.after(h.close);const input=observationReport();h.handle.observeMemory(input);
  assert.throws(()=>h.handle.observeMemory({...input,requestId:randomUUID(),sources:[{...input.sources[0]!,archive:{kind:'text',text:'同一标识替换原文'}}]}),/identity conflict/);
  assert.throws(()=>h.handle.observeMemory({...input,requestId:randomUUID(),sources:[{...input.sources[0]!,key:'digest',archive:{kind:'digest',hash:'a'.repeat(64)}}],contributions:[{id:'bad',form:'original',source:'digest',exposure:['digest']}]}),/not retained/);
  assert.equal([...h.store.current(h.scope)].length,1);
});
test('source state changes retire already exposed answers and restored sources never reactivate those chat snapshots',async t=>{
  const h=await observationFixture();t.after(h.close);const receipt=h.handle.observeMemory(observationReport()),id=receipt.contributions[0]!.memoryId;
  const send=async(text:string)=>{h.handle.ingest({id:randomUUID(),conversation:observationConversation,occurredAt:new Date().toISOString(),sender:{id:'fictional-author',displayName:'虚构用户'},text});await h.core.whenIdle();};
  let steps=0;h.setResponse(()=>++steps===1?call('dafeiyu_memory_open',{id}):textReply('OBS_EXPOSED_ANSWER'));await send('读取观察');
  assert.ok(JSON.stringify(h.adapter.requests.at(-1)?.messages).includes('A_ORIGINAL'));
  h.handle.changeObservationSource({conversation:observationConversation,ref:receipt.sources[0]!.ref,requestId:'delete',expectedVersion:1,action:'delete'});
  h.setResponse(()=>textReply('继续有效任务'));await send('来源删除后');let visible=JSON.stringify(h.adapter.requests.at(-1)?.messages);assert.ok(!visible.includes('A_ORIGINAL'));assert.ok(!visible.includes('OBS_EXPOSED_ANSWER'));
  h.handle.changeObservationSource({conversation:observationConversation,ref:receipt.sources[0]!.ref,requestId:'restore',expectedVersion:2,action:'restore'});
  await send('来源恢复后');visible=JSON.stringify(h.adapter.requests.at(-1)?.messages);assert.ok(!visible.includes('A_ORIGINAL'));assert.ok(!visible.includes('OBS_EXPOSED_ANSWER'));
});
test('retention does not imply internal use or expression, but a producer can still logically delete its inaccessible archive',async t=>{
  const h=await observationFixture();t.after(h.close);const input=observationReport();input.sources[0]!.policy={internalUse:'none',externalExpression:'none'};input.contributions=[];
  const receipt=h.handle.observeMemory(input),ref=receipt.sources[0]!.ref;
  assert.equal(h.store.observations.source(h.scope,ref,'internal'),null);assert.equal(h.handle.openObservationSource({conversation:observationConversation,ref}).status,'not_found');
  assert.throws(()=>h.handle.observeMemory({...input,requestId:randomUUID(),contributions:[{id:'try-use',form:'original',source:'source-a',exposure:['source-a']}]}),/source_unavailable/);
  assert.equal(h.handle.changeObservationSource({conversation:observationConversation,ref,requestId:'privacy-delete',expectedVersion:1,action:'delete'}).version,2);
});
test('deleting an observed source during model generation blocks reply delivery',async t=>{
  const h=await observationFixture();t.after(h.close);const receipt=h.handle.observeMemory(observationReport());let calls=0;
  h.setResponse(()=>{
    if(++calls===1)return call('dafeiyu_memory_open',{id:receipt.contributions[0]!.memoryId});
    h.handle.changeObservationSource({conversation:observationConversation,ref:receipt.sources[0]!.ref,requestId:'during-generation',expectedVersion:1,action:'delete'});
    return textReply('MUST_NOT_DELIVER_DELETED_SOURCE');
  });
  const message=h.handle.ingest({id:randomUUID(),conversation:observationConversation,occurredAt:new Date().toISOString(),sender:{id:'fictional-author',displayName:'虚构用户'},text:'读取虚构记忆'});
  await h.core.whenIdle();assert.equal(h.core.journal.get(message.id).state,'failed');
});
test('a delayed observation cannot silently adopt a source version advanced by delete and restore',async t=>{
  const h=await observationFixture();t.after(h.close);const input=observationReport(),first=h.handle.observeMemory(input),ref=first.sources[0]!.ref;
  h.handle.changeObservationSource({conversation:observationConversation,ref,requestId:'delete-before-submit',expectedVersion:1,action:'delete'});
  h.handle.changeObservationSource({conversation:observationConversation,ref,requestId:'restore-before-submit',expectedVersion:2,action:'restore'});
  assert.throws(()=>h.handle.observeMemory({...input,requestId:randomUUID()}),/version_conflict/);
  const fresh=h.handle.observeMemory({...input,requestId:randomUUID(),sources:input.sources.map(s=>({...s,expectedVersion:3}))});
  assert.ok(h.store.read(h.scope,fresh.contributions[0]!.memoryId));assert.equal(h.store.read(h.scope,first.contributions[0]!.memoryId),null);
});
