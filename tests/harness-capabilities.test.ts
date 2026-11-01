import test from 'node:test';
import assert from 'node:assert/strict';
import {CAPABILITY_INDEX_MAX_BYTES,renderCapabilityIndex,HarnessRuntime} from '../packages/core/lib/harness-runtime.js';

test('capability index keeps names, short purposes and real versions without full descriptions or skill payloads',()=>{
  const huge='x'.repeat(5000);
  const input={
    configured:{features:['zeta','alpha'],actions:[{id:'zeta:one',owner:'zeta',version:'1',purpose:huge,effects:'read',scope:'any',providerReady:true}]},
    callable:[{name:'tool',description:huge}],
    host:{configured:true,available:true,code:null,execution:'authorized-task',version:'catalog-v1',tools:[{name:'host-tool',description:huge}],skills:[{name:'skill',description:huge,load:{payload:huge}}],skillsComplete:true},
  };
  const first=renderCapabilityIndex(input),second=renderCapabilityIndex(input),parsed=JSON.parse(first);
  assert.equal(second,first);
  assert.ok(!first.includes(huge));
  assert.ok(!first.includes('"load"'));
  assert.ok(first.length<20000);
  assert.match(parsed.version,/^[a-f0-9]{16}$/);
  assert.deepEqual(parsed.configured.features,['alpha','zeta']);
  assert.equal(parsed.callable[0].purpose.length,120);
  assert.equal(parsed.host.skills[0].name,'skill');
  assert.equal(parsed.host.tools[0].name,'host-tool');
  const changed=renderCapabilityIndex({...input,host:{...input.host,version:'catalog-v2'}});
  assert.notEqual(JSON.parse(changed).version,parsed.version);
  const reading=JSON.parse(renderCapabilityIndex({...input,host:{...input.host,execution:'read-only-discovery',stage:'bili-reading',available:true,code:null}}));
  assert.equal(reading.host.execution,'read-only-discovery','Reading stage exposes read-only discovery, not an empty unavailable catalog');
  assert.equal(reading.host.stage,'bili-reading');
  assert.equal(reading.host.available,true);
});

test('capability index is hard capped and degrades to a queryable shell instead of growing without bound',()=>{
  const callable=Array.from({length:300},(_,index)=>({name:'tool-'+String(index).padStart(3,'0'),description:'x'.repeat(1000)}));
  const text=renderCapabilityIndex({configured:{features:[],actions:[]},callable,host:{configured:true,available:true,code:null,execution:'authorized-task',version:'v',tools:[],skills:[],skillsComplete:true}});
  const parsed=JSON.parse(text);
  assert.equal(parsed.truncated,true);
  assert.ok(parsed.callable.length>0&&parsed.callable.length<300);
  assert.equal(parsed.counts.callable,300);
  assert.ok(Buffer.byteLength(text)<=CAPABILITY_INDEX_MAX_BYTES);
});

test('reading-stage install exposes a readable catalog but no dispatch authority even when dispatch actions exist',async()=>{
  const agent={},handlers=new Map<string,(...args:any[])=>any>(),manifests:string[]=[],registered:string[]=[];
  const scope={
    tools:{schemas:()=>[{name:'scoped-tool',description:'scoped',parameters:{type:'object'}}],register:(tool:{name:string})=>{registered.push(tool.name);return ()=>{};}},
    systemPrompt:{section:()=>()=>{},context:(spec:{text:string|(()=>string)})=>{manifests.push(typeof spec.text==='function'?spec.text():spec.text);return ()=>{};}},
    on:(name:string,handler:(...args:any[])=>any)=>{handlers.set(name,handler);return ()=>{};},
  } as never;
  const runtime=new HarnessRuntime(()=>({features:[],actions:[]}));
  runtime.bind({catalog:async()=>({version:'a'.repeat(64),tools:[{name:'host-read',description:'read host state',parameters:{type:'object',properties:{}}}],skills:[],skillsComplete:true})});
  const action=(id:string)=>({definition:{id,owner:'dsh-tools',active:()=>true,metadata:()=>null}});
  const dispose=runtime.install(scope,agent as never,[action('dsh_tool_call'),action('dsh_tool_list')] as never,new AbortController().signal,'task-1','bili-reading');
  try{
    const assemble=handlers.get('system-prompt/assemble')!;
    const assembled=await assemble({},{},async()=>({sections:[],contexts:[],tools:[]}));
    const host=JSON.parse(assembled.contexts.find((context:any)=>context.name==='dafeiyu:configured-capabilities:v1').text).host;
    assert.equal(host.available,true);
    assert.equal(host.execution,'read-only-discovery');
    assert.equal(host.stage,'bili-reading');
    assert.equal(host.tools[0].name,'host-read');
    assert.deepEqual(registered,[],'Reading stage must not register host dispatch aliases');
  }finally{dispose();}
});
