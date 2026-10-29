import test from 'node:test';
import assert from 'node:assert/strict';
import {ModelCallGate} from '@dafeiyu/server-runtime';

const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const deadline=()=>Date.now()+60_000;

test('call leases order interactive work before background work',async()=>{
  const gate=new ModelCallGate({agingMs:1_000,now:()=>0});
  const holder=await gate.acquire(new AbortController().signal,deadline(),{class:'background'});
  const order:string[]=[];
  const autonomy=gate.acquire(new AbortController().signal,deadline(),{class:'autonomy'}).then(release=>{order.push('autonomy');return release;});
  const background=gate.acquire(new AbortController().signal,deadline(),{class:'background'}).then(release=>{order.push('background');return release;});
  const interactive=gate.acquire(new AbortController().signal,deadline(),{class:'interactive'}).then(release=>{order.push('interactive');return release;});
  holder();
  await tick();
  assert.deepEqual(order,['interactive'],'interactive lease wins the next call slot');
  const releaseInteractive=await interactive;
  releaseInteractive();
  await tick();
  assert.deepEqual(order,['interactive','background'],'owner/background classes order by rank');
  (await background)();
  (await autonomy)();
});

test('waiting age lets a low class catch up without a numeric model priority',async()=>{
  let now=0;
  const gate=new ModelCallGate({agingMs:1_000,now:()=>now});
  const holder=await gate.acquire(new AbortController().signal,deadline(),{class:'background'});
  const order:string[]=[];
  const old=gate.acquire(new AbortController().signal,deadline(),{class:'autonomy'}).then(release=>{order.push('old');return release;});
  now=10_000;
  const fresh=gate.acquire(new AbortController().signal,deadline(),{class:'interactive'}).then(release=>{order.push('fresh');return release;});
  holder();
  await tick();
  assert.deepEqual(order,['old'],'the long-waiting call is promoted by age, not by a model-supplied priority');
  (await old)();
  (await fresh)();
});

test('default leases preserve the existing FIFO order',async()=>{
  const gate=new ModelCallGate({agingMs:10_000,now:()=>0});
  const holder=await gate.acquire(new AbortController().signal,deadline());
  const order:string[]=[];
  const first=gate.acquire(new AbortController().signal,deadline()).then(release=>{order.push('first');return release;});
  const second=gate.acquire(new AbortController().signal,deadline()).then(release=>{order.push('second');return release;});
  holder();
  await tick();
  assert.deepEqual(order,['first']);
  (await first)();
  await tick();
  assert.deepEqual(order,['first','second']);
  (await second)();
});
