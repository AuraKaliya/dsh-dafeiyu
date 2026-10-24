import { test } from 'node:test';
import { dropExecutionFixtureSchema } from './legacy-execution-fixture.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { z } from 'zod';
import { expressionFixture } from './expression-fixture.js';
import { taskMemoryFixture,scenes,currentVersion } from './task-memory-fixture.js';
import { textReply,call } from './harness.js';

test('target filtering admits local expressible evidence and hides private and unrelated sources',async t=>{
  const h=await expressionFixture();t.after(h.close);const packet=h.prepare(await h.question());
  assert.deepEqual(packet.decisions.map(d=>d.allowed),h.links.map(id=>id===h.linkFor(0)));
  const material=JSON.stringify(h.task.expression.open({packetId:packet.packetId,target:scenes[0]}));assert.match(material,/A_ONLY/);assert.ok(!material.includes('B_INTERNAL_ONLY'));assert.ok(!material.includes('C_DENIED'));
  assert.throws(()=>h.task.expression.open({packetId:packet.packetId,target:scenes[1]}),/packet_unavailable/);
  assert.throws(()=>h.task.expression.prepare({requestId:randomUUID(),inboundId:randomUUID(),linkIds:h.links}));
  assert.throws(()=>h.task.expression.prepare({requestId:randomUUID(),inboundId:randomUUID(),linkIds:h.links,prompt:'private override'}));
});

test('explicit version-pinned release permits a cross-scene source without altering stored boundaries',async t=>{
  const h=await expressionFixture();t.after(h.close);const before=h.store.read(h.scope(2),h.receipts[2]!.contributions[0]!.memoryId)!;h.policyExpression(2);
  const packet=h.prepare(await h.question(),h.links,[],{id:'release',version:1});const material=JSON.stringify(h.task.expression.open({packetId:packet.packetId,target:scenes[0]}));
  assert.match(material,/C_DENIED/);assert.ok(!material.includes('B_INTERNAL_ONLY'));assert.deepEqual(h.store.read(h.scope(2),before.id),before);
  assert.throws(()=>h.policyExpression(1,0,'private-release'),/expression_source_forbidden/);
  const inbound=await h.question();assert.throws(()=>h.prepare(inbound,h.links,[],{id:'release',version:2}),/policy_unavailable/);
});

test('mixed conclusions retain every actual job input even if the conclusion cites only the public source',async t=>{
  const h=await expressionFixture();t.after(h.close);const handle=h.handles[0]!,conversation=scenes[0]!;
  handle.tasks.join(h.task.reference,{requestId:randomUUID(),conversation});handle.tasks.activate(h.task.reference,{requestId:randomUUID(),conversation,expectedVersion:0});
  const work=handle.tasks.begin(h.task.reference,{requestId:randomUUID(),conversation,slot:'mixed',expectedSlotVersion:0,inputs:[h.linkFor(0),h.linkFor(1)]});
  handle.tasks.complete(work,{requestId:randomUUID(),text:'PRIVATE_CONCLUSION_WITH_ONLY_A_CITATION'});
  const safe=handle.tasks.begin(h.task.reference,{requestId:randomUUID(),conversation,slot:'safe',expectedSlotVersion:0,inputs:[h.linkFor(0)]});handle.tasks.complete(safe,{requestId:randomUUID(),text:'SAFE_PRIOR_CONCLUSION'});
  const packet=h.prepare(await h.question(),h.links,['mixed','safe']);assert.equal(packet.decisions.find(d=>d.id==='mixed')!.allowed,false);assert.equal(packet.decisions.find(d=>d.id==='safe')!.allowed,true);
  const material=JSON.stringify(h.task.expression.open({packetId:packet.packetId,target:conversation}));assert.ok(!material.includes('PRIVATE_CONCLUSION'));assert.match(material,/SAFE_PRIOR_CONCLUSION/);
  await h.task.expression.generate({requestId:randomUUID(),packetId:packet.packetId,target:conversation});
  const prompts=h.adapter.requests.filter(r=>String(r.sessionId).startsWith('memory-expression-'));assert.ok(prompts.every(r=>!JSON.stringify(r.messages).includes('SAFE_PRIOR_CONCLUSION')));
});

test('clean regeneration inherits only the target question and allowed evidence, not task goals, history, native context or hidden conclusions',async t=>{
  const h=await expressionFixture();t.after(h.close);h.ctx.systemPrompt.context({name:'private-native',order:1,required:true,text:'NATIVE_PRIVATE_SENTINEL'});
  h.task.update({requestId:randomUUID(),expectedVersion:currentVersion(h.task),goal:'PRIVATE_GOAL_SENTINEL'});
  // Goal replacement revokes the original D1 grant; get fresh selected evidence explicitly.
  const access=h.grant(h.task,[0,1,2],`policy-${h.task.reference.id}`),hits=z.object({items:z.array(z.object({hitId:z.string()}))}).parse(await access.recall({query:'雨',limit:10}));
  const links=z.object({links:z.array(z.string())}).parse(access.select({requestId:randomUUID(),expectedVersion:currentVersion(h.task),hitIds:hits.items.map(i=>i.hitId)})).links;
  await h.question(0,'OLD_CHAT_PRIVATE_SENTINEL');const inbound=await h.question(),packet=h.prepare(inbound,links);const before=h.adapter.requests.length;
  const answer=h.task.expression.generate({requestId:randomUUID(),packetId:packet.packetId,target:scenes[0]});const result=await answer;
  assert.equal(result.sendAuthorized,false);const requests=h.adapter.requests.slice(before);assert.equal(requests.length,2);assert.notEqual(requests[0]!.sessionId,requests[1]!.sessionId);
  const prompts=JSON.stringify(requests.map(r=>r.messages));assert.match(prompts,/下雨出行需要准备什么/);assert.match(prompts,/A_ONLY/);
  for(const forbidden of ['B_INTERNAL_ONLY','C_DENIED','PRIVATE_GOAL_SENTINEL','OLD_CHAT_PRIVATE_SENTINEL','NATIVE_PRIVATE_SENTINEL'])assert.ok(!prompts.includes(forbidden),forbidden);
  await h.question(0,'普通聊天继续');const ordinary=JSON.stringify(h.adapter.requests.at(-1)!.messages);assert.ok(!ordinary.includes('B_INTERNAL_ONLY'));assert.ok(!ordinary.includes('依据虚构资料，下雨出行应携带雨伞'));
});

test('a target without allowed evidence cannot fall back to a private task snapshot',async t=>{
  const h=await expressionFixture();t.after(h.close);const packet=h.prepare(await h.question(1));const calls=h.adapter.requests.length;
  await assert.rejects(h.task.expression.generate({requestId:randomUUID(),packetId:packet.packetId,target:scenes[1]}),/insufficient_evidence/);assert.equal(h.adapter.requests.length,calls);
});

test('output citations cannot reduce the captured exposure dependency set',async t=>{
  const h=await expressionFixture();t.after(h.close);h.policyExpression(2);const packet=h.prepare(await h.question(),h.links,[],{id:'release',version:1});
  const result=await h.task.expression.generate({requestId:randomUUID(),packetId:packet.packetId,target:scenes[0]});
  const db=new DatabaseSync(join(h.root,'memory.sqlite'));t.after(()=>db.close());const body=JSON.parse(String(db.prepare('SELECT body FROM expression_jobs WHERE id=?').get(String(result.jobId))?.body));
  assert.equal(body.citations.length,1);assert.equal(body.exposure.length,2);
  h.handles[2]!.changeObservationSource({conversation:scenes[2]!,ref:h.receipts[2]!.sources[0]!.ref,requestId:'delete-uncited',expectedVersion:1,action:'delete'});
  assert.throws(()=>h.task.expression.result({jobId:result.jobId,target:scenes[0]}),/source_unavailable/);
});

for(const change of ['grant','policy','delete','withdraw','goal'] as const)test(`${change} during generation prevents approval and leaves no answer body`,async t=>{
  const h=await expressionFixture();t.after(h.close);if(change==='policy')h.policyExpression(2);
  const packet=h.prepare(await h.question(),h.links,[],change==='policy'?{id:'release',version:1}:undefined);
  h.setExpressionResponse(()=>{
    if(change==='grant')h.task.memory.revoke({requestId:randomUUID(),id:h.access.id,expectedVersion:1});
    if(change==='policy')h.policyExpression(2,0,'release',1,false);
    if(change==='delete')h.handles[0]!.changeObservationSource({conversation:scenes[0]!,ref:h.receipts[0]!.sources[0]!.ref,requestId:'delete',expectedVersion:1,action:'delete'});
    if(change==='withdraw')h.task.expression.withdraw({requestId:randomUUID(),packetId:packet.packetId,expectedVersion:1});
    if(change==='goal')h.task.update({requestId:randomUUID(),expectedVersion:currentVersion(h.task),goal:'更正任务'});
    return textReply(JSON.stringify({answer:'STALE_ANSWER',citations:['S1'],insufficient:false}));
  });
  await assert.rejects(h.task.expression.generate({requestId:randomUUID(),packetId:packet.packetId,target:scenes[0]}));
  const db=new DatabaseSync(join(h.root,'memory.sqlite'));t.after(()=>db.close());assert.ok(db.prepare('SELECT status,body FROM expression_jobs').all().every(r=>r.status==='failed'&&r.body===null));
});

test('deletion and restoration never reactivate a material or answer, while an unrelated task stays usable',async t=>{
  const h=await expressionFixture();t.after(h.close);const packet=h.prepare(await h.question());const result=await h.task.expression.generate({requestId:randomUUID(),packetId:packet.packetId,target:scenes[0]});
  h.handles[0]!.changeObservationSource({conversation:scenes[0]!,ref:h.receipts[0]!.sources[0]!.ref,requestId:'delete',expectedVersion:1,action:'delete'});
  h.handles[0]!.changeObservationSource({conversation:scenes[0]!,ref:h.receipts[0]!.sources[0]!.ref,requestId:'restore',expectedVersion:2,action:'restore'});
  assert.throws(()=>h.task.expression.open({packetId:packet.packetId,target:scenes[0]}));assert.throws(()=>h.task.expression.result({jobId:result.jobId,target:scenes[0]}));
  const independent=h.prepare(await h.question(2),[h.linkFor(2)]);assert.match(JSON.stringify(h.task.expression.open({packetId:independent.packetId,target:scenes[2]})),/C_DENIED/);
});

test('model tools, invalid citations, malformed output and failed independent verification are rejected',async t=>{
  const h=await expressionFixture();t.after(h.close);const packet=h.prepare(await h.question());
  for(const response of [()=>call('exfiltrate',{}),()=>textReply('not-json'),()=>textReply(JSON.stringify({answer:'bad',citations:['S99'],insufficient:false})),
    (request:{sessionId?:unknown})=>textReply(JSON.stringify(String(request.sessionId).includes('verify')?{faithful:false,issues:['丢失条件']}:{answer:'不带雨伞',citations:['S1'],insufficient:false}))]){
    h.setExpressionResponse(response);await assert.rejects(h.task.expression.generate({requestId:randomUUID(),packetId:packet.packetId,target:scenes[0]}));
  }
});

test('completed generation retries return the same job without additional model calls; changed input conflicts',async t=>{
  const h=await expressionFixture();t.after(h.close);const packet=h.prepare(await h.question()),input={requestId:'one-job',packetId:packet.packetId,target:scenes[0]};
  const a=await h.task.expression.generate(input),calls=h.adapter.requests.length,b=await h.task.expression.generate(input);assert.deepEqual(a,b);assert.equal(h.adapter.requests.length,calls);
  const next=h.prepare(await h.question());await assert.rejects(h.task.expression.generate({...input,packetId:next.packetId}),/idempotency_conflict/);
  await assert.rejects(h.task.expression.generate({...input,prompt:'PRIVATE_PROMPT'}));
});

test('restart preserves approved materials and result validation without rerunning the model',async()=>{
  const h=await expressionFixture(),root=h.root,packet=h.prepare(await h.question()),taskId=h.task.reference.id,result=await h.task.expression.generate({requestId:randomUUID(),packetId:packet.packetId,target:scenes[0]});await h.close();
  const next=await taskMemoryFixture(root);try{const task=next.core.resumeTaskWorkspace(taskId);assert.deepEqual(task.expression.result({jobId:result.jobId,target:scenes[0]}),result);assert.equal(next.adapter.requests.length,0);
    task.expression.withdraw({requestId:randomUUID(),packetId:packet.packetId,expectedVersion:1});assert.throws(()=>task.expression.result({jobId:result.jobId,target:scenes[0]}));
  }finally{await next.close();}
});

test('deleting and restoring the real target question invalidates its old packet through the source fence',async t=>{
  const h=await expressionFixture();t.after(h.close);const packet=h.prepare(await h.question()),db=new DatabaseSync(join(h.root,'memory.sqlite'));t.after(()=>db.close());
  const question=z.object({question:z.object({text:z.string(),ref:z.string(),hash:z.string(),route:z.string()})}).parse(JSON.parse(String(db.prepare('SELECT body FROM expression_packets WHERE id=?').get(packet.packetId)?.body))).question;
  const scope={agentId:'dafeiyu',route:question.route,traceId:randomUUID(),operationId:randomUUID(),startedEventId:randomUUID()};
  const record=h.store.mutate(scope,{action:'create',requestId:randomUUID(),value:{kind:'experience',claimType:'self_report',content:question.text,sources:[{kind:'timeline',ref:question.ref,contentHash:question.hash}]}});
  h.store.mutate(scope,{action:'delete',requestId:randomUUID(),id:record.id,expectedVersion:1,reason:'删除虚构问题'});assert.throws(()=>h.task.expression.open({packetId:packet.packetId,target:scenes[0]}),/question_unavailable/);
  h.store.mutate(scope,{action:'restore',requestId:randomUUID(),id:record.id,expectedVersion:2,reason:'恢复虚构问题'});assert.throws(()=>h.task.expression.open({packetId:packet.packetId,target:scenes[0]}),/question_changed/);
});

test('expression narrowing and record revisions invalidate pinned releases and materials',async t=>{
  const h=await expressionFixture();t.after(h.close);h.policyExpression(2);const packet=h.prepare(await h.question(),h.links,[],{id:'release',version:1});
  const memory=h.store.read(h.scope(2),h.receipts[2]!.contributions[0]!.memoryId)!,scope={...h.scope(2),traceId:randomUUID(),operationId:randomUUID(),startedEventId:randomUUID()};
  h.store.mutate(scope,{action:'revise',requestId:randomUUID(),id:memory.id,expectedVersion:memory.version,value:{kind:memory.kind,claimType:memory.claimType,content:memory.content,sources:memory.sources},boundaryPolicy:{externalExpression:'none'}});
  assert.throws(()=>h.task.expression.open({packetId:packet.packetId,target:scenes[0]}),/source_unavailable/);
  // Disabling an obsolete rule must remain possible after its source disappears.
  const result=h.core.setTaskExpressionPolicy({requestId:randomUUID(),id:'release',expectedVersion:1,enabled:false,target:scenes[0],sources:[{conversation:scenes[2],id:memory.id,revision:memory.revision,version:memory.version,contentHash:memory.contentHash}],reason:'撤销失效发布规则'});assert.equal(result.version,2);
});

test('transactional preparation and approved output roll back if audit persistence fails',async t=>{
  const h=await expressionFixture();t.after(h.close);const inbound=await h.question(),db=new DatabaseSync(join(h.root,'memory.sqlite'));t.after(()=>db.close());
  db.exec("CREATE TRIGGER fail_expression BEFORE INSERT ON memory_events WHEN json_extract(NEW.body,'$.type')='task.expression.prepared' BEGIN SELECT RAISE(ABORT,'fixture expression failure'); END;");
  assert.throws(()=>h.prepare(inbound),/fixture expression failure/);assert.equal(db.prepare('SELECT count(*) AS n FROM expression_packets').get()?.n,0);db.exec('DROP TRIGGER fail_expression');
  const packet=h.prepare(inbound);db.exec("CREATE TRIGGER fail_expression BEFORE INSERT ON memory_events WHEN json_extract(NEW.body,'$.type')='task.expression.completed' BEGIN SELECT RAISE(ABORT,'fixture expression failure'); END;");
  await assert.rejects(h.task.expression.generate({requestId:randomUUID(),packetId:packet.packetId,target:scenes[0]}),/fixture expression failure/);
  assert.ok(db.prepare('SELECT body,status FROM expression_jobs').all().every(r=>r.body===null&&r.status==='failed'));
});

test('simultaneous regeneration cannot run twice for the same request; independent packets remain separate',async t=>{
  const h=await expressionFixture();t.after(h.close);const a=h.prepare(await h.question()),b=h.prepare(await h.question(2),[h.linkFor(2)]);
  let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});h.setExpressionResponse(async request=>{if(String(request.sessionId).includes('generate'))await wait;return textReply(JSON.stringify(String(request.sessionId).includes('verify')?{faithful:true,issues:[]}:{answer:'独立虚构回答',citations:['S1'],insufficient:false}));});
  const input={requestId:'parallel',packetId:a.packetId,target:scenes[0]},first=h.task.expression.generate(input);await assert.rejects(h.task.expression.generate(input),/job_not_completed/);
  const second=h.task.expression.generate({requestId:'other',packetId:b.packetId,target:scenes[2]});release();const [ra,rb]=await Promise.all([first,second]);assert.notEqual(ra.jobId,rb.jobId);
  h.task.expression.withdraw({requestId:randomUUID(),packetId:a.packetId,expectedVersion:1});assert.throws(()=>h.task.expression.result({jobId:ra.jobId,target:scenes[0]}));assert.equal(h.task.expression.result({jobId:rb.jobId,target:scenes[2]}).answer,'独立虚构回答');
});

test('expiry, cancellation and provider unload never expose a usable stale result',async t=>{
  const h=await expressionFixture();t.after(h.close);const packet=h.prepare(await h.question());
  await assert.rejects(h.task.expression.generate({requestId:randomUUID(),packetId:packet.packetId,target:scenes[0]},AbortSignal.abort()));
  const now=Date.now;try{Date.now=()=>now()+1000000;assert.throws(()=>h.task.expression.open({packetId:packet.packetId,target:scenes[0]}),/packet_unavailable/);}finally{Date.now=now;}
  await h.memoryFiber.dispose();assert.throws(()=>h.task.expression.open({packetId:packet.packetId,target:scenes[0]}),/provider unavailable/);
});

test('schema v5 migration leaves old boundaries intact and startup interrupts orphan jobs without a model call',async()=>{
  const h=await expressionFixture(),root=h.root,taskId=h.task.reference.id,original=h.store.read(h.scope(0),h.receipts[0]!.contributions[0]!.memoryId)!;await h.close();
  const db=new DatabaseSync(join(root,'memory.sqlite'));try{dropExecutionFixtureSchema(db);for(const table of ['expression_jobs','expression_packets','expression_requests','expression_policies','expression_policy_revisions'])db.exec(`DROP TABLE ${table}`);db.exec('PRAGMA user_version=5');}finally{db.close();}
  const next=await taskMemoryFixture(root);try{assert.deepEqual(next.store.read(next.scope(0),original.id),original);const task=next.core.resumeTaskWorkspace(taskId);
    const handle=next.handles[0]!,receipt=handle.ingest({id:randomUUID(),conversation:scenes[0]!,occurredAt:new Date().toISOString(),sender:{id:'fictional',displayName:'虚构'},text:'继续'});await next.core.whenIdle();
    const packet=z.object({packetId:z.string()}).parse(task.expression.prepare({requestId:randomUUID(),inboundId:receipt.id,linkIds:[]}));
    const db=new DatabaseSync(join(root,'memory.sqlite'));try{db.prepare("INSERT INTO expression_jobs VALUES(?,?,?,?,?,?,'running',NULL)").run(randomUUID(),'dafeiyu',taskId,'orphan','fixture',packet.packetId);}finally{db.close();}
  }finally{await next.close();}
  const restored=await taskMemoryFixture(root);try{const db=new DatabaseSync(join(root,'memory.sqlite'));try{assert.equal(db.prepare("SELECT status FROM expression_jobs WHERE request_id='orphan'").get()?.status,'interrupted');assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,8);}finally{db.close();}assert.equal(restored.adapter.requests.length,0);}finally{await restored.close();}
});

test('provider unload during an active model request drains cancellation before closing persistence',async t=>{
  const h=await expressionFixture();t.after(h.close);const packet=h.prepare(await h.question());let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),waiting=new Promise<void>(resolve=>{release=resolve;});
  h.setExpressionResponse(async()=>{entered();await waiting;return textReply(JSON.stringify({answer:'MUST_NOT_COMMIT',citations:['S1'],insufficient:false}));});
  const result=h.task.expression.generate({requestId:randomUUID(),packetId:packet.packetId,target:scenes[0]});const rejected=assert.rejects(result);await started;
  const disposal=h.memoryFiber.dispose();release();await rejected;await disposal;
  const db=new DatabaseSync(join(h.root,'memory.sqlite'));t.after(()=>db.close());assert.ok(db.prepare('SELECT status,body FROM expression_jobs').all().every(r=>r.status==='failed'&&r.body===null));
});
