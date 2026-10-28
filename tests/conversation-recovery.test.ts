import {fixtureAction} from './fixture-action.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {API_VERSION} from '@dafeiyu/contracts';
import type {GenerateOptions,StreamChunk} from '@deepseek-ai/dsh-llm';
import {qqCapabilityFixture,bot,group,owner,until} from './qq-capabilities-fixture.js';
import {textReply,call} from './harness.js';
import {provenanceFixture} from './provenance-fixture.js';
import {SourceTracker} from '../packages/core/lib/provenance.js';
import {conversationHistory} from '../packages/core/lib/history-frame.js';
import {pluginRecordOf} from '@deepseek-ai/dsh-session';
import type {CompactionProvider} from '@dafeiyu/contracts';
const failed=():StreamChunk[]=>[{type:'finish',reason:{kind:'error',failure:{code:'FIXTURE_FAILURE',message:'PRIVATE_PROVIDER_DETAIL'}}}];
function input(options:GenerateOptions):Record<string,unknown>{const m=options.messages.findLast(m=>m.role==='user'&&m.source?.kind==='user');return JSON.parse(m?.content.filter(c=>c.type==='text').map(c=>c.text).join('')??'{}') as Record<string,unknown>;}
test('a failed QQ turn reports a persona status once, preserving failure and earlier operation receipts',async t=>{
  const h=await qqCapabilityFixture({extraConversationActions:['fixture_write']});t.after(h.close);let calls=0,recoveries=0,writes=0;
  h.core.registerExtension({id:'recovery-fixture',version:'1',protocolVersion:4,agentId:'dafeiyu',actions:[fixtureAction(h.core,'recovery-fixture',{id:'fixture_write',description:'本机虚构写入',inputSchema:z.strictObject({}),work:async()=>({saved:++writes})})]});
  h.setResponse(options=>{if(String(options.sessionId).startsWith('dafeiyu-recovery-')){recoveries++;assert.equal(options.tools?.length??0,0);assert.doesNotMatch(JSON.stringify(input(options)),/PRIVATE_PROVIDER_DETAIL/);return textReply(JSON.stringify({next:'wait',message:'刚才的记录已经保存，后续回答没有完成；我保留了进度。'}));}return ++calls===1?call('fixture_write',{}):failed();});
  await h.message('请处理这件事',{trigger:true,id:'9401'});const item=h.core.journal.list()[0]!;assert.equal(item.state,'failed');assert.equal(writes,1);assert.equal(recoveries,1);assert.equal(h.platform.sent.length,1);
  const events=h.core.journal.events(item.route).filter(e=>e.traceId===item.id);assert.ok(events.some(e=>e.type==='turn.failed'));assert.equal(events.filter(e=>e.type==='recovery.notice.sent').length,1);assert.equal(events.find(e=>e.type==='recovery.notice.prepared')?.data.fallback,false);assert.equal(events.filter(e=>e.type==='operation.succeeded').length,1);
  await h.message('请处理这件事',{trigger:true,id:'9401'});assert.equal(writes,1);assert.equal(h.platform.sent.length,1);
});
test('a failed recovery model cannot dispatch tools and receives one clearly marked system fallback',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);let attempted=0;
  h.setResponse(options=>String(options.sessionId).startsWith('dafeiyu-recovery-')?(attempted++,call('qq_groups',{})):failed());
  await h.message('故障恢复',{trigger:true,id:'9402'});assert.equal(attempted,1);assert.equal(h.platform.sent.length,1);assert.match(JSON.stringify(h.platform.sent),/系统状态/);assert.doesNotMatch(JSON.stringify(h.platform.sent),/PRIVATE_PROVIDER_DETAIL/);
  const item=h.core.journal.list()[0]!;assert.equal(h.core.journal.events(item.route).filter(e=>e.type==='operation.started').length,0);
});
for(const choice of ['resume','supersede','wait'] as const)test(`new message enters a model decision stage and ${choice} preserves confirmed segments`,async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);const original='甲'.repeat(4000)+'乙'.repeat(4000);let normal=0,decisions=0,emitted=false;
  h.setResponse(options=>{if(String(options.sessionId).startsWith('dafeiyu-reply-decision-')){decisions++;const pending=input(options).pending as {inboundId:string}[];assert.equal(options.tools?.length??0,0);return textReply(JSON.stringify({decisions:pending.map(p=>({inboundId:p.inboundId,action:choice}))}));}return textReply(++normal===1?original:'已收到补充');});
  h.platform.beforeVerify=async()=>{if(h.platform.sent.length!==1||emitted)return;emitted=true;const received=h.ctx.dafeiyuQQ.getStatus().counters.received;h.emit({post_type:'message',self_id:Number(bot),message_id:9502,message_type:'group',group_id:Number(group),user_id:Number(owner),time:Math.ceil(Date.now()/1000),message:[{type:'text',data:{text:choice==='resume'?'补充一下，请继续前面的说明':'换个问题，前面未说完的不用继续'}}],sender:{nickname:'虚构主人'}});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received>received);};
  await h.message('先解释第一件事',{trigger:true,id:'9501'});await until(()=>h.core.journal.list().length===2);await h.core.whenIdle();const first=h.core.journal.list()[0]!;
  const progress=h.ctx.dafeiyuQQ.deliveryStatus(first.reply!.id)!;assert.equal(decisions,1,JSON.stringify({state:first.state,progress,events:h.core.journal.events(first.route).filter(e=>e.type.startsWith('reply.')||e.type.startsWith('delivery.')).map(e=>({type:e.type,data:e.data}))}));assert.equal(first.state,choice==='resume'?'delivered':choice==='supersede'?'handled':'uncertain');
  assert.equal(progress.unknown,0);if(choice==='resume'){assert.equal(progress.pending,0);const texts=h.platform.sent.flatMap(m=>(m.message as {type:string;data:{text?:string}}[]).filter(p=>p.type==='text').map(p=>p.data.text??''));assert.equal(texts.filter(s=>/^[甲乙]+$/.test(s)).join(''),original);}else{assert.equal(progress.confirmed,1);assert.ok(progress.pending>0);}
});
test('source rejection records the exact dependency and phase without copying its text',async t=>{
  const h=await provenanceFixture();t.after(h.close);const item=await h.run('测试来源诊断');let valid=true;
  const provider:CompactionProvider={policy:{inputTokens:100000,thresholdRatio:0.8,targetRatio:0.6,minGrowthTokens:0,minSavingsTokens:1,cooldownMs:0,retainTurns:1,maxSourceBytes:10000,maxSummaryChars:1000},basis:()=>({epoch:'stable',taskId:null,versions:{}}),summarizeFragments:async()=>[],sources:{inbound:()=>[],context:()=>[],tool:()=>[],validate:()=>true}};
  const tracker=new SourceTracker('dafeiyu',()=>({owner:'memory',version:'1',provider}),{sourceItems:()=>[{owner:'fixture',region:'pending',item:{id:'precise-source',version:'1',text:'PRIVATE_DIAGNOSTIC_BODY',sources:[{ref:'fixture:status',version:'1',hash:'fixture'}],expiresAt:'9999-12-31T23:59:59.999Z'}}],nativeDependencies:()=>[],validateHistorical:()=>valid,explainHistorical:()=> 'context-version-changed'});
  tracker.begin(conversationHistory(item),h.session(),0);tracker.admit(h.adapter.requests.at(-1)!);valid=false;assert.throws(()=>tracker.guard(),/SOURCE_VALIDATION_FAILED/);
  const record=h.session().snapshotEvents().map(pluginRecordOf).findLast(r=>r?.type==='plugin:dafeiyu/source-invalid');assert.equal(record?.type,'plugin:dafeiyu/source-invalid');if(record?.type!=='plugin:dafeiyu/source-invalid')throw new Error('Missing diagnosis');
  const diagnostic=z.object({reason:z.string(),phase:z.string(),dependency:z.object({kind:z.string()}),dependencyHash:z.string()}).parse(record.data);assert.equal(diagnostic.reason,'context-version-changed');assert.equal(diagnostic.phase,'stream');assert.equal(diagnostic.dependency.kind,'context');assert.equal(diagnostic.dependencyHash.length,64);assert.doesNotMatch(JSON.stringify(record.data),/PRIVATE_DIAGNOSTIC_BODY/);
});
