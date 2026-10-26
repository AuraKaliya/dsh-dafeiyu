import {BILI_OWNER_SCENE} from './bili-owner-identity.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadHostConfig,BILI_OWNER_NATIVE_ACTIONS } from '@dafeiyu/host';
import { BILI_OWNER_TASK_ACTIONS,BILI_PUBLIC_SCENE } from '@dafeiyu/bilibili/channel';
import { testTempDir } from './test-temp.js';

async function fixture(){const root=await mkdtemp(join(testTempDir(),'host-bili-owner-config-')),file=join(root,'host.json');
  await writeFile(join(root,'persona.md'),'虚构配置夹具，不连接平台。');
  const config={schemaVersion:1,profileId:'bili-owner-config',agent:{id:'dafeiyu'},paths:{core:'data/core',memory:'data/memory',sessions:'data/sessions',query:'data/query.sqlite'},
    modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'persona.md',kind:'test'},
    plugins:[{id:'model-scripted',config:{}},{id:'timeline',config:{execution:true}},{id:'memory',config:{sourceTracking:true}},
      {id:'media',config:{ffmpeg:process.execPath,ffprobe:process.execPath}},{id:'bilibili',config:{}},{id:'channel-bili-owner',config:{accountUid:'10000001',ownerUid:'10000002',}}] as {id:string;config:Record<string,unknown>}[],
    authorityPolicies:[{id:'conversation',producers:['channel-bili-owner'],actions:[...BILI_OWNER_TASK_ACTIONS],allowLocalWrite:true},
      {id:'bili-owner-task',producers:['bili-owner-tasks'],actions:[...BILI_OWNER_NATIVE_ACTIONS],allowLocalWrite:true,resources:[BILI_PUBLIC_SCENE,BILI_OWNER_SCENE]}] as {id:string;producers:string[];actions:string[];allowLocalWrite:boolean;resources?:unknown[];externalActions?:unknown[]}[]};
  return {root,config,async load(value:unknown=config){await writeFile(file,JSON.stringify(value));return loadHostConfig(file);}};
}

test('Bili owner config uses a fixed channel feature and dependencies without changing the old path layout',async()=>{
  const f=await fixture(),loaded=await f.load();assert.deepEqual(loaded.paths.channels,{});assert.equal(loaded.plugins.find(plugin=>plugin.id==='channel-bili-owner')?.config.ownerUid,'10000002');
  for(const required of ['core','memory','media','bilibili','core-execution'])assert.ok(loaded.order.indexOf(required)<loaded.order.indexOf('channel-bili-owner'));
  assert.deepEqual((await readdir(f.root)).sort(),['host.json','persona.md']);
});

test('Bili owner settings reject a different recipient or JSON-selected IO authority before any storage or connector opens',async()=>{
  const f=await fixture();for(const settings of [{ownerUid:'10000003'},{accountUid:'111111'},{transport:'arbitrary-module'},{lease:{epoch:999}},{tasks:{policyId:'qq-task'}}]){
    const config=structuredClone(f.config);config.plugins.find(plugin=>plugin.id==='channel-bili-owner')!.config=settings;await assert.rejects(()=>f.load(config),/HOST_CONFIG_INVALID/);
  }await assert.rejects(()=>f.load({...f.config,createBiliOwnerPorts:'./arbitrary.js'}),/HOST_CONFIG_INVALID/);
  assert.deepEqual((await readdir(f.root)).sort(),['host.json','persona.md']);
});

test('the Bili task policy cannot acquire server writes, QQ scopes, other producers or arbitrary actions',async()=>{
  const f=await fixture();const mutations=[
    (policy:typeof f.config.authorityPolicies[number])=>{policy.actions.push('dafeiyu_server_execute_owner');},
    (policy:typeof f.config.authorityPolicies[number])=>{policy.externalActions=[{extensionId:'server-executor',actionId:'dafeiyu_server_execute_owner',actionVersion:'1'}];},
    (policy:typeof f.config.authorityPolicies[number])=>{policy.producers.push('qq-tasks');},
    (policy:typeof f.config.authorityPolicies[number])=>{policy.resources=[BILI_PUBLIC_SCENE,{channel:'qq',account:'12345678',kind:'private',id:'87654321'}];},
    (policy:typeof f.config.authorityPolicies[number])=>{policy.resources=[BILI_OWNER_SCENE];},
  ];for(const mutate of mutations){const config=structuredClone(f.config);mutate(config.authorityPolicies[1]!);await assert.rejects(()=>f.load(config),/HOST_BILI_OWNER_(TASK_POLICY_REQUIRED|RESOURCE_DENIED)/);}
});

test('Bili exploration requires tracked memory and actual public Bili/media providers while text-only channel use remains explicit',async()=>{
  const f=await fixture();for(const missing of ['bilibili','media']){const config=structuredClone(f.config);config.plugins=config.plugins.filter(plugin=>plugin.id!==missing);await assert.rejects(()=>f.load(config),/HOST_BILI_OWNER_EXPLORATION_REQUIRED/);}
  const untracked=structuredClone(f.config);untracked.plugins.find(plugin=>plugin.id==='memory')!.config={};await assert.rejects(()=>f.load(untracked),/HOST_BILI_OWNER_SOURCE_TRACKING_REQUIRED/);
  const text=structuredClone(f.config);text.plugins=text.plugins.filter(plugin=>!['bilibili','media'].includes(plugin.id));text.plugins.find(plugin=>plugin.id==='channel-bili-owner')!.config={accountUid:'10000001',ownerUid:'10000002',tasks:{enabled:false}};text.authorityPolicies=[];
  assert.ok((await f.load(text)).order.includes('channel-bili-owner'));
});
