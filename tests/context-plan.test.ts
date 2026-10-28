import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {admitContext,admitNativeContexts,contextManifest,requestCapacity,inspectRequestCapacity} from '../packages/core/lib/context-plan.js';
import {Context} from '@deepseek-ai/cordis';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {ContextCoordinator} from '../packages/core/lib/context.js';
import {PersonaRuntime} from '../packages/core/lib/persona-runtime.js';
import {ContextBudgetSchema} from '@dafeiyu/contracts';
import type {PersonaAccess,PreparedPersonaEntry} from '@dafeiyu/contracts';
import type {ContextGroup} from '../packages/core/lib/context-plan.js';
import {memoryFixture} from './memory-fixture.js';
import {textReply} from './harness.js';

const item=(id:string,length=50)=>({id,version:'1',text:id+'x'.repeat(length),expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:'fixture:'+id,version:'1',hash:'fixture'}]});
const group=(region:string,required=false,priority=100):ContextGroup=>({owner:'memory',region,kind:'evidence',items:[item(region,600)],required,priority,maxBytes:2000,validate:()=>true});
test('mandatory materials reserve capacity ahead of higher priority optional data',()=>{
  const result=admitContext([group('optional',false,900),group('growth',true,400)],1300);
  assert.deepEqual(result.regions.map(r=>r.region),['growth']);assert.equal(result.decisions[1]?.overBudget,1);
  assert.ok(!JSON.stringify(contextManifest('conversation',result)).includes('growthxxx'));
});
test('mandatory invalid and over-capacity data fail instead of becoming an empty persona',()=>{
  assert.throws(()=>admitContext([group('growth',true)],100),/Required context exceeds budget/);
  assert.throws(()=>admitContext([{...group('growth',true),validate:()=>false}],2000),/Required context stale/);
  assert.deepEqual(admitContext([{...group('growth',true),items:[]}],2000).regions,[]);
});
test('optional invalid and duplicate items are omitted without slicing evidence',()=>{
  const a=item('valid');const result=admitContext([{...group('evidence'),items:[a,a,item('stale')],validate:entry=>entry.id!=='stale'}],2000);
  assert.equal(result.regions[0]?.items.length,1);assert.equal(result.decisions[0]?.invalid,1);assert.equal(result.regions[0]?.items[0]?.text,a.text);
});
test('native task context shares required admission and counts the serialized envelope',()=>{
  const result=admitNativeContexts([{owner:'fixture',region:'large',item:item('large',1000)},{owner:'memory',region:'growth',item:item('self',300)}],1000);
  assert.equal(result.contexts.length,1);assert.equal(result.contexts[0]?.region,'growth');assert.ok(Buffer.byteLength(result.packet.text)<=1000);
  const material=[{owner:'fixture',region:'facts',item:item('facts',600)}];
  assert.equal(admitNativeContexts(material,2000,{'fixture:facts':{maxBytes:200,required:false,priority:100}}).contexts.length,0);
  assert.throws(()=>admitNativeContexts(material,2000,{'fixture:facts':{maxBytes:200,required:true,priority:100}}),/Required context exceeds budget/);
});
test('full capacity includes schemas, tool history and output reserve, measured in bytes',()=>{
  const result=requestCapacity({messages:[{text:'中文'}],tools:[{schema:'x'.repeat(800)}],toolHistory:'x'.repeat(200)},1100,100);
  assert.equal(result.withinBudget,false);assert.equal(result.measurement,'utf8-serialized-bytes');assert.ok(result.categories.tools>800);
});

test('the declared model window still rejects oversized history below the byte ceiling',async()=>{
  await assert.rejects(inspectRequestCapacity(new Context(),{provider:'fixture',model:'fixture',maxTokens:8192,
    messages:[createUserMessage({source:{kind:'user'},content:[{type:'text',text:'x'.repeat(200000)}]})]},1000000,0,
    {provider:'fixture',id:'fixture',name:'fixture',context:{contextWindow:65536},defaultMaxTokens:8192}),/MODEL_CONTEXT_CAPACITY/);
});
test('unified persona preparation cannot silently drop an already qualified selected personality',()=>{
  const runtime=new PersonaRuntime(ContextBudgetSchema.parse({assembly:{mode:'unified'},regions:{'memory:growth':{maxBytes:1000}}})),id=randomUUID();
  const entry:PreparedPersonaEntry={candidate:{id,version:1},contentRef:{kind:'memory',id,agentId:'fixture',scopeKey:'scope',version:1,revision:1,contentHash:'a'.repeat(64)},dependencies:[],item:item('qualified',1400)};
  runtime.bind({ready:()=>true,prepare:()=>({stageRevision:1,selectionVersion:1,entries:[entry],omitted:0}),validate:()=>true});
  const access:PersonaAccess={view:{runId:randomUUID(),taskId:null,scope:{kind:'conversation',agentId:'fixture',route:'scope'},origin:{kind:'message',inboundId:randomUUID(),conversation:{channel:'fixture',account:'local',kind:'group',id:'scope'}},signal:new AbortController().signal},producer:'fixture',operationId:randomUUID(),startedEventId:null,intentVersion:0,motivation:{kind:'unknown',basis:[]},inputs:[],admittedSources:[],guard:()=>{}};
  assert.throws(()=>runtime.prepareTarget(access),/PERSONA_CONTEXT_CAPACITY/);
});
test('unified preparation applies one deadline across optional contributors',async t=>{
  const h=await memoryFixture(undefined,{context:{}},undefined,{assembly:{mode:'unified',deadlineMs:60}});t.after(h.close);
  const coordinator=new ContextCoordinator('dafeiyu',h.core.journal,{assembly:{mode:'unified',deadlineMs:60},prepareTimeoutMs:1000});
  let prepared=0;const dispose=coordinator.register('deadline-fixture','1',['first','second','third'].map(id=>({id,kind:'evidence' as const,
    prepare:async request=>{prepared++;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,45);request.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('cancelled'));},{once:true});});return [item(id)];},validate:()=>true})));t.after(dispose);
  h.setResponse(()=>textReply('fixture'));const receipt=h.simulator.send('a','fixture',{id:randomUUID()});await h.core.whenIdle();
  const start=Date.now(),regions=await coordinator.prepare(h.core.journal.get(receipt.id),new AbortController().signal);
  assert.ok(Date.now()-start<500);assert.ok(regions.some(region=>region.unavailable));assert.ok(prepared>=1);coordinator.release(regions);
});
