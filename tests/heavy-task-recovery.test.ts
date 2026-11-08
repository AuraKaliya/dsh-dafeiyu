import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,sep} from 'node:path';
import {z} from 'zod';
import type {HeavyCrashMode} from './heavy-task-crash-child.js';
test('a heavy completed task survives process loss and delivers without replaying any of its sixty-four reads',{timeout:180000},async t=>{
  const start=(mode:HeavyCrashMode,root?:string)=>{const child=spawn(process.execPath,[fileURLToPath(new URL('./heavy-task-crash-child.js',import.meta.url)),mode,...(root?[root]:[])],{windowsHide:true,env:process.env,stdio:['ignore','pipe','pipe','ipc']});child.stdout?.resume();let errors='';child.stderr?.on('data',chunk=>{errors=(errors+String(chunk)).slice(-2000);});
    t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
    const exit=new Promise<void>((done,reject)=>{child.once('exit',()=>done());child.once('error',reject);});
    const message=new Promise<unknown>((done,reject)=>{child.once('message',done);child.once('error',reject);child.once('exit',code=>{if(code!==0)reject(new Error('HEAVY_CHILD_EXITED '+errors));});});return {child,exit,message};};
  const original=start('crash'),ready=z.object({type:z.literal('heavy-crash-ready'),root:z.string()}).parse(await original.message);
  assert.ok(process.env.DAFEIYU_TEST_RUN&&resolve(ready.root).startsWith(resolve(process.env.DAFEIYU_TEST_RUN)+sep));original.child.kill('SIGKILL');await original.exit;
  const resumed=start('resume',ready.root),result=z.object({type:z.literal('heavy-resumed'),result:z.object({reads:z.number(),requests:z.number(),storedRequests:z.number(),taskRuns:z.number(),sent:z.string(),capacity:z.number()})}).parse(await resumed.message);await resumed.exit;
  assert.equal(resumed.child.exitCode,0);assert.equal(result.result.reads,0);assert.equal(result.result.requests,0);assert.equal(result.result.storedRequests,67);assert.equal(result.result.taskRuns,1);assert.equal(result.result.capacity,1000000);assert.match(result.result.sent,/六十四份/);
});
