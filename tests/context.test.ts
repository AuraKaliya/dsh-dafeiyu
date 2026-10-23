import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { API_VERSION } from '@dafeiyu/contracts';
import type { ContextRequest } from '@dafeiyu/contracts';
import { z } from 'zod';
import { memoryFixture } from './memory-fixture.js';
import { textReply,call } from './harness.js';
import * as Memory from '@dafeiyu/memory';
import { MemoryStore } from '@dafeiyu/memory/store';
import type { OperationScope } from '@dafeiyu/contracts';
import { join } from 'node:path';
import { config,fakeDependencies } from './retrieval-fixture.js';

type H=Awaited<ReturnType<typeof memoryFixture>>;
const expires=()=>new Date(Date.now()+600000).toISOString();
const control=(options:GenerateOptions|undefined)=>JSON.stringify(options?.messages.filter(m=>m.role==='user'&&'source' in m&&String(m.source.kind)==='runtime-context')??[]);
const content=(h:H)=>control(h.adapter.requests.at(-1));
async function remembered(h:H,text='MEMORY_ALPHA',room='a'){
  const evidence=await h.evidence(room,'虚构资料来源');
  const receipt=z.object({status:z.literal('ok'),id:z.uuid()}).parse(await h.probe(room,c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:text,sourceRefs:[evidence.ref]})));
  let selected!: {id:string;revision:number;version:number;contentHash:string;start:number;end:number;ref:string};
  await h.probe(room,c=>{
    const item=z.object({item:z.object({id:z.string(),revision:z.number(),version:z.number(),contentHash:z.string(),content:z.string(),ref:z.string()})}).parse(h.memory.read(c,{id:receipt.id})).item;
    selected={id:item.id,revision:item.revision,version:item.version,contentHash:item.contentHash,start:0,end:Array.from(item.content).length,ref:item.ref};return {loaded:true};
  });
  return {selected,evidence};
}
const select=(h:H,items:Awaited<ReturnType<typeof remembered>>['selected'][],expectedVersion=0,taskId='fictional-task',room='a')=>h.probe(room,c=>h.memory.selectContext(c,{
  requestId:randomUUID(),expectedVersion,taskId,expiresAt:expires(),items:items.map(({ref:_ref,...item})=>item),
}));
async function turn(h:H,room='a'){
  h.setResponse(()=>textReply('虚构回答'));const receipt=h.simulator.send(room,'继续任务',{id:randomUUID()});await h.core.whenIdle();return h.core.journal.get(receipt.id);
}
function second(h:H){
  let state='SECOND_PLUGIN_VALID',version=1,enabled=true;
  const validUntil=expires();
  const handle=h.core.registerExtension({id:'fictional-tasks',version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',contexts:[{
    id:'progress',kind:'operational-fact',prepare:async request=>request.conversation.id==='a'&&enabled?[{
      id:'progress',version:String(version),text:state,expiresAt:validUntil,sources:[{ref:'fictional:task-progress',version:String(version),hash:'test'}],
    }]:[],validate:(_request,item)=>enabled&&item.version===String(version),
  }]});
  return {handle,change:(text:string)=>{state=text;version++;},disable:()=>{enabled=false;}};
}

test('DSH carrier composes work, selected evidence and a second plugin without promoting them to system instructions',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const plugin=second(h);t.after(()=>plugin.handle.dispose());
  const a=await remembered(h),b=await remembered(h,'UNSELECTED_MEMORY');
  assert.equal((await select(h,[a.selected])).status,'ok');
  const work=await h.probe('a',c=>h.memory.updateWorking(c,{requestId:randomUUID(),expectedVersion:0,taskId:'fictional-task',expiresAt:expires(),
    items:[{id:'goal',category:'goal',text:'WORKING_GOAL',sourceRefs:[a.selected.ref]}]}));assert.equal(work.status,'ok');
  assert.match(content(h),/WORKING_GOAL/);assert.match(content(h),/MEMORY_ALPHA/);assert.match(content(h),/SECOND_PLUGIN_VALID/);
  assert.ok(!content(h).includes('UNSELECTED_MEMORY'));
  const system=h.adapter.requests.at(-1)!.messages.filter(m=>m.role==='system');assert.ok(!JSON.stringify(system).includes('MEMORY_ALPHA'));
  assert.ok(b.selected.id);
});

test('deleting selected memory retires historical carrier text but preserves second-plugin and native DSH regions',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const plugin=second(h);t.after(()=>plugin.handle.dispose());
  h.ctx.systemPrompt.context({name:'native-required-fixture',order:1,required:true,text:'NATIVE_STILL_VALID'});
  const a=await remembered(h);await select(h,[a.selected]);assert.match(content(h),/MEMORY_ALPHA/);
  await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:a.selected.id,expectedVersion:1,reason:'明确删除'}));
  assert.ok(!content(h).includes('MEMORY_ALPHA'));assert.match(content(h),/SECOND_PLUGIN_VALID/);assert.match(content(h),/NATIVE_STILL_VALID/);
  const agent=h.ctx.agents.get(SessionId(a.evidence.message.sessionId))!;
  assert.ok(JSON.stringify(agent.session.snapshotEvents()).includes('MEMORY_ALPHA'));
  assert.ok(!JSON.stringify(agent.session.deriveMessages()).includes('MEMORY_ALPHA'));
  assert.ok(agent.session.snapshotEvents().some(e=>'surfaceOp' in e&&typeof e.surfaceOp==='object'));
});

test('selective invalidation keeps a valid memory in the same evidence region',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const a=await remembered(h),b=await remembered(h,'MEMORY_BETA');
  await select(h,[a.selected,b.selected]);assert.match(content(h),/MEMORY_ALPHA/);assert.match(content(h),/MEMORY_BETA/);
  await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:a.selected.id,expectedVersion:1,reason:'删除A'}));
  assert.ok(!content(h).includes('MEMORY_ALPHA'));assert.match(content(h),/MEMORY_BETA/);
});

test('work-state replacement and task change retire old work and incompatible evidence together',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const a=await remembered(h);await select(h,[a.selected]);
  const update=(version:number,taskId:string,text:string)=>h.probe('a',c=>h.memory.updateWorking(c,{requestId:randomUUID(),expectedVersion:version,taskId,expiresAt:expires(),items:[{id:'goal',category:'goal',text,sourceRefs:[a.evidence.ref]}]}));
  assert.equal((await update(0,'fictional-task','OLD_WORK')).status,'ok');assert.match(content(h),/MEMORY_ALPHA/);
  assert.equal((await update(1,'another-task','NEW_WORK')).status,'ok');assert.ok(!content(h).includes('OLD_WORK'));assert.ok(!content(h).includes('MEMORY_ALPHA'));assert.match(content(h),/NEW_WORK/);
  assert.equal((await update(1,'another-task','STALE_WORK')).status,'version_conflict');assert.ok(!content(h).includes('STALE_WORK'));
});

test('each conversation has separate selected state and cannot select another conversation memory',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const a=await remembered(h),b=await remembered(h,'B_ONLY','b');
  await select(h,[a.selected]);await turn(h,'b');assert.ok(!content(h).includes('MEMORY_ALPHA'));
  assert.equal((await select(h,[a.selected],0,'fictional-task','b')).status,'source_unavailable');
  assert.equal((await select(h,[b.selected],0,'fictional-task','b')).status,'ok');assert.match(content(h),/B_ONLY/);
  await turn(h,'a');assert.match(content(h),/MEMORY_ALPHA/);assert.ok(!content(h).includes('B_ONLY'));
});

test('revision changes invalidate selected versions; restore alone does not reactivate stale selection',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const a=await remembered(h);await select(h,[a.selected]);
  await h.probe('a',c=>h.memory.revise(c,{requestId:randomUUID(),id:a.selected.id,expectedVersion:1,kind:'knowledge',claimType:'self_report',content:'CHANGED_MEMORY',sourceRefs:[a.evidence.ref]}));
  assert.ok(!content(h).includes('MEMORY_ALPHA'));assert.ok(!content(h).includes('CHANGED_MEMORY'));
  assert.equal((await select(h,[a.selected],1)).status,'source_unavailable');
  await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:a.selected.id,expectedVersion:2,reason:'删除'}));
  await h.probe('a',c=>h.memory.restore(c,{requestId:randomUUID(),id:a.selected.id,expectedVersion:3,reason:'恢复'}));
  assert.ok(!content(h).includes('CHANGED_MEMORY'));
});

test('unregistering one contributor removes its old text and leaves others intact',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const plugin=second(h);const a=await remembered(h);await select(h,[a.selected]);
  plugin.handle.dispose();await turn(h);assert.ok(!content(h).includes('SECOND_PLUGIN_VALID'));assert.match(content(h),/MEMORY_ALPHA/);
  await h.memoryFiber.dispose();await turn(h);assert.ok(!content(h).includes('MEMORY_ALPHA'));
});

test('central priority and byte budgets omit whole optional items without truncating another region',async t=>{
  const h=await memoryFixture(undefined,{context:{}},undefined,{maxBytes:850,regions:{'fictional-tasks:progress':{priority:900,maxBytes:800},'memory:evidence':{priority:100,maxBytes:800}}});
  t.after(h.close);const plugin=second(h);t.after(()=>plugin.handle.dispose());
  const a=await remembered(h,'MEMORY_ALPHA'.repeat(50));await select(h,[a.selected]);
  assert.match(content(h),/SECOND_PLUGIN_VALID/);assert.ok(!content(h).includes('MEMORY_ALPHA'));
  const message=h.core.journal.list().at(-1)!;const audit=h.core.journal.events(message.route).findLast(e=>e.type==='context.admitted');assert.ok(audit);
  assert.ok(Number(audit.data.bytes)<=850);assert.ok(!JSON.stringify(audit).includes('SECOND_PLUGIN_VALID'));
});

test('oversized required contributor stops request before adapter dispatch',async t=>{
  const h=await memoryFixture(undefined,{context:{}},undefined,{maxBytes:100,regions:{'fictional-tasks:progress':{required:true,maxBytes:50}}});t.after(h.close);
  const plugin=second(h);t.after(()=>plugin.handle.dispose());const before=h.adapter.requests.length;
  const message=await turn(h);assert.equal(message.state,'failed');assert.equal(h.adapter.requests.length,before);
});

test('model loop reassembles after a tool clears selected evidence in the same turn',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const plugin=second(h);t.after(()=>plugin.handle.dispose());const a=await remembered(h);await select(h,[a.selected]);
  let step=0;h.setResponse(options=>{step++;if(step===1){assert.match(control(options),/MEMORY_ALPHA/);return call('dafeiyu_memory_context_clear',{requestId:randomUUID(),kind:'evidence',expectedVersion:'1'});}
    assert.ok(!control(options).includes('MEMORY_ALPHA'));assert.match(control(options),/SECOND_PLUGIN_VALID/);return textReply('已清空');});
  h.simulator.send('a','清空证据区域',{id:randomUUID()});await h.core.whenIdle();assert.equal(step,2);
});

test('context scopes reject cloned and expired requests and model-supplied route fields',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);let saved:ContextRequest|undefined;
  const handle=h.core.registerExtension({id:'scope-probe',version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',contexts:[{
    id:'probe',kind:'operational-fact',prepare:async request=>{saved=request;assert.throws(()=>h.core.scopeForContext({...request}),/core-issued/);return [];},validate:()=>true,
  }]});t.after(()=>handle.dispose());await turn(h);assert.ok(saved);assert.throws(()=>h.core.scopeForContext(saved!),/core-issued/);
  const a=await remembered(h);assert.equal((await h.probe('a',c=>h.memory.selectContext(c,{requestId:randomUUID(),expectedVersion:0,taskId:'t',expiresAt:expires(),items:[],route:a.evidence.message.route}))).status,'invalid_input');
});

test('persisted selections recover after plugin reload and old carrier is cleared if plugin is absent',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const a=await remembered(h);await select(h,[a.selected]);
  await h.memoryFiber.dispose();await turn(h);assert.ok(!content(h).includes('MEMORY_ALPHA'));
  const fiber=await h.ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:h.root,context:{}});t.after(()=>fiber.dispose());
  await turn(h);assert.match(content(h),/MEMORY_ALPHA/);
});

test('internal retrieval selects matching chunks without exposing the full search hit list',async t=>{
  const fake=fakeDependencies(),h=await memoryFixture(undefined,{context:{},retrieval:config},fake.dependency);t.after(h.close);
  await remembered(h,'月舟保管备用雨伞，放在蓝色柜子。');await remembered(h,'UNSELECTED_CAKE_DOCUMENT');
  const result=await h.probe('a',c=>h.memory.retrieveContext(c,{requestId:randomUUID(),expectedVersion:0,taskId:'fictional-task',expiresAt:expires(),query:'月舟雨伞',strategy:'hybrid',limit:1}));
  assert.equal(result.status,'ok');assert.ok(fake.calls.length>0);
  assert.ok(!JSON.stringify(result).includes('月舟'));assert.ok(!JSON.stringify(result).includes('items'));
  assert.match(content(h),/月舟/);assert.ok(!content(h).includes('UNSELECTED_CAKE_DOCUMENT'));
  assert.ok(!JSON.stringify(h.adapter.requests.at(-1)!.messages).includes('UNSELECTED_CAKE_DOCUMENT'));
});

test('expiration retires evidence while the second contributor remains valid',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const plugin=second(h);t.after(()=>plugin.handle.dispose());const a=await remembered(h);
  const {ref:_ref,...item}=a.selected;
  assert.equal((await h.probe('a',c=>h.memory.selectContext(c,{requestId:randomUUID(),expectedVersion:0,taskId:'t',expiresAt:new Date(Date.now()+250).toISOString(),items:[item]}))).status,'ok');
  assert.match(content(h),/MEMORY_ALPHA/);await new Promise(r=>setTimeout(r,300));await turn(h);
  assert.ok(!content(h).includes('MEMORY_ALPHA'));assert.match(content(h),/SECOND_PLUGIN_VALID/);
});

test('deleted memory ancestry also removes dependent working state and evidence',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const a=await remembered(h);
  await h.probe('a',c=>h.memory.updateWorking(c,{requestId:randomUUID(),expectedVersion:0,taskId:'fictional-task',expiresAt:expires(),items:[{id:'goal',category:'goal',text:'DERIVED_WORK',sourceRefs:[a.selected.ref]}]}));
  assert.match(content(h),/DERIVED_WORK/);await select(h,[a.selected]);
  await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:a.selected.id,expectedVersion:1,reason:'删除依据'}));
  assert.ok(!content(h).includes('DERIVED_WORK'));assert.ok(!content(h).includes('MEMORY_ALPHA'));
});

test('version change during model route resolution is caught at final DSH admission',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const plugin=second(h);t.after(()=>plugin.handle.dispose());const a=await remembered(h);await select(h,[a.selected]);
  let scope!:OperationScope;await h.probe('a',c=>{scope=h.core.scopeFor(c);return {ready:true};});
  const store=new MemoryStore(join(h.root,'memory.sqlite'));t.after(()=>store.close());
  const original=h.adapter.resolveModel.bind(h.adapter);let armed=true;
  h.adapter.resolveModel=async(...args)=>{if(armed){armed=false;store.mutate(scope,{action:'delete',requestId:randomUUID(),id:a.selected.id,expectedVersion:1,reason:'解析模型期间删除'});}return original(...args);};
  assert.equal((await turn(h)).state,'delivered');assert.ok(!content(h).includes('MEMORY_ALPHA'));assert.match(content(h),/SECOND_PLUGIN_VALID/);
});

test('a source change after dispatch prevents delivery of the obsolete answer',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const a=await remembered(h);await select(h,[a.selected]);
  let scope!:OperationScope;await h.probe('a',c=>{scope=h.core.scopeFor(c);return {ready:true};});
  const store=new MemoryStore(join(h.root,'memory.sqlite'));t.after(()=>store.close());
  const before=h.simulator.deliveries.length;
  h.setResponse(()=>{store.mutate(scope,{action:'delete',requestId:randomUUID(),id:a.selected.id,expectedVersion:1,reason:'流式输出期间删除'});return textReply('不应交付的旧答案');});
  const receipt=h.simulator.send('a','继续',{id:randomUUID()});await h.core.whenIdle();
  assert.equal(h.core.journal.get(receipt.id).state,'failed');assert.equal(h.simulator.deliveries.length,before);
  await turn(h);assert.ok(!content(h).includes('MEMORY_ALPHA'));
});

test('native DSH context growth is included in the final shared request budget',async t=>{
  const h=await memoryFixture(undefined,{context:{}},undefined,{requestMaxBytes:100000,outputReserveBytes:0});t.after(h.close);
  let native='NATIVE_SMALL';h.ctx.systemPrompt.context({name:'native-growing',order:0,required:true,text:()=>native});
  await turn(h);const before=h.adapter.requests.length;native='大'.repeat(50000);
  assert.equal((await turn(h)).state,'failed');assert.equal(h.adapter.requests.length,before);
});

test('optional contributor timeout retires old data without disabling another plugin',async t=>{
  const h=await memoryFixture(undefined,{context:{}},undefined,{prepareTimeoutMs:50});t.after(h.close);const plugin=second(h);t.after(()=>plugin.handle.dispose());
  let slow=false;const fixedExpiry=expires();
  const handle=h.core.registerExtension({id:'slow-fixture',version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',contexts:[{
    id:'result',kind:'evidence',prepare:async request=>{
      if(slow)await new Promise((_,reject)=>request.signal.addEventListener('abort',()=>reject(new Error('test timeout')),{once:true}));
      return [{id:'s',version:'1',text:'SLOW_OLD_CONTENT',expiresAt:fixedExpiry,sources:[{ref:'fictional:slow',version:'1',hash:'test'}]}];
    },validate:()=>true,
  }]});t.after(()=>handle.dispose());await turn(h);assert.match(content(h),/SLOW_OLD_CONTENT/);
  slow=true;await turn(h);assert.ok(!content(h).includes('SLOW_OLD_CONTENT'));assert.match(content(h),/SECOND_PLUGIN_VALID/);
});

test('duplicate or invalid region registration does not displace a live contributor',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const plugin=second(h);t.after(()=>plugin.handle.dispose());
  const c={id:'same',kind:'evidence' as const,prepare:async()=>[],validate:()=>true};
  assert.throws(()=>h.core.registerExtension({id:'bad-regions',version:'1',agentId:'dafeiyu',apiVersion:API_VERSION,contexts:[c,c]}),/Duplicate/);
  await turn(h);assert.match(content(h),/SECOND_PLUGIN_VALID/);assert.ok(!h.core.getStatus().extensions.includes('bad-regions'));
});

test('full host restart reconstructs selections and retires a provider absent after restart',async()=>{
  const h=await memoryFixture(undefined,{context:{}});const root=h.root;
  try{second(h);const a=await remembered(h);await select(h,[a.selected]);assert.match(content(h),/SECOND_PLUGIN_VALID/);}finally{await h.close();}
  const restored=await memoryFixture(root,{context:{}});
  try{await turn(restored);assert.match(content(restored),/MEMORY_ALPHA/);assert.ok(!content(restored).includes('SECOND_PLUGIN_VALID'));}finally{await restored.close();}
});

test('independent analysis reports do not automatically populate working or evidence regions',async t=>{
  const h=await memoryFixture(undefined,{context:{},analysis:{}});t.after(h.close);const source=await h.evidence();
  h.setAnalysisResponse(()=>textReply(JSON.stringify({schemaVersion:1,overview:'FULL_ANALYSIS_PRIVATE_SENTINEL',gaps:[],claims:[]})));
  assert.equal((await h.probe('a',c=>h.memory.analyze(c,{requestId:randomUUID(),sourceRefs:[source.ref]}))).status,'ok');
  await h.memory.whenAnalysisIdle();await turn(h);
  assert.ok(!content(h).includes('FULL_ANALYSIS_PRIVATE_SENTINEL'));
  const state=await h.probe('a',c=>h.memory.contextStatus(c));assert.ok(z.object({areas:z.array(z.object({version:z.number()}))}).parse(state).areas.every(a=>a.version===0));
});

test('unchanged controlled context does not append a fresh snapshot on each turn',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const a=await remembered(h);await select(h,[a.selected]);
  const agent=h.ctx.agents.get(SessionId(a.evidence.message.sessionId))!;
  const count=()=>agent.session.snapshotEvents().filter(e=>e.type==='user/message'&&String(e.data.source.kind)==='runtime-context').length;
  const before=count();await turn(h);await turn(h);assert.equal(count(),before);assert.match(content(h),/MEMORY_ALPHA/);
});

test('working state writes are idempotent, versioned, and reject changed reuse of a request id',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const a=await remembered(h);
  const input={requestId:randomUUID(),expectedVersion:0,taskId:'fictional-task',expiresAt:expires(),items:[{id:'goal',category:'goal',text:'VERSIONED_WORK',sourceRefs:[a.selected.ref]}]};
  const first=await h.probe('a',c=>h.memory.updateWorking(c,input));assert.equal(first.status,'ok');
  const duplicate=await h.probe('a',c=>h.memory.updateWorking(c,input));assert.equal(z.object({duplicate:z.boolean()}).parse(duplicate).duplicate,true);
  assert.equal((await h.probe('a',c=>h.memory.updateWorking(c,{...input,taskId:'changed'}))).status,'idempotency_conflict');
  assert.equal((await h.probe('a',c=>h.memory.updateWorking(c,{...input,requestId:randomUUID()}))).status,'version_conflict');
});

test('forged hashes and invalid Unicode ranges are rejected without activating a selection',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const a=await remembered(h,'虚构中文🙂材料');
  assert.equal((await select(h,[{...a.selected,contentHash:'0'.repeat(64)}])).status,'source_unavailable');
  assert.equal((await select(h,[{...a.selected,end:9999}])).status,'source_unavailable');
  assert.equal((await select(h,[{...a.selected,start:3,end:4}])).status,'ok');assert.match(content(h),/文/);
});

test('a centrally required contributor cannot silently disappear on unregister',async t=>{
  const h=await memoryFixture(undefined,{context:{}},undefined,{regions:{'fictional-tasks:progress':{required:true}}});t.after(h.close);
  const plugin=second(h);assert.equal((await turn(h)).state,'delivered');plugin.handle.dispose();
  const before=h.adapter.requests.length;assert.equal((await turn(h)).state,'failed');assert.equal(h.adapter.requests.length,before);
});

test('native-only changes preserve the managed carrier exactly once and keep native sections',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const a=await remembered(h);let native='NATIVE_ONE';
  h.ctx.systemPrompt.context({name:'native-changing',order:1,text:()=>native});await select(h,[a.selected]);
  native='NATIVE_TWO';const calls=h.adapter.requests.length;assert.equal((await turn(h)).state,'delivered');assert.equal(h.adapter.requests.length,calls+1);
  assert.match(content(h),/NATIVE_TWO/);assert.match(content(h),/MEMORY_ALPHA/);
  const count=(content(h).match(/dafeiyu:controlled-context:v1/g)??[]).length;assert.equal(count,1);
  await turn(h);assert.equal((content(h).match(/dafeiyu:controlled-context:v1/g)??[]).length,1);
});

test('native refresh during asynchronous route resolution cannot duplicate managed memory',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const a=await remembered(h);let native='BEFORE_RESOLUTION';
  h.ctx.systemPrompt.context({name:'native-late',order:2,text:()=>native});await select(h,[a.selected]);
  const original=h.adapter.resolveModel.bind(h.adapter);h.adapter.resolveModel=async(...args)=>{native='AFTER_RESOLUTION';return original(...args);};
  assert.equal((await turn(h)).state,'delivered');assert.match(content(h),/AFTER_RESOLUTION/);assert.match(content(h),/MEMORY_ALPHA/);
  assert.equal((content(h).match(/dafeiyu:controlled-context:v1/g)??[]).length,1);
});

test('unregister during preparation immediately revokes its live context authority',async t=>{
  const h=await memoryFixture(undefined,{context:{}});t.after(h.close);const plugin=second(h);t.after(()=>plugin.handle.dispose());
  let verified=false;
  const handle=h.core.registerExtension({id:'revoking-provider',version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',contexts:[{
    id:'ephemeral',kind:'evidence',prepare:async request=>{
      h.core.scopeForContext(request);handle.dispose();assert.throws(()=>h.core.scopeForContext(request));verified=true;return [];
    },validate:()=>true,
  }]});
  assert.equal((await turn(h)).state,'delivered');assert.equal(verified,true);assert.match(content(h),/SECOND_PLUGIN_VALID/);
});
