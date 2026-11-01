import test from 'node:test';
import assert from 'node:assert/strict';
import {requestCapacity,wireProjection,tokenCapacityWithin} from '../packages/core/lib/context-plan.js';
import {shrinkControlledAllowance} from '../packages/core/lib/context-runtime.js';

test('wire projection excludes local source.sections metadata without changing the audit measurement',()=>{
  const sections=[{name:'carrier',text:'y'.repeat(20000)}],message={role:'user',content:[{type:'text',text:'x'.repeat(10000)}],source:{kind:'runtime-context',form:'snapshot',sections}};
  const internal=requestCapacity({messages:[message],tools:[]},1000000,0),wire=wireProjection({messages:[message],tools:[]});
  assert.ok(internal.bytes>wire.bytes);
  assert.equal(wire.measurement,'wire-projection-source-sections-excluded');
  assert.deepEqual(message.source.sections,sections);
  assert.ok(wire.categories.messages<internal.categories.messages);
});

test('controlled context allowance shrinks before the next repair attempt',()=>{
  assert.equal(shrinkControlledAllowance(16000,1000),14976);
  assert.equal(shrinkControlledAllowance(16000,20000),0);
  assert.equal(shrinkControlledAllowance(0,100),0);
});

test('model admission uses the real window and the unified one-million-token capacity',()=>{
  assert.deepEqual(tokenCapacityWithin({inputTokens:500000,outputTokens:8192,modelWindow:1000000,maxTokens:1000000}),
    {limit:1000000,within:true,headroom:491808});
  assert.equal(tokenCapacityWithin({inputTokens:100000,outputTokens:8000,modelWindow:1000000,maxTokens:1000000}).within,true,'Old 32k/48k ceilings must not apply');
  assert.equal(tokenCapacityWithin({inputTokens:991808,outputTokens:8192,modelWindow:1000000,maxTokens:1000000}).within,true,'I+O may equal the window');
  assert.equal(tokenCapacityWithin({inputTokens:991809,outputTokens:8192,modelWindow:1000000,maxTokens:1000000}).within,false,'One token past the shared window is rejected');
  assert.deepEqual(tokenCapacityWithin({inputTokens:190000,outputTokens:10000,modelWindow:200000,maxTokens:1000000}),
    {limit:200000,within:true,headroom:0},'The provider window is a real smaller limit');
});
