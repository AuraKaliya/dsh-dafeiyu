import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotRetirementSeqs} from '../packages/core/lib/context-runtime.js';

type SnapshotEvent={type:string;data:{source?:{kind?:string;form?:string;sections?:{name:string;text:string}[]}}};
const snapshot=(text:string):SnapshotEvent=>({type:'user/message',data:{source:{kind:'runtime-context',form:'snapshot',sections:[{name:'carrier',text}]}}});

test('only the newest carrier snapshot remains visible while older snapshots retire',()=>{
  const events=new Map<number,SnapshotEvent>([[1,snapshot('a')],[2,snapshot('b')],[3,snapshot('c')],[4,{type:'assistant/message',data:{}}]]);
  assert.deepEqual(snapshotRetirementSeqs([1,2,3,4],events,'carrier','c'),[2,1]);
  assert.deepEqual(snapshotRetirementSeqs([1,2,3,4],events,'carrier',''),[3,2,1]);
  assert.deepEqual(snapshotRetirementSeqs([1,2,3,4],events,'carrier','not-found'),[3,2,1]);
  assert.deepEqual(snapshotRetirementSeqs([1,2,3,4],events,'other','c'),[]);
});
