import test from 'node:test';
import assert from 'node:assert/strict';
import {RunScheduler} from '../packages/core/lib/run-scheduler.js';
import type {RunClass,RunLease} from '../packages/core/lib/run-scheduler.js';

const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const lease=(workItemId:string,cls:RunClass,route='scene'):RunLease=>({workItemId,route,class:cls});

test('interactive work keeps a reserved slot while background work is waiting',async()=>{
  const scheduler=new RunScheduler(2,{interactiveReserve:1,antiStarvation:3});
  const releaseBg=await scheduler.acquire(lease('bg-1','background'));
  assert.equal(scheduler.status.active,1);
  assert.equal(scheduler.status.backgroundActive,1);

  let backgroundGranted=false;
  const bg2=scheduler.acquire(lease('bg-2','background')).then(release=>{backgroundGranted=true;return release;});
  const releaseChat=await scheduler.acquire(lease('chat-1','interactive','qq:group:1'));
  assert.equal(scheduler.status.active,2);
  assert.equal(scheduler.status.interactiveActive,1);
  await tick();
  assert.equal(backgroundGranted,false,'background concurrency is capped so interactive keeps a slot');

  releaseChat();
  await tick();
  assert.equal(backgroundGranted,false,'the only background slot is still held by bg-1');

  releaseBg();
  await tick();
  assert.equal(backgroundGranted,true,'waiting background gets the freed background slot');
  (await bg2)();
  assert.equal(scheduler.status.active,0);
});

test('without reserve, consecutive interactive grants force an eligible background item',async()=>{
  const scheduler=new RunScheduler(1,{interactiveReserve:0,antiStarvation:2});
  const releaseHolder=await scheduler.acquire(lease('holder','interactive'));
  const order:string[]=[];
  let releaseChat:()=>void=()=>{};
  const firstChat=scheduler.acquire(lease('chat-1','interactive')).then(release=>{order.push('chat');releaseChat=release;});
  const background=scheduler.acquire(lease('bg-1','background')).then(release=>{order.push('bg');return release;});
  releaseHolder();
  await tick();
  assert.deepEqual(order,['chat'],'first interactive grant may run');

  releaseChat();
  await tick();
  assert.deepEqual(order,['chat','bg'],'after the anti-starvation bound, background runs first');
  const releaseBg=await background;
  releaseBg();
  await firstChat;
  assert.deepEqual(order,['chat','bg']);
});

test('focus route wins the interactive tie-break',async()=>{
  const scheduler=new RunScheduler(1,{interactiveReserve:0});
  const releaseHolder=await scheduler.acquire(lease('holder','interactive','qq:group:1'));
  scheduler.noteInbound('qq:group:2');
  assert.equal(scheduler.focusLease?.route,'qq:group:2');
  assert.ok(scheduler.focusLease?.expiresAt);
  const order:string[]=[];
  const first=scheduler.acquire(lease('a','interactive','qq:group:1')).then(release=>{order.push('a');return release;});
  const second=scheduler.acquire(lease('b','interactive','qq:group:2')).then(release=>{order.push('b');return release;});
  releaseHolder();
  await tick();
  assert.deepEqual(order,['b'],'the focused route is preferred even when enqueued later');
  (await second)();
  await first;
});

test('owner tasks are background work with an ordering bonus, not interactive foreground',async()=>{
  let now=1_000;
  const scheduler=new RunScheduler(1,{interactiveReserve:0,now:()=>now});
  const releaseHolder=await scheduler.acquire(lease('holder','interactive'));
  const order:string[]=[];
  const background=scheduler.acquire(lease('bg','background')).then(release=>{order.push('background');return release;});
  const owner=scheduler.acquire(lease('owner','owner-task')).then(release=>{order.push('owner');return release;});
  releaseHolder();
  await tick();
  assert.deepEqual(order,['owner'],'owner task outranks plain background when both are waiting');
  (await owner)();
  (await background)();
});

test('a long-waiting background task eventually outranks a fresh owner task',async()=>{
  let now=0;
  const scheduler=new RunScheduler(1,{interactiveReserve:0,now:()=>now});
  const releaseHolder=await scheduler.acquire(lease('holder','interactive'));
  const order:string[]=[];
  const background=scheduler.acquire(lease('bg','background')).then(release=>{order.push('background');return release;});
  now=20_000;
  const owner=scheduler.acquire(lease('owner','owner-task')).then(release=>{order.push('owner');return release;});
  releaseHolder();
  await tick();
  assert.deepEqual(order,['background'],'weighted waiting prevents permanent owner-task starvation');
  (await background)();
  (await owner)();
});

test('boolean leases remain compatible for old callers',async()=>{
  const scheduler=new RunScheduler(1,{interactiveReserve:0});
  const release=await scheduler.acquire(true,'qq:group:1');
  assert.equal(scheduler.status.interactiveActive,1);
  release();
  const releaseBg=await scheduler.acquire(false);
  assert.equal(scheduler.status.backgroundActive,1);
  releaseBg();
});
