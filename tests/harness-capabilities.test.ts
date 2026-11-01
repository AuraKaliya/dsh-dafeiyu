import test from 'node:test';
import assert from 'node:assert/strict';
import {CAPABILITY_INDEX_MAX_BYTES,renderCapabilityIndex} from '../packages/core/lib/harness-runtime.js';

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
