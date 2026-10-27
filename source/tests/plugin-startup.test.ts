import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp,access } from 'node:fs/promises';
import { join } from 'node:path';
import { deferPluginStart } from '../packages/plugin/lib/startup.js';
import { testTempDir } from './test-temp.js';

const tick=()=>new Promise<void>(done=>setImmediate(done));
function readiness(){const listeners=new Set<()=>void>();return {onReady(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},commit(){for(const listener of [...listeners])listener();},get pending(){return listeners.size;}};}

test('the real child starts only after host commit, starts once, and is reaped on plugin disposal',async()=>{
  const ctx=new Context(),ready=readiness(),root=await mkdtemp(join(testTempDir(),'plugin-start-')),file=join(root,'child-started');let starts=0,exit:number|null|undefined;let announce!:()=>void;const started=new Promise<void>(done=>{announce=done;});
  ctx.effect(()=>deferPluginStart(ready,async signal=>{signal.throwIfAborted();starts++;const child=spawn(process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],'started');process.send({ready:true});process.on('message',()=>process.exit(0));",file],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
    const closed=once(child,'close').then(([code])=>{exit=code;});await once(child,'message');announce();return async()=>{child.send({stop:true});await closed;};
  },()=>assert.fail('launch failed')));
  await tick();assert.equal(starts,0);await assert.rejects(access(file));ready.commit();ready.commit();await started;await access(file);assert.equal(starts,1);await ctx.fiber.dispose();assert.equal(exit,0);assert.equal(ready.pending,0);
});

test('disposal before host readiness removes the listener and cannot start later',async()=>{
  const ctx=new Context(),ready=readiness();let launched=false;ctx.effect(()=>deferPluginStart(ready,async()=>{launched=true;return ()=>{};},()=>assert.fail('unexpected failure')));await ctx.fiber.dispose();ready.commit();await tick();assert.equal(launched,false);assert.equal(ready.pending,0);
});

test('disposal during a lazy import cancels child creation and waits for pending startup cleanup',async()=>{
  const ctx=new Context(),ready=readiness();let release!:()=>void,enter!:()=>void,signal:AbortSignal|undefined,created=false;const loading=new Promise<void>(done=>{release=done;}),entered=new Promise<void>(done=>{enter=done;});
  ctx.effect(()=>deferPluginStart(ready,async token=>{signal=token;enter();await loading;token.throwIfAborted();created=true;return ()=>{};},()=>assert.fail('expected cancellation')));ready.commit();await entered;const closed=ctx.fiber.dispose();await tick();assert.equal(signal?.aborted,true);release();await closed;assert.equal(created,false);
});

test('non-launcher contexts still start, and failed startup is reported once without preventing disposal',async()=>{
  let count=0,error:unknown;const close=deferPluginStart(undefined,async()=>{count++;throw new Error('FIXTURE_START_FAILED');},value=>{error=value;});await tick();assert.equal(count,1);assert.ok(error instanceof Error&&error.message==='FIXTURE_START_FAILED');await close();await close();assert.throws(()=>deferPluginStart({},async()=>()=>{},()=>{}),/INSTALL_DSH_READINESS_INVALID/);
});
