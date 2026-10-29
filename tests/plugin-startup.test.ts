import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { deferPluginStart,startupFailure } from '../packages/plugin/lib/startup.js';

const tick=()=>new Promise<void>(done=>setImmediate(done));
test('unexpected startup failures retain actionable metadata without leaking error text or private paths',()=>{
  const error=Object.assign(new TypeError('Cannot find package \'@fictional/absent\' imported from C:/private-owner/TOKEN_SECRET/index.js'),{code:'ERR_MODULE_NOT_FOUND'});error.stack='TypeError: TOKEN_SECRET\n at file:///C:/private-owner/startup.js:12:3';
  const record=startupFailure('bridge-import',error);assert.equal(record.code,'ERR_MODULE_NOT_FOUND');assert.equal(record.missingPackage,'@fictional/absent');assert.deepEqual(record.frames,[{file:'startup.js',line:12}]);assert.ok(!JSON.stringify(record).includes('TOKEN_SECRET'));assert.ok(!JSON.stringify(record).includes('private-owner'));assert.equal(startupFailure('child-spawn',{code:'SECRET_TOKEN'}).name,'UnknownError');
});
function readiness(){const listeners=new Set<()=>void>();return {onReady(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},commit(){for(const listener of [...listeners])listener();},get pending(){return listeners.size;}};}

test('startup waits for readiness, starts once and disposes its returned resource',async()=>{
  const ctx=new Context(),ready=readiness();let starts=0,closes=0;
  ctx.effect(()=>deferPluginStart(ready,async signal=>{signal.throwIfAborted();starts++;return ()=>{closes++;};},()=>assert.fail('launch failed')));
  await tick();assert.equal(starts,0);ready.commit();ready.commit();await tick();assert.equal(starts,1);
  await ctx.fiber.dispose();assert.equal(closes,1);assert.equal(ready.pending,0);
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
