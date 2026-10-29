import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCapabilityIndex} from '../packages/core/lib/harness-runtime.js';

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
