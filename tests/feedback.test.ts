import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import * as Memory from '@dafeiyu/memory';
import { memoryFixture } from './memory-fixture.js';
import { report,fixtureTool,invoke,archivePointer,nextTurn } from './feedback-fixture.js';
import { call,textReply } from './harness.js';

const page=z.object({status:z.literal('ok'),text:z.string(),nextCursor:z.string().nullable(),hasMore:z.boolean(),version:z.number(),hash:z.string()});
const status=(value:unknown)=>z.object({status:z.string()}).parse(value).status;
const visible=(h:Awaited<ReturnType<typeof memoryFixture>>)=>JSON.stringify(h.adapter.requests.at(-1)?.messages);
const change=(ref:string,expectedVersion:number)=>({ref,expectedVersion,requestId:randomUUID(),reason:'虚构明确操作'});

test('adapted tool archives before returning a bounded structured brief, with original operation provenance',async t=>{
  const h=await memoryFixture(undefined,{feedback:{maxBriefBytes:4096}});t.after(h.close);
  const data='虚构日志🙂\n'.repeat(900)+'ORIGINAL_TAIL_731';const tool=fixtureTool(h,()=>report(data));t.after(()=>tool.handle.dispose());
  const result=await invoke(h,tool.name),pointer=archivePointer(result.value);
  assert.ok(Buffer.byteLength(result.text)<4096);assert.ok(!result.text.includes('ORIGINAL_TAIL_731'));assert.equal(tool.calls,1);
  const db=new DatabaseSync(join(h.root,'feedback.sqlite'));try{
    const stored=z.object({body:z.string(),action:z.string(),startedEventId:z.string()}).parse(JSON.parse(String(db.prepare('SELECT body FROM archives').get()?.body)));
    assert.match(stored.body,/ORIGINAL_TAIL_731/);assert.equal(stored.action,tool.name);
    assert.ok(h.core.journal.events(result.message.route).some(e=>e.id===stored.startedEventId&&e.type==='operation.started'));
  }finally{db.close();}
  assert.match(pointer.ref,/^dafeiyu:feedback:/);assert.ok(!JSON.stringify(h.core.journal.events(result.message.route)).includes('ORIGINAL_TAIL_731'));
});

for(const outcome of ['succeeded','failed','partial','unknown','running'] as const)test(`structured ${outcome} keeps outcome, side-effect and completeness facts`,async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);
  const tool=fixtureTool(h,()=>report('日志',{outcome,effects:'unknown',completeness:'partial',diagnostics:[{code:'E_FIXTURE_731',message:'精确虚构错误：连接中断'}]}));t.after(()=>tool.handle.dispose());
  const result=z.object({outcome:z.string(),effects:z.string(),completeness:z.string(),diagnosticCodes:z.array(z.string()),diagnostics:z.array(z.object({message:z.string()}))}).parse((await invoke(h,tool.name)).value);
  assert.equal(result.outcome,outcome);assert.equal(result.effects,'unknown');assert.equal(result.completeness,'partial');assert.deepEqual(result.diagnosticCodes,['E_FIXTURE_731']);assert.match(result.diagnostics[0]!.message,/连接中断/);
});

test('Unicode cursor pages reconstruct the sanitized original without re-executing the tool',async t=>{
  const h=await memoryFixture(undefined,{feedback:{maxPageChars:100}});t.after(h.close);
  const original='青鱼🙂数据\n'.repeat(80);const tool=fixtureTool(h,()=>report(original));t.after(()=>tool.handle.dispose());
  const pointer=archivePointer((await invoke(h,tool.name)).value);let cursor:string|undefined,text='';
  do{
    const result=page.parse((await invoke(h,'dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:String(pointer.version),section:'data',...(cursor?{cursor}:{})})).value);
    text+=result.text;cursor=result.nextCursor??undefined;assert.equal(result.hash,pointer.hash);
  }while(cursor);
  assert.equal(text,original);assert.equal(tool.calls,1);
});

test('cursor is bound to scope, section, state version and archive identity',async t=>{
  const h=await memoryFixture(undefined,{feedback:{maxPageChars:100}});t.after(h.close);const tool=fixtureTool(h,()=>report('甲'.repeat(600)));t.after(()=>tool.handle.dispose());
  const pointer=archivePointer((await invoke(h,tool.name)).value);
  const first=page.parse((await invoke(h,'dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:'1',section:'data'})).value);assert.ok(first.nextCursor);
  assert.equal(z.object({status:z.string()}).parse((await invoke(h,'dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:'1',section:'receipts',cursor:first.nextCursor})).value).status,'stale_cursor');
  assert.equal(z.object({status:z.string()}).parse((await invoke(h,'dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:'1',cursor:first.nextCursor},'b')).value).status,'not_found');
  await h.probe('a',c=>h.memory.feedbackDelete(c,change(pointer.ref,1)));await h.probe('a',c=>h.memory.feedbackRestore(c,change(pointer.ref,2)));
  assert.equal(z.object({status:z.string()}).parse((await invoke(h,'dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:'1',cursor:first.nextCursor})).value).status,'version_conflict');
});

test('raw page views are limited to their requesting turn and do not accumulate across later turns',async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);
  const tool=fixtureTool(h,()=>report('A'.repeat(800)+'PAGE_ONLY_SENTINEL'));t.after(()=>tool.handle.dispose());const pointer=archivePointer((await invoke(h,tool.name)).value);
  await invoke(h,'dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:'1',section:'data',offset:'800'});
  assert.match(visible(h),/PAGE_ONLY_SENTINEL/);await nextTurn(h);assert.ok(!visible(h).includes('PAGE_ONLY_SENTINEL'));assert.equal(tool.calls,1);
});

test('logical deletion withdraws controlled brief/pages, supports explicit deleted lookup and preserves unrelated tools',async t=>{
  const h=await memoryFixture(undefined,{feedback:{},context:{}});t.after(h.close);
  h.ctx.systemPrompt.context({name:'untouched-native',order:1,text:'NATIVE_UNCHANGED'});
  const tool=fixtureTool(h,()=>report('DELETABLE_FEEDBACK'));const legacy=fixtureTool(h,()=>({text:'LEGACY_UNCHANGED'}),false);t.after(()=>tool.handle.dispose());t.after(()=>legacy.handle.dispose());
  const result=await invoke(h,tool.name),pointer=archivePointer(result.value);await invoke(h,legacy.name);
  await h.probe('a',c=>h.memory.feedbackDelete(c,change(pointer.ref,1)));
  assert.ok(!visible(h).includes('DELETABLE_FEEDBACK'));assert.match(visible(h),/LEGACY_UNCHANGED/);assert.match(visible(h),/NATIVE_UNCHANGED/);
  assert.equal(z.object({status:z.string()}).parse((await invoke(h,'dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:'2'})).value).status,'not_found');
  const deleted=await invoke(h,'dafeiyu_tool_feedback_deleted_open',{ref:pointer.ref,expectedVersion:'2',section:'data'});assert.match(page.parse(deleted.value).text,/DELETABLE_FEEDBACK/);
  await nextTurn(h);assert.ok(!visible(h).includes('DELETABLE_FEEDBACK'));
  await h.probe('a',c=>h.memory.feedbackRestore(c,change(pointer.ref,2)));assert.ok(!visible(h).includes('DELETABLE_FEEDBACK'));
  assert.match(page.parse((await invoke(h,'dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:'3',section:'data'})).value).text,/DELETABLE_FEEDBACK/);
  assert.equal(tool.calls,1);
});

test('old timeline references cannot bypass a feedback tombstone or become primary memory evidence',async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);const tool=fixtureTool(h,()=>report('HIDDEN_OLD_VIEW'));t.after(()=>tool.handle.dispose());
  const original=await invoke(h,tool.name),pointer=archivePointer(original.value);
  const complete=h.core.journal.events(original.message.route).find(e=>e.traceId===original.message.id&&e.type==='turn.completed')!;
  const index=complete.sources.findIndex(s=>s.kind==='session'&&s.seq===original.event.seq);assert.ok(index>=0);const source=`dafeiyu:source:${complete.id}:${index}`;
  const open=await h.probe('a',c=>h.timeline.open(c,{ref:source}));assert.equal(open.status,'ok');if(open.status==='ok')assert.equal(open.memoryUse,'derived-only');
  await h.probe('a',c=>h.memory.feedbackDelete(c,change(pointer.ref,1)));
  assert.equal((await h.probe('a',c=>h.timeline.open(c,{ref:source}))).status,'not_exported');
});

test('cross-conversation reads, mutations and deleted searches cannot see another archive',async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);const tool=fixtureTool(h,()=>report('A_PRIVATE'));t.after(()=>tool.handle.dispose());const pointer=archivePointer((await invoke(h,tool.name)).value);
  assert.equal(status(await h.probe('b',c=>h.memory.feedbackOpen(c,{ref:pointer.ref,expectedVersion:1}))),'not_found');
  assert.equal(status(await h.probe('b',c=>h.memory.feedbackDelete(c,change(pointer.ref,1)))),'not_found');
  assert.equal(status(await h.probe('b',c=>h.memory.feedbackRestore(c,change(pointer.ref,1)))),'not_found');
  for(const mode of ['normal','history','deleted'])assert.equal(z.object({items:z.array(z.unknown())}).parse(await h.probe('b',c=>h.memory.feedbackList(c,{mode}))).items.length,0);
});

test('declared memory source revisions and logical deletion govern archive readability',async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);const source=await h.evidence();
  const memory=z.object({id:z.string()}).parse(await h.probe('a',c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:'来源版本1',sourceRefs:[source.ref]})));
  const tool=fixtureTool(h,()=>report('DERIVED_ARCHIVE',{sourceRefs:[`dafeiyu:memory:${memory.id}:1`]}));t.after(()=>tool.handle.dispose());const pointer=archivePointer((await invoke(h,tool.name)).value);
  await h.probe('a',c=>h.memory.revise(c,{requestId:randomUUID(),id:memory.id,expectedVersion:1,kind:'knowledge',claimType:'self_report',content:'来源版本2',sourceRefs:[source.ref]}));
  assert.ok(!visible(h).includes('DERIVED_ARCHIVE'));
  assert.equal(status(await h.probe('a',c=>h.memory.feedbackOpen(c,{ref:pointer.ref,expectedVersion:1}))),'not_found');
  assert.match(page.parse((await invoke(h,'dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:'1',mode:'history',section:'data'})).value).text,/DERIVED_ARCHIVE/);
  await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:memory.id,expectedVersion:2,reason:'删除来源'}));
  assert.equal(status(await h.probe('a',c=>h.memory.feedbackOpen(c,{ref:pointer.ref,expectedVersion:1,mode:'history'}))),'not_found');
  assert.match(page.parse((await invoke(h,'dafeiyu_tool_feedback_deleted_open',{ref:pointer.ref,expectedVersion:'1',section:'data'})).value).text,/DERIVED_ARCHIVE/);
});

test('unadapted tool results keep their original shape and do not create archives',async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);const body={outcome:'custom',data:'LEGACY_FULL_'.repeat(1000)};const tool=fixtureTool(h,()=>body,false);t.after(()=>tool.handle.dispose());
  assert.deepEqual((await invoke(h,tool.name)).value,body);
  const db=new DatabaseSync(join(h.root,'feedback.sqlite'));try{assert.equal(db.prepare('SELECT count(*) AS n FROM archives').get()?.n,0);}finally{db.close();}
});

test('archive storage failure preserves known execution state and never repeats side effects',async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);
  const db=new DatabaseSync(join(h.root,'feedback.sqlite'));t.after(()=>db.close());db.exec("CREATE TRIGGER fail_archive BEFORE INSERT ON archives BEGIN SELECT RAISE(FAIL,'synthetic storage failure'); END;");
  const tool=fixtureTool(h,()=>report('NOT_TO_LEAK',{outcome:'succeeded',effects:'applied'}));t.after(()=>tool.handle.dispose());
  const result=z.object({outcome:z.string(),effects:z.string(),archiveStatus:z.string()}).parse((await invoke(h,tool.name)).value);
  assert.equal(result.outcome,'succeeded');assert.equal(result.effects,'applied');assert.equal(result.archiveStatus,'unavailable');assert.equal(tool.calls,1);assert.ok(!visible(h).includes('NOT_TO_LEAK'));
});

test('exceptions archive only a safe unknown result and never log raw exception secrets',async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);const tool=fixtureTool(h,()=>{throw new Error('OPAQUE_EXCEPTION_SECRET');});t.after(()=>tool.handle.dispose());
  const result=await invoke(h,tool.name),pointer=archivePointer(result.value);assert.equal(z.object({outcome:z.string()}).parse(result.value).outcome,'unknown');
  const raw=page.parse((await invoke(h,'dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:'1'})).value);assert.ok(!raw.text.includes('OPAQUE_EXCEPTION_SECRET'));assert.ok(!visible(h).includes('OPAQUE_EXCEPTION_SECRET'));
});

test('known credentials and reasoning-shaped fields are redacted before archive and brief persistence',async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);const tool=fixtureTool(h,()=>report({password:'SECRET_PASSWORD',reasoning:'PRIVATE_REASONING',text:'Bearer abcdefghijklmnop'}));t.after(()=>tool.handle.dispose());
  const pointer=archivePointer((await invoke(h,tool.name)).value);
  const raw=page.parse((await invoke(h,'dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:'1',section:'data'})).value);assert.ok(!/SECRET_PASSWORD|PRIVATE_REASONING|abcdefghijklmnop/.test(raw.text));assert.match(raw.text,/REDACTED/);
  const db=new DatabaseSync(join(h.root,'feedback.sqlite'));try{assert.ok(!/SECRET_PASSWORD|PRIVATE_REASONING|abcdefghijklmnop/.test(String(db.prepare('SELECT body FROM archives').get()?.body)));}finally{db.close();}
});

test('restart preserves archives and tombstones without replaying tool operations',async()=>{
  const h=await memoryFixture(undefined,{feedback:{}});let pointer:{ref:string;version:number;hash:string};const tool=fixtureTool(h,()=>report('RESTART_ORIGINAL'));
  try{pointer=archivePointer((await invoke(h,tool.name)).value);await h.probe('a',c=>h.memory.feedbackDelete(c,change(pointer.ref,1)));assert.equal(tool.calls,1);}finally{await h.close();}
  const restarted=await memoryFixture(h.root,{feedback:{}});try{
    assert.equal(status(await restarted.probe('a',c=>restarted.memory.feedbackOpen(c,{ref:pointer.ref,expectedVersion:2}))),'not_found');
    assert.match(page.parse((await invoke(restarted,'dafeiyu_tool_feedback_deleted_open',{ref:pointer.ref,expectedVersion:'2',section:'data'})).value).text,/RESTART_ORIGINAL/);
    assert.equal(tool.calls,1);
  }finally{await restarted.close();}
});

test('feedback handling must be available before an adapted side-effecting tool can execute',async t=>{
  const h=await memoryFixture();t.after(h.close);const tool=fixtureTool(h,()=>report('should not run'));t.after(()=>tool.handle.dispose());
  let step=0;h.setResponse(()=>++step===1?call(tool.name,{}):textReply('未执行'));
  h.simulator.send('a','缺少反馈能力',{id:randomUUID()});await h.core.whenIdle();assert.equal(tool.calls,0);
});

test('invalid structured return is archived as unverified rather than inferred success',async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);const tool=fixtureTool(h,()=>({status:'looks successful',data:'INVALID_ORIGINAL'}));t.after(()=>tool.handle.dispose());
  const result=await invoke(h,tool.name);assert.equal(z.object({outcome:z.string()}).parse(result.value).outcome,'unknown');const pointer=archivePointer(result.value);
  assert.match(page.parse((await invoke(h,'dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:'1'})).value).text,/INVALID_ORIGINAL/);
});

test('large diagnostic details may be deferred but every error code and omission marker survives',async t=>{
  const h=await memoryFixture(undefined,{feedback:{maxBriefBytes:4096}});t.after(h.close);
  const diagnostics=Array.from({length:12},(_,i)=>({code:`E_CASE_${i}`,message:'虚构详细错误🙂'.repeat(80)}));
  const tool=fixtureTool(h,()=>report('日志',{outcome:'failed',diagnostics}));t.after(()=>tool.handle.dispose());
  const result=await invoke(h,tool.name),value=z.object({diagnosticCodes:z.array(z.string()),omittedFields:z.array(z.string())}).parse(result.value);
  assert.ok(Buffer.byteLength(result.text)<=4096);assert.deepEqual(value.diagnosticCodes,diagnostics.map(d=>d.code));assert.ok(value.omittedFields.includes('diagnostics'));
  const pointer=archivePointer(result.value),raw=await invoke(h,'dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:'1',section:'diagnostics'});
  assert.match(page.parse(raw.value).text,/E_CASE_0/);
});

test('upstream partial data is not mislabeled complete even on the last archive page',async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);const tool=fixtureTool(h,()=>report('仅收到这些',{completeness:'partial',outcome:'partial'}));t.after(()=>tool.handle.dispose());const pointer=archivePointer((await invoke(h,tool.name)).value);
  const value=z.object({hasMore:z.boolean(),originalCompleteness:z.string()}).parse((await invoke(h,'dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:'1',section:'data'})).value);
  assert.equal(value.hasMore,false);assert.equal(value.originalCompleteness,'partial');
});

test('capacity refusal is explicit, never truncates an archived original, and does not replay the operation',async t=>{
  const h=await memoryFixture(undefined,{feedback:{maxArchiveBytes:1024}});t.after(h.close);const tool=fixtureTool(h,()=>report('甲'.repeat(2000),{effects:'applied'}));t.after(()=>tool.handle.dispose());
  const value=z.object({fault:z.string(),outcome:z.string()}).parse((await invoke(h,tool.name)).value);assert.equal(value.fault,'ARCHIVE_CAPACITY_EXCEEDED');assert.equal(value.outcome,'succeeded');assert.equal(tool.calls,1);
  const db=new DatabaseSync(join(h.root,'feedback.sqlite'));try{assert.equal(db.prepare('SELECT count(*) AS n FROM archives').get()?.n,0);}finally{db.close();}
});

test('foreign declared sources remain unreadable through normal, historical and deleted access',async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);const foreign=await h.evidence('b','另一个会话');
  const tool=fixtureTool(h,()=>report('FOREIGN_DECLARED',{sourceRefs:[foreign.ref]}));t.after(()=>tool.handle.dispose());
  const pointer=z.object({ref:z.string(),archiveStatus:z.string()}).parse((await invoke(h,tool.name)).value);assert.equal(pointer.archiveStatus,'source_unavailable');
  for(const mode of ['normal','history'])assert.equal(status(await h.probe('a',c=>h.memory.feedbackOpen(c,{ref:pointer.ref,expectedVersion:1,mode}))),'not_found');
  await h.probe('a',c=>h.memory.feedbackDelete(c,change(pointer.ref,1)));
  assert.equal(status(await h.probe('a',c=>h.memory.feedbackOpen(c,{ref:pointer.ref,expectedVersion:2},true))),'not_found');
});

test('archive and state roll back together if the durable outbox event cannot be written',async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);const db=new DatabaseSync(join(h.root,'feedback.sqlite'));t.after(()=>db.close());
  db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON events BEGIN SELECT RAISE(FAIL,'synthetic outbox failure'); END;");
  const tool=fixtureTool(h,()=>report('ORIGINAL'));t.after(()=>tool.handle.dispose());await invoke(h,tool.name);
  assert.equal(db.prepare('SELECT count(*) AS n FROM archives').get()?.n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM states').get()?.n,0);assert.equal(tool.calls,1);
});

test('logical state changes use CAS and idempotent receipts without restoring newer state',async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);const tool=fixtureTool(h,()=>report('ORIGINAL'));t.after(()=>tool.handle.dispose());const pointer=archivePointer((await invoke(h,tool.name)).value);
  const deletion=change(pointer.ref,1);assert.equal(status(await h.probe('a',c=>h.memory.feedbackDelete(c,deletion))),'ok');
  assert.equal(z.object({duplicate:z.boolean()}).parse(await h.probe('a',c=>h.memory.feedbackDelete(c,deletion))).duplicate,true);
  assert.equal(status(await h.probe('a',c=>h.memory.feedbackRestore(c,change(pointer.ref,1)))),'version_conflict');
  assert.equal(status(await h.probe('a',c=>h.memory.feedbackRestore(c,{...deletion,expectedVersion:2}))),'idempotency_conflict');
});

test('archive deletion during generation rejects the obsolete answer before delivery',async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);const tool=fixtureTool(h,()=>report('LIVE_FEEDBACK'));t.after(()=>tool.handle.dispose());const pointer=archivePointer((await invoke(h,tool.name)).value);
  const db=new DatabaseSync(join(h.root,'feedback.sqlite'));t.after(()=>db.close());const before=h.simulator.deliveries.length;
  h.setResponse(()=>{db.prepare('UPDATE states SET deleted=1,version=2 WHERE id=?').run(pointer.ref.split(':')[2]!);return textReply('不应交付的旧结果');});
  const receipt=h.simulator.send('a','继续',{id:randomUUID()});await h.core.whenIdle();assert.equal(h.core.journal.get(receipt.id).state,'failed');assert.equal(h.simulator.deliveries.length,before);
  await nextTurn(h);assert.ok(!visible(h).includes('LIVE_FEEDBACK'));
});

test('another DSH agent and its native tool are outside Dafeiyu feedback handling',async t=>{
  const h=await memoryFixture(undefined,{feedback:{}});t.after(h.close);let step=0;h.setResponse(()=>++step===1?call('native_other',{}):textReply('外部智能体完成'));
  const body={data:'OTHER_AGENT_RAW'.repeat(600)};
  const agent=await h.ctx.agents.create({sessionId:SessionId(`foreign-${randomUUID()}`),agentOptions:{provider:'local-test',model:'scripted'},setup:scope=>{
    scope.tools.presentAs('native');scope.tools.register({name:'native_other',description:'另一个智能体工具',parameters:{type:'object',properties:{}},output:{schema:{},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async()=>body});
  }});t.after(()=>agent.dispose());
  agent.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'运行虚构工具'}]}));await agent.agent.whenIdle();
  assert.match(visible(h),/OTHER_AGENT_RAW/);const db=new DatabaseSync(join(h.root,'feedback.sqlite'));try{assert.equal(db.prepare('SELECT count(*) AS n FROM archives').get()?.n,0);}finally{db.close();}
});
