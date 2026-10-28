import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { SessionId } from '@deepseek-ai/dsh-session';
import * as Memory from '@dafeiyu/memory';
import { z } from 'zod';
import { memoryFixture } from './memory-fixture.js';
import { textReply } from './harness.js';

type H=Awaited<ReturnType<typeof memoryFixture>>;
const sentence='晨露项目的代号是紫帆731。';
const result=(text=sentence,extra:Record<string,unknown>={})=>({schemaVersion:1,overview:'仅保存发言者的明确陈述',gaps:[],claims:[{
  action:'add',kind:'knowledge',claimType:'self_report',subject:'晨露项目',content:text,
  support:[{sourceId:'S1',quote:text}],opposition:[],uncertainties:[],explicit:true,temporal:'durable',targetId:null,...extra,
}]});
const statusSchema=z.object({status:z.literal('ok'),jobId:z.uuid(),state:z.string(),counts:z.object({committed:z.number(),review:z.number()})});
const searchSchema=z.object({status:z.literal('ok'),items:z.array(z.object({id:z.uuid(),version:z.number(),revision:z.number(),ref:z.string(),content:z.string(),analysisStatus:z.string()}))});
const search=async(h:H,room='a')=>searchSchema.parse(await h.probe(room,c=>h.memory.search(c,{}))).items;
async function submit(h:H,ref:string,targets:string[]=[],requestId:string=randomUUID()){
  return statusSchema.parse(await h.probe('a',c=>h.memory.analyze(c,{requestId,sourceRefs:[ref],targetIds:targets})));
}
async function settled(h:H,id:string){await h.memory.whenAnalysisIdle();return statusSchema.parse(await h.probe('a',c=>h.memory.analysisStatus(c,id)));}
const inspect=(h:H,id:string)=>h.probe('a',c=>h.memory.analysisInspect(c,id));
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>{release=r;});return {promise,release};}

test('independent DSH analysis inherits model route only, publishes exact evidence, and does not inject chat',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const source=await h.evidence('a',sentence);
  h.ctx.systemPrompt.section({name:'unrelated-global',order:0,text:'GLOBAL_PERSONA_SENTINEL'});
  h.setAnalysisResponse(options=>{
    assert.equal(options.provider,'local-test');assert.equal(options.model,'scripted');
    assert.equal(options.tools?.length??0,0);
    assert.ok(!JSON.stringify(options).includes('GLOBAL_PERSONA_SENTINEL'));
    return textReply(JSON.stringify(result()));
  });
  const job=await submit(h,source.ref);
  const deliveries=h.simulator.deliveries.length;
  await h.memory.whenAnalysisIdle();
  assert.equal(h.simulator.deliveries.length,deliveries);
  const session=h.ctx.agents.get(SessionId(source.message.sessionId))!;
  assert.ok(!JSON.stringify(session.session.snapshotEvents()).includes('仅保存发言者的明确陈述'));
  const status=await settled(h,job.jobId);assert.equal(status.state,'completed');assert.equal(status.counts.committed,1);
  const memories=await search(h);assert.equal(memories.length,1);assert.match(memories[0]!.content,/陈述者/);assert.equal(memories[0]!.analysisStatus,'evidence_checked');
  const report=await inspect(h,job.jobId);assert.match(JSON.stringify(report),/analysis_read_only/);
  const provenance=z.object({inputGeneration:z.number(),sources:z.array(z.object({sourceId:z.string(),evidence:z.object({ref:z.string()})}))}).parse(report);
  assert.equal(provenance.inputGeneration,0);assert.equal(provenance.sources[0]?.evidence.ref,source.ref);
  const events=h.core.journal.events(source.message.route);
  assert.ok(events.some(event=>event.type==='memory.analysis.finished'));
  assert.ok(!JSON.stringify(events).includes('紫帆731'));
});

test('explicit same-author correction creates a new version and preserves old evidence',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const source=await h.evidence('a',sentence);h.setAnalysisResponse(()=>textReply(JSON.stringify(result())));
  await settled(h,(await submit(h,source.ref)).jobId);const original=(await search(h))[0]!;
  const corrected='更正：晨露项目的代号改为青鱼888。';const next=await h.evidence('a',corrected);
  h.setAnalysisResponse(()=>textReply(JSON.stringify(result(corrected,{action:'revise',targetId:original.id}))));
  assert.equal((await settled(h,(await submit(h,next.ref,[original.id])).jobId)).counts.committed,1);
  const items=await search(h);assert.equal(items.length,1);assert.equal(items[0]!.version,2);assert.match(items[0]!.content,/青鱼888/);
  const old=await h.probe('a',c=>h.memory.read(c,{id:original.id,revision:1,mode:'history'}));assert.match(JSON.stringify(old),/紫帆731/);
});

for(const [name,change,text] of [
  ['paraphrase',{content:'项目代号是紫帆731'},sentence],
  ['inference',{claimType:'inference'},sentence],
  ['temporary',{temporal:'temporary'},sentence],
  ['joke',{},'开玩笑：晨露项目的代号是紫帆731。'],
  ['condition omitted',{content:sentence,support:[{sourceId:'S1',quote:sentence}]},'如果实验成功，'+sentence],
  ['uncertainty',{uncertainties:['时间尚不明确']},sentence],
] as const)test(`unsafe ${name} stays in candidate review without publishing`,async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const source=await h.evidence('a',text);h.setAnalysisResponse(()=>textReply(JSON.stringify(result(text,change))));
  const status=await settled(h,(await submit(h,source.ref)).jobId);
  assert.equal(status.state,'completed');assert.equal(status.counts.review,1);assert.equal((await search(h)).length,0);
});

for(const [name,response,code] of [
  ['invalid JSON','not JSON','invalid_result'],
  ['extra field',JSON.stringify({...result(),execute:'delete_all'}),'invalid_result'],
  ['invented quote',JSON.stringify(result('伪造的晨露项目原文')),'invalid_evidence'],
  ['unknown source',JSON.stringify(result(sentence,{support:[{sourceId:'S8',quote:sentence}]})),'invalid_evidence'],
] as const)test(`${name} fails safely`,async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const source=await h.evidence('a',sentence);h.setAnalysisResponse(()=>textReply(response));
  const id=(await submit(h,source.ref)).jobId;await h.memory.whenAnalysisIdle();
  const status=await h.probe('a',c=>h.memory.analysisStatus(c,id));assert.match(JSON.stringify(status),new RegExp(code));
  assert.equal((await search(h)).length,0);
});

test('submission, status, inspection, cancellation and targets are conversation-isolated',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const source=await h.evidence('a',sentence);await h.evidence('b','另一会话');h.setAnalysisResponse(()=>textReply(JSON.stringify(result())));
  const id=(await submit(h,source.ref)).jobId;await h.memory.whenAnalysisIdle();
  assert.deepEqual(await h.probe('b',c=>h.memory.analyze(c,{requestId:randomUUID(),sourceRefs:[source.ref]})),{status:'source_unavailable'});
  for(const method of ['analysisStatus','analysisInspect','analysisCancel'] as const)assert.deepEqual(await h.probe('b',c=>h.memory[method](c,id)),{status:'not_found'});
  const foreign=await h.evidence('b','其他来源');const own=(await search(h))[0]!;
  assert.deepEqual(await h.probe('b',c=>h.memory.analyze(c,{requestId:randomUUID(),sourceRefs:[foreign.ref],targetIds:[own.id]})),{status:'target_unavailable'});
  assert.equal((await search(h,'b')).length,0);
});

test('idempotent job retry and identical evidence do not duplicate memories',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const source=await h.evidence('a',sentence);h.setAnalysisResponse(()=>textReply(JSON.stringify(result())));
  const key=randomUUID(),first=await submit(h,source.ref,[],key);await settled(h,first.jobId);
  assert.equal((await submit(h,source.ref,[],key)).jobId,first.jobId);
  const second=await settled(h,(await submit(h,source.ref)).jobId);assert.equal(second.counts.committed,0);
  assert.equal((await search(h)).length,1);
  const other=await h.evidence('a','不同来源');
  assert.deepEqual(await h.probe('a',c=>h.memory.analyze(c,{requestId:key,sourceRefs:[other.ref]})),{status:'idempotency_conflict'});
});

test('deletion blocks queued raw-source extraction and hides already-produced analysis until explicit restore',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const source=await h.evidence('a',sentence);h.setAnalysisResponse(()=>textReply(JSON.stringify(result())));
  const id=(await submit(h,source.ref)).jobId;await settled(h,id);const item=(await search(h))[0]!;
  await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:item.id,expectedVersion:item.version,reason:'明确删除'}));
  assert.deepEqual(await inspect(h,id),{status:'deleted_source'});
  assert.deepEqual(await h.probe('a',c=>h.memory.analyze(c,{requestId:randomUUID(),sourceRefs:[source.ref]})),{status:'deleted_source'});
  assert.equal((await search(h)).length,0);
  await h.probe('a',c=>h.memory.restore(c,{requestId:randomUUID(),id:item.id,expectedVersion:2,reason:'明确恢复'}));
  assert.equal((await inspect(h,id)).status,'ok');
});

test('external mutation during model analysis causes version conflict without overwriting it',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const source=await h.evidence('a',sentence),entered=gate(),release=gate();
  h.setAnalysisResponse(async()=>{entered.release();await release.promise;return textReply(JSON.stringify(result()));});
  const id=(await submit(h,source.ref)).jobId;await entered.promise;
  await h.probe('a',c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:'外部新记忆',sourceRefs:[source.ref]}));
  release.release();await h.memory.whenAnalysisIdle();
  assert.match(JSON.stringify(await h.probe('a',c=>h.memory.analysisStatus(c,id))),/version_conflict/);
  const items=await search(h);assert.equal(items.length,1);assert.equal(items[0]!.content,'外部新记忆');
});

test('cancelled background model cannot commit and revoked grant cannot open sources',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const source=await h.evidence('a',sentence),entered=gate(),release=gate();
  h.setAnalysisResponse(async()=>{entered.release();await release.promise;return textReply(JSON.stringify(result()));});
  const id=(await submit(h,source.ref)).jobId;await entered.promise;
  await h.probe('a',c=>h.memory.analysisCancel(c,id));release.release();await h.memory.whenAnalysisIdle();
  assert.equal((await settled(h,id)).state,'cancelled');assert.equal((await search(h)).length,0);
  assert.equal(h.core.journal.events(source.message.route).filter(e=>e.type==='memory.analysis.finished'&&e.data.jobId===id).length,1);
  const db=new DatabaseSync(join(h.root,'analysis.sqlite'));let grant:string;
  try{grant=z.object({grantId:z.string()}).parse(JSON.parse(String(db.prepare('SELECT body FROM jobs WHERE id=?').get(id)?.body))).grantId;}finally{db.close();}
  await assert.rejects(h.timeline.openForAnalysis(grant!,{ref:source.ref},new AbortController().signal),/authorization unavailable/);
});

test('plugin restart retains completed jobs and does not resubmit model or old writes',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const source=await h.evidence('a',sentence);h.setAnalysisResponse(()=>textReply(JSON.stringify(result())));
  const id=(await submit(h,source.ref)).jobId;await settled(h,id);
  const calls=h.adapter.requests.filter(r=>String(r.sessionId).startsWith('memory-analysis-')).length;
  await h.memoryFiber.dispose();const restarted=await h.ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:h.root,analysis:{}});t.after(()=>restarted.dispose());h.ctx.dafeiyuMemory.recover();h.ctx.dafeiyuMemory.activate();
  await h.ctx.dafeiyuMemory.whenAnalysisIdle();
  assert.equal(h.adapter.requests.filter(r=>String(r.sessionId).startsWith('memory-analysis-')).length,calls);
  assert.equal(statusSchema.parse(await h.probe('a',c=>h.ctx.dafeiyuMemory.analysisStatus(c,id))).state,'completed');
  assert.equal(searchSchema.parse(await h.probe('a',c=>h.ctx.dafeiyuMemory.search(c,{}))).items.length,1);
});

for(const deleted of [false,true])test(`lost commit acknowledgement recovers exactly once (deleted=${deleted})`,async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const source=await h.evidence('a',sentence);h.setAnalysisResponse(()=>textReply(JSON.stringify(result())));
  const db=new DatabaseSync(join(h.root,'analysis.sqlite'));t.after(()=>db.close());
  db.exec(`CREATE TRIGGER simulated_ack_failure BEFORE UPDATE ON jobs WHEN NEW.body LIKE '%"status":"committed"%'
    BEGIN SELECT RAISE(FAIL,'Synthetic acknowledgement failure'); END;`);
  const id=(await submit(h,source.ref)).jobId;await h.memory.whenAnalysisIdle();
  assert.match(JSON.stringify(await h.probe('a',c=>h.memory.analysisStatus(c,id))),/worker_unavailable/);
  const item=(await search(h))[0]!;assert.equal(item.version,1);
  if(deleted)await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:item.id,expectedVersion:1,reason:'删除已写入但未确认的记录'}));
  const calls=h.adapter.requests.filter(r=>String(r.sessionId).startsWith('memory-analysis-')).length;
  db.exec('DROP TRIGGER simulated_ack_failure');
  await h.memoryFiber.dispose();const restarted=await h.ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:h.root,analysis:{}});t.after(()=>restarted.dispose());h.ctx.dafeiyuMemory.recover();h.ctx.dafeiyuMemory.activate();
  const memory=h.ctx.dafeiyuMemory;await memory.whenAnalysisIdle();
  assert.equal(statusSchema.parse(await h.probe('a',c=>memory.analysisStatus(c,id))).state,'completed');
  assert.equal(h.adapter.requests.filter(r=>String(r.sessionId).startsWith('memory-analysis-')).length,calls);
  assert.equal(searchSchema.parse(await h.probe('a',c=>memory.search(c,{}))).items.length,deleted?0:1);
  assert.equal(h.core.journal.events(source.message.route).filter(e=>e.type==='memory.created').length,1);
});

test('interrupted analysis restarts with a fresh isolated DSH attempt and durable authority',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const source=await h.evidence('a',sentence),entered=gate();
  h.setAnalysisResponse(async options=>{
    entered.release();await new Promise((_,reject)=>options.signal?.addEventListener('abort',()=>reject(new Error('test abort')),{once:true}));return [];
  });
  const id=(await submit(h,source.ref)).jobId;await entered.promise;await h.memoryFiber.dispose();
  h.setAnalysisResponse(()=>textReply(JSON.stringify(result())));
  const restarted=await h.ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:h.root,analysis:{}});t.after(()=>restarted.dispose());h.ctx.dafeiyuMemory.recover();h.ctx.dafeiyuMemory.activate();
  const memory=h.ctx.dafeiyuMemory;await memory.whenAnalysisIdle();
  const status=await h.probe('a',c=>memory.analysisStatus(c,id));assert.equal(statusSchema.parse(status).state,'completed');
  assert.match(JSON.stringify(status),/"attempts":2/);
  const sessions=h.adapter.requests.filter(r=>String(r.sessionId).startsWith('memory-analysis-')).map(r=>r.sessionId);
  assert.equal(new Set(sessions).size,2);
  assert.equal(searchSchema.parse(await h.probe('a',c=>memory.search(c,{}))).items.length,1);
});

test('source deletion while model is running blocks candidate publication',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const source=await h.evidence('a',sentence);
  const original=z.object({id:z.uuid()}).parse(await h.probe('a',c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:sentence,sourceRefs:[source.ref]})));
  const entered=gate(),release=gate();h.setAnalysisResponse(async()=>{entered.release();await release.promise;return textReply(JSON.stringify(result()));});
  const id=(await submit(h,source.ref)).jobId;await entered.promise;
  await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:original.id,expectedVersion:1,reason:'分析期间删除'}));
  release.release();assert.equal((await settled(h,id)).state,'failed');assert.equal((await search(h)).length,0);
});

test('different author cannot automatically replace a prior self-report',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const source=await h.evidence('a',sentence);h.setAnalysisResponse(()=>textReply(JSON.stringify(result())));
  await settled(h,(await submit(h,source.ref)).jobId);const item=(await search(h))[0]!;
  const correction='更正：晨露项目的代号改为青鱼888。';
  const receipt=h.simulator.send('a',correction,{id:randomUUID(),sender:'another-user'});await h.core.whenIdle();
  const message=h.core.journal.get(receipt.id),event=h.core.journal.events(message.route).find(e=>e.traceId===message.id&&e.type==='message.accepted')!;
  h.setAnalysisResponse(()=>textReply(JSON.stringify(result(correction,{action:'revise',targetId:item.id}))));
  const status=await settled(h,(await submit(h,`dafeiyu:source:${event.id}:0`,[item.id])).jobId);
  assert.equal(status.counts.review,1);assert.equal((await search(h))[0]!.version,1);
});

test('source text is read across pagination and oversize input is rejected before model work',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const text='晨露项目。'+'背景。'.repeat(700)+'末尾校验值琉璃923。';const source=await h.evidence('a',text);
  h.setAnalysisResponse(options=>{assert.match(JSON.stringify(options.messages),/琉璃923/);return textReply(JSON.stringify({...result(),claims:[]}));});
  assert.equal((await settled(h,(await submit(h,source.ref)).jobId)).state,'completed');
  const long=await h.evidence('a','甲'.repeat(12500));const before=h.adapter.requests.filter(r=>String(r.sessionId).startsWith('memory-analysis-')).length;
  assert.deepEqual(await h.probe('a',c=>h.memory.analyze(c,{requestId:randomUUID(),sourceRefs:[long.ref]})),{status:'input_too_large'});
  assert.equal(h.adapter.requests.filter(r=>String(r.sessionId).startsWith('memory-analysis-')).length,before);
});

test('analysis lookup output cannot be recycled as new primary evidence',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);
  const source=await h.evidence('a',sentence);h.setAnalysisResponse(()=>textReply(JSON.stringify(result())));
  const id=(await submit(h,source.ref)).jobId;await settled(h,id);await inspect(h,id);
  const message=h.core.journal.list().at(-1)!,completed=h.core.journal.events(message.route).findLast(e=>e.type==='turn.completed')!;
  const session=h.ctx.agents.get(SessionId(message.sessionId))!;
  const tool=session.session.snapshotEvents().findLast(e=>e.type==='tool/result')!;
  const index=completed.sources.findIndex(s=>s.kind==='session'&&s.seq===tool.seq);assert.ok(index>=0);
  assert.deepEqual(await h.probe('a',c=>h.memory.analyze(c,{requestId:randomUUID(),sourceRefs:[`dafeiyu:source:${completed.id}:${index}`]})),{status:'source_unavailable'});
});

test('reasoning blocks and opaque replay data never enter independent DSH history',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);const source=await h.evidence('a',sentence);
  h.setAnalysisResponse(()=>[
    {type:'block-start',index:0,blockType:'reasoning'},
    {type:'reasoning-delta',index:0,text:'PRIVATE_REASONING_SENTINEL'},
    {type:'block-end',index:0,block:{type:'reasoning',text:'PRIVATE_REASONING_SENTINEL'}},
    ...textReply(JSON.stringify(result())).filter(chunk=>chunk.type!=='finish').map(chunk=>'index' in chunk?{...chunk,index:1}:chunk),
    {type:'finish',reason:{kind:'stop'},replayState:{response:'PRIVATE_REPLAY_SENTINEL'}},
  ]);
  assert.equal((await settled(h,(await submit(h,source.ref)).jobId)).counts.committed,1);
  const directory=join(h.root,'analysis-sessions');
  const files=(await readdir(directory,{recursive:true})).filter(name=>name.endsWith('.jsonl'));
  assert.ok(files.length>0);
  for(const file of files){const text=await readFile(join(directory,file),'utf8');assert.ok(!text.includes('PRIVATE_REASONING_SENTINEL'));assert.ok(!text.includes('PRIVATE_REPLAY_SENTINEL'));}
});

test('same-topic additions are held for comparison instead of quietly contradicting existing memory',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);const source=await h.evidence('a',sentence);
  h.setAnalysisResponse(()=>textReply(JSON.stringify(result())));await settled(h,(await submit(h,source.ref)).jobId);
  const second='晨露项目的代号是金雨955。';const next=await h.evidence('a',second);h.setAnalysisResponse(()=>textReply(JSON.stringify(result(second))));
  const status=await settled(h,(await submit(h,next.ref)).jobId);assert.equal(status.counts.review,1);
  assert.equal((await search(h)).length,1);assert.match(JSON.stringify(await search(h)),/紫帆731/);
});

test('analysis audit outbox retries publication without duplicating delivered events',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);const source=await h.evidence('a',sentence);
  const original=h.core.journal.appendOnce.bind(h.core.journal);
  h.core.journal.appendOnce=(event,id)=>{if(event.type.startsWith('memory.analysis.'))throw new Error('synthetic audit unavailable');return original(event,id);};
  h.setAnalysisResponse(()=>textReply(JSON.stringify(result())));const id=(await submit(h,source.ref)).jobId;await settled(h,id);
  assert.equal(h.core.journal.events(source.message.route).filter(e=>e.type==='memory.analysis.finished').length,0);
  h.core.journal.appendOnce=original;await h.memoryFiber.dispose();
  const restarted=await h.ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:h.root,analysis:{}});t.after(()=>restarted.dispose());h.ctx.dafeiyuMemory.recover();h.ctx.dafeiyuMemory.activate();
  await h.ctx.dafeiyuMemory.whenAnalysisIdle();
  assert.equal(h.core.journal.events(source.message.route).filter(e=>e.type==='memory.analysis.finished').length,1);
  const events=h.core.journal.events(source.message.route).filter(e=>e.type.startsWith('memory.analysis.'));
  assert.equal(new Set(events.map(e=>e.id)).size,events.length);
});

test('analysis timeout remains a failed task with no write',async t=>{
  const h=await memoryFixture(undefined,{analysis:{timeoutMs:100}});t.after(h.close);const source=await h.evidence('a',sentence);
  h.setAnalysisResponse(async options=>{await new Promise((_,reject)=>options.signal?.addEventListener('abort',()=>reject(new Error('cancelled test')),{once:true}));return [];});
  const id=(await submit(h,source.ref)).jobId;await h.memory.whenAnalysisIdle();
  assert.match(JSON.stringify(await h.probe('a',c=>h.memory.analysisStatus(c,id))),/timeout/);assert.equal((await search(h)).length,0);
});

test('stale queued generation is rejected before any model invocation',async t=>{
  const h=await memoryFixture(undefined,{analysis:{}});t.after(h.close);const source=await h.evidence('a',sentence);
  h.setAnalysisResponse(()=>{assert.fail('Stale task must not call the model');});
  const submitted=await h.probe('a',async c=>{
    const job=await h.memory.analyze(c,{requestId:randomUUID(),sourceRefs:[source.ref]});
    await h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:'更新版本的外部写入',sourceRefs:[source.ref]});return job;
  });
  const id=statusSchema.parse(submitted).jobId;await h.memory.whenAnalysisIdle();
  assert.match(JSON.stringify(await h.probe('a',c=>h.memory.analysisStatus(c,id))),/version_conflict/);
  assert.equal(h.adapter.requests.filter(r=>String(r.sessionId).startsWith('memory-analysis-')).length,0);
});
