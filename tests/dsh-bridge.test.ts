import test from 'node:test';
import assert from 'node:assert/strict';
import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import { spawn } from 'node:child_process';
import { writeFile,mkdtemp,readFile,access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ExternalTaskAuthorizationSchema,DshToolCatalogSchema,taskScopeKey } from '@dafeiyu/contracts';
import type { Json } from '@dafeiyu/contracts';
import { attachDshBridge } from '../packages/plugin/lib/bridge-parent.js';
import { DeferredPluginChanges } from '../packages/plugin/lib/deferred-plugins.js';
import { harness } from './harness.js';
import { testTempDir } from './test-temp.js';

function authorization(){const taskId=randomUUID(),runId=randomUUID();return ExternalTaskAuthorizationSchema.parse({schemaVersion:1,agentId:'dafeiyu',taskId,runId,operationId:randomUUID(),intentVersion:1,parentRunId:null,scope:{kind:'task',agentId:'dafeiyu',taskId,scopeKey:taskScopeKey('dafeiyu',taskId)},goal:'本机桥接组件测试',motivation:{kind:'explicit-task',basis:['fixture']},policy:{producer:'qq-tasks',id:'qq-task',hash:'a'.repeat(64)},action:{owner:'dsh-tools',id:'dsh_tool_call',version:'1',pluginVersion:'1',effects:'external-write',hash:'b'.repeat(64)},source:{kind:'owner-message',bindingId:'qq-tasks',inboundId:randomUUID(),messageId:'1',messageHash:'c'.repeat(64),conversation:{channel:'qq',account:'12345678',kind:'private',id:'87654321'},senderId:'87654321',modality:'text',sourceHash:'d'.repeat(64)}});}
class Presets extends Service {constructor(ctx:Context){super(ctx,'agentPresets');}async mount(_scope:Context,id:string){return {id};}}
class Permissions extends Service {constructor(ctx:Context){super(ctx,'permissionPresets');}set(){}}

test('Node IPC bridge discovers and executes real DSH Tools with original schema, policy hooks, cancellation and no planning model',async t=>{
  const root=await mkdtemp(join(testTempDir(),'dsh-bridge-')),h=await harness(join(root,'core'));t.after(h.close);new Presets(h.ctx);new Permissions(h.ctx);
  const settingsFile=join(root,'settings.json');await writeFile(settingsFile,JSON.stringify({schemaVersion:1,dataDir:join(root,'data'),dshTools:true,model:{model:'scripted',credentialStore:join(root,'unused')},qq:{botId:'12345678',ownerId:'87654321',tokenFile:join(root,'unused'),httpURL:'http://127.0.0.1:1',wsURL:'ws://127.0.0.1:1'}}));
  let dispatched=0,guarded=0;h.ctx.on('tools/pre-execute',async(exec,next)=>{guarded++;assert.ok(String(exec.agent?.id).startsWith('dafeiyu-tools-'));return next();});
  h.ctx.tools.register({name:'fixture_write',description:'真实文件写入',parameters:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},output:{schema:{type:'object',properties:{saved:{type:'boolean'}},required:['saved'],additionalProperties:false},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async raw=>{dispatched++;const input=z.object({text:z.string()}).parse(raw);await writeFile(join(root,'output.txt'),input.text);return {saved:true};}});
  let waiting=false,aborted=false;
  h.ctx.tools.register({name:'fixture_wait',description:'验证协作取消',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{},render:()=>[]},execute:async(_raw,exec)=>{waiting=true;await new Promise<void>(resolve=>{exec.signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true});});return null;}});
  const childFile=join(root,'ipc.mjs');await writeFile(childFile,"process.on('message',value=>{if(value.type==='fixture.request')process.send(value.request);else process.send({type:'fixture.response',response:value});});");
  const child=spawn(process.execPath,[childFile],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true}),close=attachDshBridge(h.ctx,child,settingsFile);t.after(async()=>{await close();child.kill();});
  const rpc=async(payload:{type:string;id:string;call?:unknown;authorization?:unknown}):Promise<{value:Json;error?:string|undefined}>=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('IPC_TEST_TIMEOUT')),5000);const listener=(value:unknown)=>{const parsed=z.object({type:z.literal('fixture.response'),response:z.object({id:z.literal(payload.id),value:z.json(),error:z.string().optional()})}).safeParse(value);if(!parsed.success)return;clearTimeout(timer);child.off('message',listener);resolve(parsed.data.response);};child.on('message',listener);child.send!({type:'fixture.request',request:payload});});
  const catalog=DshToolCatalogSchema.parse((await rpc({type:'dsh.catalog',id:randomUUID()})).value);assert.ok(catalog.tools.some(tool=>tool.name==='fixture_write'));
  const auth=authorization(),call={catalogVersion:catalog.version,name:'fixture_write',argumentsJson:JSON.stringify({text:'实际通过DSH写入'})};
  assert.equal((await rpc({type:'dsh.call',id:randomUUID(),call:{...call,argumentsJson:'{"text":17}'},authorization:auth})).error,'DSH_TOOL_ARGUMENTS_INVALID');assert.equal(dispatched,0);
  const result=await rpc({type:'dsh.call',id:randomUUID(),call,authorization:auth});assert.equal(result.error,undefined);assert.equal(await readFile(join(root,'output.txt'),'utf8'),'实际通过DSH写入');assert.equal(dispatched,1);assert.equal(guarded,1);assert.equal(h.adapter.requests.length,0);
  const waitId=randomUUID(),waitResult=rpc({type:'dsh.call',id:waitId,call:{...call,name:'fixture_wait',argumentsJson:'{}'},authorization:auth});
  for(let attempt=0;attempt<100&&!waiting;attempt++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(waiting,true);child.send!({type:'fixture.request',request:{type:'dsh.cancel',id:waitId}});assert.equal(z.object({isError:z.boolean()}).parse((await waitResult).value).isError,true);assert.equal(aborted,true);
  h.ctx.tools.register({name:'changed_tool',description:'目录变动',parameters:{type:'object',properties:{}},output:{schema:{},render:()=>[]},execute:async()=>null});
  assert.equal((await rpc({type:'dsh.call',id:randomUUID(),call,authorization:auth})).error,'DSH_CATALOG_CHANGED');assert.equal(dispatched,1);
});

test('plugin changes persist and wait for authenticated idle; an interrupted apply stays unknown without replay',async()=>{
  const root=await mkdtemp(join(testTempDir(),'dsh-plugin-change-'));let applied=0;const auth=authorization(),queue=new DeferredPluginChanges(root,async()=>{applied++;return {application:'applied'};});
  const first=queue.enqueue(auth,{action:'install_bundle',target:'fictional-plugin@1.0.0'});assert.equal(first.state,'queued');assert.equal(applied,0);assert.equal(queue.enqueue(auth,{action:'install_bundle',target:'fictional-plugin@1.0.0'}).id,first.id);
  await queue.idle(async()=>true);assert.equal(applied,1);assert.equal(queue.status()[0]?.state,'applied');await queue.idle(async()=>true);assert.equal(applied,1);
  const stale=authorization();queue.enqueue(stale,{action:'install_bundle',target:'fictional-plugin@2.0.0'});await queue.idle(async()=>false);assert.equal(applied,1);assert.equal(queue.status().at(-1)?.state,'failed');
  const path=join(root,auth.operationId+'.json'),saved=JSON.parse(await readFile(path,'utf8'));saved.state='applying';saved.ownerPid=2147483647;await writeFile(path,JSON.stringify(saved));const recovered=new DeferredPluginChanges(root,async()=>{throw new Error('MUST_NOT_REPLAY');});assert.equal(recovered.status().find(row=>row.id===auth.operationId)?.state,'unknown');
});


test('the desktop bridge does not populate a fresh installation data directory before initialization',async()=>{
  const root=await mkdtemp(join(testTempDir(),'dsh-fresh-')),data=join(root,'new-data');new DeferredPluginChanges(join(data,'dsh-plugin-changes'),async()=>null);await assert.rejects(access(data));
});
