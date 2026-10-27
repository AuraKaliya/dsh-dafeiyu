import test from 'node:test';
import assert from 'node:assert/strict';
import type {NativeExpressionPacket} from '@dafeiyu/contracts';
import {packNativeEvidence} from '../packages/memory/lib/native-evidence.js';

test('many admitted observations retain every source label and inference distinction within the existing packet contract',()=>{
  const items:NativeExpressionPacket['evidence']=Array.from({length:38},(_,i)=>({id:'S'+i,kind:i%2?'inference':'reported',text:'原始观察 '+i+'\n含"引号"的材料'}));
  const packed=packNativeEvidence(items);assert.ok(packed.length<=19);
  const decoded=packed.flatMap(item=>{const bundle=JSON.parse(item.text) as {items:{id:string;text:string}[]};return bundle.items.map(source=>({...source,kind:item.kind}));});
  assert.deepEqual(decoded.sort((a,b)=>a.id.localeCompare(b.id)),[...items].sort((a,b)=>a.id.localeCompare(b.id)));
  assert.ok(packed.every(item=>item.text.length<=32000));assert.deepEqual(packNativeEvidence(packed),packed);
});

test('large individual records keep their exact content and excessive capacity still fails',()=>{
  const items:NativeExpressionPacket['evidence']=Array.from({length:20},(_,i)=>({id:'S'+i,kind:'reported',text:'"'.repeat(31000)}));
  assert.throws(()=>packNativeEvidence(items),/NATIVE_EXPRESSION_CAPACITY/);
  const small=items.slice(0,19);assert.equal(packNativeEvidence(small),small);
});
