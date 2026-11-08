import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,sep} from 'node:path';
import type {TestContext} from 'node:test';
import {z} from 'zod';
import type {CrashStage} from './native-delivery-crash-child.js';
import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';

export async function crashDelivery(t:TestContext,stage:CrashStage){
  const child=spawn(process.execPath,[fileURLToPath(new URL('./native-delivery-crash-child.js',import.meta.url)),stage],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:process.env});
  let errors='';child.stderr?.on('data',chunk=>{errors=(errors+String(chunk)).slice(-3000);});child.stdout?.resume();
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  const exited=new Promise<void>((done,reject)=>{child.once('exit',()=>done());child.once('error',reject);});
  const root=await new Promise<string>((done,reject)=>{
    child.once('message',message=>{try{const value=z.object({type:z.literal('delivery-crash-ready'),root:z.string()}).parse(message);done(value.root);}catch(error){reject(error);}});
    child.once('exit',()=>reject(new Error('CRASH_FIXTURE_EXITED: '+errors)));child.once('error',reject);
  });
  if(!process.env.DAFEIYU_TEST_RUN||!resolve(root).startsWith(resolve(process.env.DAFEIYU_TEST_RUN)+sep))throw new Error('CRASH_FIXTURE_SCOPE');
  child.kill('SIGKILL');await exited;
  await runOwnerDeliveryFixture(t,stage==='render-crash'?'resume-render-crash':'resume-verification-crash',root);
}
