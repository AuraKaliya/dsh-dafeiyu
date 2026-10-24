import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { deliveryFixture } from './delivery-fixture.js';
import { expressionFixture } from './expression-fixture.js';
import { taskMemoryFixture,scenes } from './task-memory-fixture.js';
import { textReply,call } from './harness.js';
import { API_VERSION } from '@dafeiyu/contracts';
import { SessionId } from '@deepseek-ai/dsh-session';

test('D3 formats in the real target DSH persona session, binds a credential, and sends the final wording once',async t=>{
  const h=await deliveryFixture();t.after(h.close);const ready=await h.ready(),before=h.adapter.requests.length,original=h.core.journal.get(ready.inboundId);
  const result=await h.task.delivery.submit(ready.input);assert.equal(result.status,'sent');assert.equal(h.attempts.length,1);assert.equal(h.sent.length,1);
  assert.equal(h.sent[0]!.text,'PERSONA_FINAL：下雨出门记得带伞。');assert.notEqual(h.sent[0]!.text,ready.draft);assert.deepEqual(h.sent[0]!.conversation,scenes[0]);assert.equal(h.sent[0]!.sourceMessageId,original.message.id);
  const persona=h.adapter.requests.slice(before).find(r=>r.sessionId===original.sessionId)!;assert.ok(persona);assert.match(JSON.stringify(persona.messages),/dafeiyu-persona|大肥鱼/);assert.match(JSON.stringify(persona.messages),/task-delivery/);
  assert.ok(!JSON.stringify(persona.messages).includes('B_INTERNAL_ONLY'));assert.ok(!JSON.stringify(persona.messages).includes('C_DENIED'));
  const db=new DatabaseSync(join(h.root,'delivery.sqlite'));t.after(()=>db.close());const row=db.prepare('SELECT credential,reply,state FROM deliveries').get()!;const token=JSON.parse(String(row.credential));assert.equal(token.jobId,ready.jobId);assert.equal(token.inboundId,ready.inboundId);assert.equal(row.state,'sent');assert.ok(token.bodyHash);
});

test('duplicate submissions with the same or a new request ID never regenerate or resend the same job',async t=>{
  const h=await deliveryFixture();t.after(h.close);const ready=await h.ready(),first=await h.task.delivery.submit(ready.input),calls=h.adapter.requests.length;
  assert.deepEqual(await h.task.delivery.submit(ready.input),first);assert.deepEqual(await h.task.delivery.submit({...ready.input,requestId:randomUUID()}),first);assert.equal(h.adapter.requests.length,calls);assert.equal(h.attempts.length,1);
  await assert.rejects(h.task.delivery.submit({...ready.input,jobId:randomUUID()}),/idempotency_conflict/);
});

for(const change of ['revoke','delete','withdraw','task-switch','new-message'] as const)test(`${change} during persona generation prevents transport`,async t=>{
  const h=await deliveryFixture();t.after(h.close);const ready=await h.ready();let changed=false;
  h.setResponse(()=>{if(!changed){changed=true;
    if(change==='revoke')h.task.memory.revoke({requestId:randomUUID(),id:h.access.id,expectedVersion:1});
    if(change==='delete')h.handles[0]!.changeObservationSource({conversation:scenes[0]!,ref:h.receipts[0]!.sources[0]!.ref,requestId:'delete',expectedVersion:1,action:'delete'});
    if(change==='withdraw')h.task.expression.withdraw({requestId:randomUUID(),packetId:ready.packetId,expectedVersion:1});
    if(change==='task-switch')h.handles[0]!.tasks.activate(null,{requestId:randomUUID(),conversation:scenes[0],expectedVersion:1});
    if(change==='new-message')h.handles[0]!.ingest({id:randomUUID(),conversation:scenes[0]!,occurredAt:new Date().toISOString(),sender:{id:'user-0',displayName:'虚构'},text:'改为新的问题'});
  }return textReply('STALE_PERSONA');});
  const result=await h.task.delivery.submit(ready.input);await h.core.whenIdle();assert.equal(result.status,'rejected');assert.equal(h.attempts.length,0);
});

test('revocation during final verification prevents sending',async t=>{
  const h=await deliveryFixture();t.after(h.close);const ready=await h.ready();h.setExpressionResponse(()=>{h.task.memory.revoke({requestId:randomUUID(),id:h.access.id,expectedVersion:1});return textReply(JSON.stringify({faithful:true,issues:[]}));});
  assert.equal((await h.task.delivery.submit(ready.input)).status,'rejected');assert.equal(h.attempts.length,0);
});

test('a false final verification result prevents transport despite successful persona generation',async t=>{
  const h=await deliveryFixture();t.after(h.close);const ready=await h.ready();h.setExpressionResponse(()=>textReply(JSON.stringify({faithful:false,issues:['新增了没有依据的事实']})));
  assert.equal((await h.task.delivery.submit(ready.input)).status,'rejected');assert.equal(h.attempts.length,0);
});

test('persistence failure before dispatch prevents transport; failure after acknowledgement records uncertainty',async()=>{
  for(const state of ['sending','sent']){const h=await deliveryFixture();try{const ready=await h.ready(),db=new DatabaseSync(join(h.root,'delivery.sqlite'));
    try{db.exec(`CREATE TRIGGER fail_delivery BEFORE UPDATE ON deliveries WHEN NEW.state='${state}' BEGIN SELECT RAISE(ABORT,'fixture delivery persistence'); END;`);
      const result=await h.task.delivery.submit(ready.input);assert.equal(result.status,state==='sending'?'rejected':'uncertain');assert.equal(h.attempts.length,state==='sending'?0:1);
      await h.task.delivery.submit(ready.input);assert.equal(h.attempts.length,state==='sending'?0:1);
    }finally{db.close();}
  }finally{await h.close();}}
});

test('a sent response without a usable receipt remains uncertain',async t=>{
  const h=await deliveryFixture();t.after(h.close);const ready=await h.ready();h.setTransport(async()=>({status:'sent',receiptId:''}));
  assert.equal((await h.task.delivery.submit(ready.input)).status,'uncertain');await h.task.delivery.submit(ready.input);assert.equal(h.attempts.length,1);
});

test('delivery credentials and the adapter-visible body and target cannot be overwritten',async t=>{
  const h=await deliveryFixture();t.after(h.close);const ready=await h.ready();h.setTransport(async reply=>{
    assert.throws(()=>Object.assign(reply,{text:'FORGED_BODY'}));assert.throws(()=>Object.assign(reply.conversation,{id:'other-target'}));return {status:'sent',receiptId:'immutable-receipt'};
  });const result=await h.task.delivery.submit(ready.input);assert.equal(result.status,'sent');
  const db=new DatabaseSync(join(h.root,'delivery.sqlite'));t.after(()=>db.close());assert.throws(()=>db.prepare('UPDATE deliveries SET reply=? WHERE id=?').run('FORGED_BODY',String(result.deliveryId)),/Immutable delivery credential/);
  assert.throws(()=>db.prepare('UPDATE deliveries SET binding=? WHERE id=?').run('{}',String(result.deliveryId)),/Immutable delivery binding/);
});

test('persona delivery reasoning and opaque provider replay data do not enter the DSH archive',async t=>{
  const h=await deliveryFixture();t.after(h.close);const ready=await h.ready();h.setResponse(()=>[
    {type:'block-start',index:0,blockType:'reasoning'},{type:'reasoning-delta',index:0,text:'DELIVERY_PRIVATE_REASONING'},
    {type:'block-end',index:0,block:{type:'reasoning',text:'DELIVERY_PRIVATE_REASONING'}},
    {type:'block-start',index:1,blockType:'text'},{type:'text-delta',index:1,text:'PERSONA_FINAL：带伞。'},
    {type:'block-end',index:1,block:{type:'text',text:'PERSONA_FINAL：带伞。'}},{type:'finish',reason:{kind:'stop'}},
  ]);assert.equal((await h.task.delivery.submit(ready.input)).status,'sent');
  const session=h.ctx.agents.get(SessionId(h.core.journal.get(ready.inboundId).sessionId))!.session;assert.ok(!JSON.stringify(session.snapshotEvents()).includes('DELIVERY_PRIVATE_REASONING'));
});

test('parallel target conversations keep independent persona sessions and transport recipients',async t=>{
  const h=await deliveryFixture();t.after(h.close);const a=await h.ready(0),c=await h.ready(2);const [ra,rc]=await Promise.all([h.task.delivery.submit(a.input),h.task.delivery.submit(c.input)]);
  assert.equal(ra.status,'sent');assert.equal(rc.status,'sent');assert.equal(h.sent.length,2);assert.deepEqual(new Set(h.sent.map(r=>r.conversation.id)),new Set([scenes[0]!.id,scenes[2]!.id]));
  await assert.rejects(h.task.delivery.submit({...a.input,requestId:c.input.requestId}),/idempotency_conflict/);
});

test('restart interrupts a saved ready credential without dispatch or regeneration',async()=>{
  const h=await deliveryFixture(),ready=await h.ready(),root=h.root,taskId=h.task.reference.id,db=new DatabaseSync(join(root,'delivery.sqlite'));
  db.exec("CREATE TRIGGER stop_before_send BEFORE UPDATE ON deliveries WHEN NEW.state='sending' BEGIN SELECT RAISE(ABORT,'fixture stop'); END;");
  const result=await h.task.delivery.submit(ready.input);assert.equal(result.status,'rejected');assert.equal(h.attempts.length,0);db.exec('DROP TRIGGER stop_before_send');db.prepare("UPDATE deliveries SET state='ready' WHERE id=?").run(String(result.deliveryId));db.close();await h.close();
  const next=await taskMemoryFixture(root);try{const task=next.core.resumeTaskWorkspace(taskId);assert.equal(task.delivery.status({deliveryId:result.deliveryId}).status,'interrupted');assert.equal((await task.delivery.submit(ready.input)).status,'interrupted');assert.equal(next.adapter.requests.length,0);}finally{await next.close();}
});

test('a late draft and a different target cannot open a delivery attempt',async t=>{
  const h=await deliveryFixture();t.after(h.close);const ready=await h.ready();await assert.rejects(h.task.delivery.submit({...ready.input,target:scenes[2]!}));
  await h.question(0,'已经有更新的问题');await assert.rejects(h.task.delivery.submit(ready.input),/late_result/);assert.equal(h.attempts.length,0);
});

test('unknown and thrown transport outcomes are terminal and never replay on repeated submissions',async t=>{
  for(const throws of [false,true]){const h=await deliveryFixture();try{const ready=await h.ready();h.setTransport(async()=>{if(throws)throw new Error('fixture lost acknowledgement');return {status:'unknown',code:'fixture'};});
    const result=await h.task.delivery.submit(ready.input);assert.equal(result.status,'uncertain');assert.equal(h.attempts.length,1);
    await h.task.delivery.submit({...ready.input,requestId:randomUUID()});assert.equal(h.attempts.length,1);
  }finally{await h.close();}}
});

test('abort after transport starts records uncertainty; a late transport acknowledgement cannot cause a second send or promote state',async t=>{
  const h=await deliveryFixture();t.after(h.close);const ready=await h.ready();let started!:()=>void,finish!:(v:{status:'sent';receiptId:string})=>void;
  const entered=new Promise<void>(resolve=>{started=resolve;}),late=new Promise<{status:'sent';receiptId:string}>(resolve=>{finish=resolve;});h.setTransport(async()=>{started();return late;});
  const abort=new AbortController(),pending=h.task.delivery.submit(ready.input,abort.signal);await entered;abort.abort();const result=await pending;assert.equal(result.status,'uncertain');
  finish({status:'sent',receiptId:'late-receipt'});await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(h.task.delivery.status({deliveryId:result.deliveryId}).status,'uncertain');
  await h.task.delivery.submit(ready.input);assert.equal(h.attempts.length,1);
});

test('definitely not-sent is recorded distinctly and duplicate requests remain non-replaying',async t=>{
  const h=await deliveryFixture();t.after(h.close);const ready=await h.ready();h.setTransport(async()=>({status:'not-sent',code:'fixture-rejected'}));
  const result=await h.task.delivery.submit(ready.input);assert.equal(result.status,'not-sent');await h.task.delivery.submit(ready.input);assert.equal(h.attempts.length,1);assert.equal(h.sent.length,0);
});

test('concurrent duplicates share one intent and a second job for the same question cannot bypass it',async t=>{
  const h=await deliveryFixture();t.after(h.close);const ready=await h.ready();const results=await Promise.all([h.task.delivery.submit(ready.input),h.task.delivery.submit(ready.input)]);
  assert.equal(results[0]!.deliveryId,results[1]!.deliveryId);assert.equal(h.attempts.length,1);
  const next=await h.task.expression.generate({requestId:randomUUID(),packetId:ready.packetId,target:scenes[0]});
  await assert.rejects(h.task.delivery.submit({...ready.input,requestId:randomUUID(),jobId:String(next.jobId)}),/intent_already_exists/);
});

test('task switch away and back fences the original delivery material',async t=>{
  const h=await deliveryFixture();t.after(h.close);const ready=await h.ready();let changed=false;
  h.setResponse(()=>{if(!changed){changed=true;h.handles[0]!.tasks.activate(null,{requestId:randomUUID(),conversation:scenes[0],expectedVersion:1});h.activate(0,2);}return textReply('OLD_ACTIVATION');});
  assert.equal((await h.task.delivery.submit(ready.input)).status,'rejected');assert.equal(h.attempts.length,0);
});

test('non-opted-in channels cannot use task delivery, including existing QQ-style adapters',async t=>{
  const h=await expressionFixture();t.after(h.close);h.handles[0]!.tasks.join(h.task.reference,{requestId:randomUUID(),conversation:scenes[0]});h.handles[0]!.tasks.activate(h.task.reference,{requestId:randomUUID(),conversation:scenes[0],expectedVersion:0});
  const packet=h.prepare(await h.question()),job=await h.task.expression.generate({requestId:randomUUID(),packetId:packet.packetId,target:scenes[0]});await assert.rejects(h.task.delivery.submit({requestId:randomUUID(),jobId:job.jobId,target:scenes[0]}),/simulated channel/);
});

test('delivery refuses a host without source-tracked history retirement',async t=>{
  const h=await deliveryFixture(undefined,false);t.after(h.close);const ready=await h.ready(),before=h.adapter.requests.length;
  await assert.rejects(h.task.delivery.submit(ready.input),/source_tracking_required/);assert.equal(h.attempts.length,0);assert.equal(h.adapter.requests.length,before);
});

test('delivery turns reject tool calls without replaying any capability',async t=>{
  const h=await deliveryFixture();t.after(h.close);let effects=0;const plugin=h.core.registerExtension({id:'delivery-effect',version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',actions:[{name:'delivery_effect',description:'虚构副作用',fields:{},execute:async()=>{effects++;return {done:true};}}]});t.after(()=>plugin.dispose());
  const ready=await h.ready();h.setResponse(()=>call('delivery_effect',{}));assert.equal((await h.task.delivery.submit(ready.input)).status,'rejected');assert.equal(effects,0);assert.equal(h.attempts.length,0);
});

test('an old delivery carrier and dependent answer leave the next chat context without removing other plugin regions',async t=>{
  const h=await deliveryFixture();t.after(h.close);const extra=h.core.registerExtension({id:'delivery-other',version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',contexts:[{id:'status',kind:'operational-fact',prepare:async()=>[{id:'other',version:'1',text:'OTHER_PLUGIN_REMAINS',sources:[{ref:'fixture:other',version:'1',hash:'fixture'}],expiresAt:'2099-01-01T00:00:00.000Z'}],validate:()=>true}]});t.after(()=>extra.dispose());
  const ready=await h.ready();assert.equal((await h.task.delivery.submit(ready.input)).status,'sent');h.setResponse(()=>textReply('新的普通回复'));await h.question(0,'继续普通聊天');
  const visible=JSON.stringify(h.adapter.requests.at(-1)!.messages);assert.ok(!visible.includes('PERSONA_FINAL'));assert.ok(!visible.includes(ready.draft));assert.match(visible,/OTHER_PLUGIN_REMAINS/);
});

test('restart recovers sending as uncertain and never resends an earlier intent',async()=>{
  const h=await deliveryFixture(),ready=await h.ready(),result=await h.task.delivery.submit(ready.input),root=h.root,taskId=h.task.reference.id;assert.equal(result.status,'sent');await h.close();
  const db=new DatabaseSync(join(root,'delivery.sqlite'));db.prepare("UPDATE deliveries SET state='sending',receipt=NULL WHERE id=?").run(String(result.deliveryId));db.close();
  const next=await taskMemoryFixture(root);try{const task=next.core.resumeTaskWorkspace(taskId);assert.equal(task.delivery.status({deliveryId:result.deliveryId}).status,'uncertain');assert.equal((await task.delivery.submit(ready.input)).status,'uncertain');assert.equal(next.adapter.requests.length,0);}finally{await next.close();}
});

test('an unsupported delivery ledger fails without resetting data or retaining journal ownership',async()=>{
  const h=await deliveryFixture(),root=h.root;await h.close();const db=new DatabaseSync(join(root,'delivery.sqlite'));db.exec('PRAGMA user_version=99');db.close();
  await assert.rejects(taskMemoryFixture(root),/Unsupported delivery ledger/);
  const journal=new DatabaseSync(join(root,'journal.sqlite'));try{assert.equal(journal.prepare('SELECT count(*) AS n FROM ownership').get()?.n,0);}finally{journal.close();}
  const repair=new DatabaseSync(join(root,'delivery.sqlite'));try{assert.equal(repair.prepare('PRAGMA user_version').get()?.user_version,99);repair.exec('PRAGMA user_version=1');}finally{repair.close();}
  const next=await taskMemoryFixture(root);await next.close();
});
