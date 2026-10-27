import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {biliHash} from '../packages/bilibili/lib/store.js';
import {runtimeHash} from '@dafeiyu/core/runtime-store';

test('shared JSON validators preserve persisted canonical hashes and reject non-JSON values',()=>{
  const value={z:[null,true,0,2.5,'鱼\n'],a:{b:2,a:1}},canonical='{"a":{"a":1,"b":2},"z":[null,true,0,2.5,"鱼\\n"]}',expected=createHash('sha256').update(canonical).digest('hex');
  for(const hash of [biliHash,runtimeHash]){assert.equal(hash(value),expected);assert.equal(hash({a:{a:1,b:2},z:value.z}),expected);assert.notEqual(hash({...value,a:{a:2,b:2}}),expected);
    for(const invalid of [undefined,{value:undefined},{value:Number.NaN},{value:()=>1}])assert.throws(()=>hash(invalid));}
});
