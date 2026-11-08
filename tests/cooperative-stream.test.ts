import test from 'node:test';
import assert from 'node:assert/strict';
import {cooperativeStream} from '../packages/core/lib/cooperative-stream.js';
test('a buffered stream lets a real cancellation timer run and closes the source',async()=>{
  const controller=new AbortController();let closed=false,received=0;
  async function* source(){try{for(let index=0;index<200;index++){const until=performance.now()+1;while(performance.now()<until){}yield index;}}finally{closed=true;}}
  const start=performance.now(),timer=setTimeout(()=>controller.abort(),0);
  try{await assert.rejects(async()=>{for await(const _ of cooperativeStream(source(),controller.signal))received++;});assert.equal(closed,true);assert.ok(received<200);
    if(process.env.DAFEIYU_PERFORMANCE_SLO==='1')assert.ok(performance.now()-start<150);
  }finally{clearTimeout(timer);}
});
test('cooperative streaming preserves every value and propagates source failures',async()=>{
  async function* source(){yield 'first';yield 'second';throw new Error('FIXTURE_FAILURE');}
  const values:string[]=[];await assert.rejects(async()=>{for await(const value of cooperativeStream(source()))values.push(value);},/FIXTURE_FAILURE/);assert.deepEqual(values,['first','second']);
});
