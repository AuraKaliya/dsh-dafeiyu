import test from 'node:test';
import assert from 'node:assert/strict';
import {requestCapacity,wireProjection} from '../packages/core/lib/context-plan.js';
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
