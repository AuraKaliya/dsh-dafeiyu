import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { z } from 'zod';
import { MemoryStore,MEMORY_SCHEMA_VERSION } from '@dafeiyu/memory/store';
import { inspectStorage } from '@dafeiyu/host';
import { qqCapabilityFixture,scene,otherGroup,lastPage,bot,group,until,outcomes } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';
type Fixture=Awaited<ReturnType<typeof qqCapabilityFixture>>;
const native=(r:{sessionId?:unknown})=>String(r.sessionId).startsWith('dafeiyu-task-');
function rows(h:Fixture){const db=new DatabaseSync(join(h.root,'core','runtime.sqlite'),{readOnly:true});try{return db.prepare("SELECT r.id FROM runs r JOIN execution_requests q ON q.id=r.request_key WHERE q.producer='qq-tasks' ORDER BY r.rowid").all().map(row=>String(row.id));}finally{db.close();}}
async function task(h:Fixture,mode:'plain'|'public'|'mixed'|'foreign'='public'){let chat=0,work=0;
  h.setResponse(request=>{if(!native(request))return ++chat===1?call('qq_task_submit',{requestId:'work',title:'表达材料测试'}):textReply('已受理');
    work++;if(work===1&&mode!=='plain')return call('qq_browse',{requestId:'a',target:mode==='foreign'?{...scene,id:otherGroup}:scene});
    if(work===2&&mode==='mixed')return call('qq_browse',{requestId:'b',target:{...scene,id:otherGroup}});return textReply('EXECUTOR_REPORT_SENTINEL：属于执行器的推断，不得直接冒充外部事实。');});
  await h.message('任务：根据可用信息整理结果',{trigger:true});return rows(h).at(-1)!;
}

test('native expression records public observations and labels an entirely target-visible executor result as inference',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);await h.message('PUBLIC_TARGET_SENTINEL');const id=await task(h),packet=await h.core.prepareMessageTaskExpression(id);
  assert.equal(packet.anchor.kind,'task-result');assert.deepEqual(packet.anchor.target,scene);assert.ok(packet.evidence.some(e=>e.kind==='reported'&&e.text.includes('PUBLIC_TARGET_SENTINEL')));assert.equal(packet.resultIncluded,true);assert.ok(packet.evidence.some(e=>e.kind==='inference'));
  assert.deepEqual(await h.core.prepareMessageTaskExpression(id),packet);const count=h.adapter.requests.length;await h.reload();assert.deepEqual(await h.core.openMessageTaskExpression(id,packet.id),packet);assert.equal(h.adapter.requests.length,count);
  assert.equal(h.core.journal.executionEvents('dafeiyu',packet.anchor.taskId).filter(event=>event.type==='native.expression.prepared').length,1);
});

test('clean expression excludes another conversation and the mixed internal report, including its persisted packet',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);await h.message('PUBLIC_TARGET_SENTINEL');await h.message('PRIVATE_GROUP_SENTINEL',{target:{...scene,id:otherGroup}});const id=await task(h,'mixed'),packet=await h.core.prepareMessageTaskExpression(id);
  assert.equal(packet.resultIncluded,false);assert.match(JSON.stringify(packet),/PUBLIC_TARGET_SENTINEL/);assert.ok(!JSON.stringify(packet).includes('PRIVATE_GROUP_SENTINEL'));assert.ok(!JSON.stringify(packet).includes('EXECUTOR_REPORT_SENTINEL'));
  const db=new DatabaseSync(join(h.root,'memory','memory.sqlite'),{readOnly:true});try{const stored=String(db.prepare('SELECT body FROM native_expression_packets').get()?.body);assert.ok(!stored.includes('PRIVATE_GROUP_SENTINEL'));assert.ok(!stored.includes('EXECUTOR_REPORT_SENTINEL'));}finally{db.close();}
});

test('a result influenced only by a foreign view cannot create target expression material',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);await h.message('FOREIGN_ONLY_SENTINEL',{target:{...scene,id:otherGroup}});const id=await task(h,'foreign');await assert.rejects(()=>h.core.prepareMessageTaskExpression(id),/NO_PUBLIC_MATERIAL/);
});

test('a plugin copying a valid public observation cannot mark its other output fields as public evidence',async t=>{
  const h=await qqCapabilityFixture({tasks:true,extraTaskActions:['fixture_overlay']});t.after(h.close);await h.message('PUBLIC_ORIGINAL_SENTINEL');let page:unknown,chat=0,work=0;
  const handle=h.core.registerExtension({protocolVersion:4,id:'fixture-overlay',version:'1',agentId:'dafeiyu',actions:[{id:'fixture_overlay',description:'虚构混合输出',version:'1',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'read',execute:async()=>({status:'succeeded',effects:'none',completeness:'complete',data:z.json().parse({...z.record(z.string(),z.unknown()).parse(page),privateData:'UNPROVEN_OVERLAY_SENTINEL'}),sources:[],receipts:[]})}]});t.after(()=>handle.dispose());
  h.setResponse(request=>{if(!native(request))return ++chat===1?call('qq_task_submit',{requestId:'mixed',title:'混合输出'}):textReply('已受理');
    if(++work===1)return call('qq_browse',{requestId:'original',target:scene});if(work===2){assert.equal(outcomes(request).at(-1)?.status,'succeeded');page=outcomes(request).at(-1)!.data;return call('fixture_overlay',{});}return textReply('UNPROVEN_EXECUTOR_SENTINEL');});
  await h.message('任务：检查原始材料',{trigger:true});const packet=await h.core.prepareMessageTaskExpression(rows(h).at(-1)!);assert.equal(packet.resultIncluded,false);assert.match(JSON.stringify(packet),/PUBLIC_ORIGINAL_SENTINEL/);assert.ok(!JSON.stringify(packet).includes('UNPROVEN_'));
});

test('a plain task result is a derived material and can be explicitly withdrawn without automatic regeneration',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);const id=await task(h,'plain'),packet=await h.core.prepareMessageTaskExpression(id);assert.equal(packet.evidence.filter(evidence=>evidence.kind==='inference').length,1);
  const facts=packet.evidence.filter(evidence=>evidence.kind==='reported'&&evidence.id!=='CONTEXT');assert.equal(facts.length,1);assert.equal(JSON.parse(facts[0]!.text).kind,'result-workflow');assert.doesNotMatch(facts[0]!.text,/EXECUTOR_REPORT_SENTINEL/);
  await h.core.withdrawMessageTaskExpression(id,packet.id,1);await assert.rejects(()=>h.core.prepareMessageTaskExpression(id),/UNAVAILABLE/);
});

test('source revocation inside a synchronous public-material read is caught before a packet is saved',async t=>{
  const resource={channel:'fixture',account:'public',kind:'local' as const,id:'world'},h=await qqCapabilityFixture({tasks:true,extraTaskActions:['fixture_public_read'],extraTaskResources:[resource]});t.after(h.close);
  let valid=true,chat=0,work=0;const page={text:'PUBLIC_MATERIAL'},view=JSON.stringify(page);
  const handle=h.core.registerExtension({protocolVersion:4,id:'fixture-public',version:'1',agentId:'dafeiyu',resourceProofs:{current:()=>valid,epoch:()=>String(valid),publicView:()=>{valid=false;return true;}},actions:[{
    id:'fixture_public_read',description:'虚构公开来源',version:'1',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'read',execute:async(_raw,context)=>{
      const observation=h.core.recordCapabilityObservation(context,'fixture-public',{requestId:'one',proof:{provider:'fixture-public',scene:resource,key:'one',version:1,hash:'a'.repeat(64),roots:['fixture:one'],detail:{}},text:view,occurredAt:'2026-10-28T00:00:00.000Z',counts:{received:1,processed:1},coverage:['fictional-text']}),source=observation.source;
      return {status:'succeeded',effects:'none',completeness:'complete',data:z.json().parse({page,observation}),sources:[{id:source.id,scopeKey:source.scopeKey,version:source.version,contentHash:source.contentHash}],receipts:[]};}}]});t.after(()=>handle.dispose());
  h.setResponse(request=>native(request)?++work===1?call('fixture_public_read',{}):textReply('候选结果'):++chat===1?call('qq_task_submit',{requestId:'source-revokes-in-read'}):textReply('已受理'));
  await h.message('读取公开来源',{trigger:true});await assert.rejects(()=>h.core.prepareMessageTaskExpression(rows(h).at(-1)!),/SOURCE_STALE/);assert.equal(valid,false);
  const db=new DatabaseSync(join(h.root,'memory/memory.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM native_expression_packets').get()?.n,0);}finally{db.close();}
});

test('source recall retires a native expression packet while unrelated new chat does not change its anchor',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);const source=await h.message('RECALLED_EXPRESSION_SENTINEL'),id=await task(h),packet=await h.core.prepareMessageTaskExpression(id);
  h.setResponse(()=>textReply('无关聊天'));await h.message('今天聊其它事情',{trigger:true});assert.deepEqual(await h.core.openMessageTaskExpression(id,packet.id),packet);
  h.emit({post_type:'notice',notice_type:'group_recall',self_id:Number(bot),group_id:Number(group),message_id:Number(source.id)});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled===1);await assert.rejects(()=>h.core.openMessageTaskExpression(id,packet.id),/SOURCE_STALE/);
});

test('deleting then restoring target memory cannot revive an older native expression packet',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);await h.message('FORGOTTEN_EXPRESSION_SENTINEL');let step=0;
  h.setResponse(request=>++step===1?call('qq_browse',{requestId:'read'}):step===2?call('qq_observe_select',{requestId:'save',snapshotId:lastPage(request).snapshotId,mode:'original',reason:'虚构观察'}):textReply('已记忆'));await h.message('记录观察',{trigger:true});
  const db=new DatabaseSync(join(h.root,'memory','memory.sqlite'),{readOnly:true});let memoryId:string;try{memoryId=String(db.prepare('SELECT id FROM memory_items').get()?.id);}finally{db.close();}
  const id=await task(h),packet=await h.core.prepareMessageTaskExpression(id);
  for(const action of ['delete','restore'] as const){step=0;h.setResponse(()=>++step===1?call(`dafeiyu_memory_${action}`,{requestId:action,id:memoryId,expectedVersion:action==='delete'?'1':'2',reason:'虚构来源状态变更'}):textReply('按回执处理'));await h.message('变更记忆状态',{trigger:true});
    await assert.rejects(()=>h.core.openMessageTaskExpression(id,packet.id),/SOURCE_STALE|NO_PUBLIC_MATERIAL/);}
});

test('native expression creation rolls back its material if its audit cannot be persisted',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);const id=await task(h,'plain'),db=new DatabaseSync(join(h.root,'memory','memory.sqlite'));
  try{db.exec("CREATE TRIGGER fixture_expression_audit BEFORE INSERT ON execution_memory_outbox BEGIN SELECT RAISE(ABORT,'FIXTURE_AUDIT_FAILURE'); END;");await assert.rejects(()=>h.core.prepareMessageTaskExpression(id),/FIXTURE_AUDIT_FAILURE/);assert.equal(db.prepare('SELECT count(*) AS n FROM native_expression_packets').get()?.n,0);
    db.exec('DROP TRIGGER fixture_expression_audit');assert.ok((await h.core.prepareMessageTaskExpression(id)).id);
  }finally{db.exec('DROP TRIGGER IF EXISTS fixture_expression_audit');db.close();}
});
