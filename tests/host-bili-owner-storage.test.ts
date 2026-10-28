import {BILI_OWNER_ACCOUNT,BILI_OWNER_UID,BILI_OWNER_SCENE} from './bili-owner-identity.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {loadHostConfig,initializeProfile,inspectHost,inspectStorage} from '@dafeiyu/host';
import {readManifest,layoutPaths} from '../packages/host/lib/profile.js';
import { runHostCommand } from '../packages/host/lib/cli.js';
import { runtimeHash } from '@dafeiyu/core/runtime-store';
import { BiliOwnerStore,BILI_OWNER_TABLES,inspectBiliOwnerStorage } from '@dafeiyu/bilibili/channel';
import type { BiliOwnerMessage,BiliOwnerPage,BiliOwnerIdentity } from '@dafeiyu/bilibili/channel';
import { testTempDir } from './test-temp.js';

const identity={agentId:'fictional-fish',profileId:'host-bili-owner-storage'},binding:BiliOwnerIdentity={...identity,accountUid:BILI_OWNER_ACCOUNT,ownerUid:BILI_OWNER_UID};
const now=1793000000000,pin='a'.repeat(64),stamp='b'.repeat(64);
const plugin={id:'bilibili',required:true,config:{channel:{accountUid:'10000001',ownerUid:'10000002',tasks:{enabled:false}}}};
async function fixture(enabled=false){
  const root=await mkdtemp(join(testTempDir(),'host-bili-owner-storage-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
  const config={schemaVersion:1,profileId:identity.profileId,agent:{id:identity.agentId},paths:{core:'data/core',memory:'data/memory',sessions:'data/sessions',query:'data/query.sqlite'},
    modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},
      {id:"memory-growth",required:true,config:{}}] as {id:string;required:boolean;config:Record<string,unknown>}[]};
  if(enabled)config.plugins.push(plugin);await writeFile(join(root,'persona.md'),'虚构存储测试；不调用模型或私信平台。');await writeFile(file,JSON.stringify(config));
  const old=loadHostConfig(file),initial=initializeProfile(old,coordination),database=join(old.paths.core,'bili-owner.sqlite');
  return {root,file,coordination,config,old,initial,database,enable:async()=>{config.plugins.push(plugin);await writeFile(file,JSON.stringify(config));return loadHostConfig(file);}};
}
function bundle(f:Awaited<ReturnType<typeof fixture>>){return {coreDir:f.old.paths.core,memoryDir:f.old.paths.memory,sessionsDir:f.old.paths.sessions,backupDir:join(f.root,'backups'),identity};}
function rows(file:string,tables?:readonly string[]){const db=new DatabaseSync(file,{readOnly:true});try{const names=tables??db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>String(row.name));
  return Object.fromEntries(names.map(name=>{assert.match(name,/^[a-z_]+$/);return [name,db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()];}));}finally{db.close();}}
function handover(file:string){const store=new BiliOwnerStore(file,binding);try{return store.initializeFresh({requestId:'explicit-fictional-handover',since:now,cutoverHash:pin},now);}finally{store.close();}}
const message=(id:string):BiliOwnerMessage=>({id,seqno:id,senderUid:BILI_OWNER_UID,receiverUid:BILI_OWNER_ACCOUNT,type:1,timestamp:now/1000,text:'虚构的主人私信'});
const page=(messages:BiliOwnerMessage[]):BiliOwnerPage=>({accountUid:BILI_OWNER_ACCOUNT,ownerUid:BILI_OWNER_UID,loggedIn:true,bindingStamp:stamp,messages,hasMore:false,nextBeforeSeqno:null});
function seedCurrent(file:string){const store=new BiliOwnerStore(file,binding,true);const initial={requestId:'fixture-fresh-start',since:now-100000,cutoverHash:pin};
  try{store.initializeFresh(initial,now);
    for(const [id,terminal]of [['9007199254740993133','unknown'],['9007199254740993134','sending']] as const){const incoming=message(id);store.acceptPage(page([incoming]),store.cursor().version,1000,now);store.accepted(id,randomUUID(),now);
      const reply={id:'fixture-reply-'+id,conversation:BILI_OWNER_SCENE,sourceMessageId:id,text:'虚构交付记录，没有真实出网'};store.prepareReply(reply,now);store.begin(reply.id,now);if(terminal==='unknown')store.unknown(reply.id,'FIXTURE_UNKNOWN',now);}
    return initial;
  }finally{store.close();}}

test('Host init creates only Bili owner schema in core and requires a separate explicit handover',async()=>{
  const f=await fixture(true);assert.equal(f.initial.ready,false);assert.ok(f.initial.codes.includes('HOST_BILI_OWNER_HANDOVER_REQUIRED'));
  assert.equal(inspectStorage(f.database,'bili-owner',identity).version,2);assert.equal(inspectBiliOwnerStorage(f.database,binding).bindingReady,false);
  const state=rows(f.database,BILI_OWNER_TABLES);assert.equal(state.bili_owner_handover?.length,0);assert.equal(state.bili_owner_inbound?.length,0);assert.equal(state.bili_owner_events?.length,0);assert.equal(state.bili_owner_poll?.[0]?.since,null);
  const manifest=readManifest(f.old)!;assert.ok(manifest.requiredStores.includes('bili-owner'));assert.deepEqual(f.old.paths.channels,{});assert.deepEqual(manifest.paths,layoutPaths(f.old));
  handover(f.database);assert.equal(inspectHost(f.old,f.coordination).ready,true);assert.deepEqual(readManifest(f.old),manifest);
});
