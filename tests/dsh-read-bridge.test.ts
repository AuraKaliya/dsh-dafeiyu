import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {attachDshBridge} from '../packages/plugin/lib/bridge-parent.js';
import {testTempDir} from './test-temp.js';

test('the DSH parent executes approved reads and rejects shell before dispatch',async()=>{
  const root=await mkdtemp(join(testTempDir(),'dsh-read-')),file=join(root,'settings.json');
  await writeFile(file,JSON.stringify({schemaVersion:1,dataDir:join(root,'data'),dshTools:true,model:{model:'fixture',credentialStore:join(root,'credentials')},qq:{botId:'10001',ownerId:'10002',tokenFile:join(root,'token'),httpURL:'http://127.0.0.1:12001',wsURL:'ws://127.0.0.1:12002'},activity:{enabled:false}}));
  const calls:string[]=[],pending=new Map<string,(value:unknown)=>void>(),child=Object.assign(new EventEmitter(),{connected:true,send:(value:unknown,callback?:()=>void)=>{const row=z.object({id:z.string()}).parse(value);pending.get(row.id)?.(value);pending.delete(row.id);callback?.();}});
  const agent={session:{append:()=>{}}},ctx={root:null as unknown,get:(name:string)=>name==='agentPresets'?{mount:async()=>({id:'cordis'})}:name==='permissionPresets'?{set:()=>{}}:undefined,
    sessionPersistence:{stat:async()=>false},sessions:{flush:async()=>true},
    agents:{create:async()=>({agent,dispose:async()=>{}}),withInitiator:async(_agent:unknown,work:()=>Promise<unknown>)=>work()},
    tools:{schemas:()=>['read','shell'].map(name=>({name,description:name,parameters:{type:'object',properties:{}}})),execute:async(input:{name:string})=>{calls.push(input.name);return {isError:false,value:{text:'fixture contents'}};}}};ctx.root=ctx;
  const close=attachDshBridge(ctx as never,child as never,file);
  const send=(value:Record<string,unknown>)=>new Promise<unknown>(resolve=>{const id=randomUUID();pending.set(id,resolve);child.emit('message',{...value,id});});
  try{const catalog=z.object({value:z.object({version:z.string(),environment:z.object({inspection:z.object({filesRead:z.literal(false),dataDirectory:z.string(),sourceFiles:z.array(z.object({path:z.string()}))})})})}).parse(await send({type:'dsh.catalog'}));
    assert.equal(catalog.value.environment.inspection.dataDirectory,join(root,'data'));assert.ok(catalog.value.environment.inspection.sourceFiles.some(file=>file.path.endsWith('capabilities.js')));
    const scope={agentId:'fixture',taskId:randomUUID(),runId:randomUUID(),operationId:randomUUID(),intentVersion:1};
    const read=z.object({value:z.object({effect:z.string()})}).parse(await send({type:'dsh.read',scope,call:{catalogVersion:catalog.value.version,name:'read',argumentsJson:'{}'}}));assert.equal(read.value.effect,'none');
    const denied=z.object({error:z.string()}).parse(await send({type:'dsh.read',scope,call:{catalogVersion:catalog.value.version,name:'shell',argumentsJson:'{}'}}));assert.equal(denied.error,'DSH_READ_ONLY_REQUIRED');assert.deepEqual(calls,['read']);
  }finally{await close();}
});
