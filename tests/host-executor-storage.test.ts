import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp,mkdir,readFile,writeFile,unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { taskScopeKey } from '@dafeiyu/contracts';
import {loadHostConfig,initializeProfile,inspectHost,inspectStorage} from '@dafeiyu/host';
import {readManifest} from '../packages/host/lib/profile.js';

import { executorFilesSnapshot,executorSnapshotPath } from '@dafeiyu/server-executor';
import { ExecutorStore } from '@dafeiyu/server-executor/store';
import { ExecutorJobSpecSchema } from '@dafeiyu/server-executor/types';
import { testTempDir } from './test-temp.js';

const identity={agentId:'fictional-fish',profileId:'executor-storage'},hash='a'.repeat(64);
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(enabled=false){
  const root=await mkdtemp(join(testTempDir(),'host-executor-storage-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
  const executor={id:'server-executor',required:true,config:{command:{nodePath:process.execPath,nodeHash:hash,entryPath:join(root,'fixture-entry.js'),entryHash:hash,cwd:root,args:[],profilePath:join(root,'fixture-profile.json'),profileHash:hash,env:{}},
    route:{provider:'local-test',model:'scripted',reasoningEffort:null,contextWindow:32768,maxOutputTokens:2048,maxRequestBytes:100000},budgetAuthorizationId:'fictional-budget',resultOwner:{account:'12345678',ownerId:'87654321'}}};
  const config={schemaVersion:1,profileId:identity.profileId,agent:{id:identity.agentId},paths:{core:'data/core',memory:'data/memory',sessions:'data/sessions',query:'data/query.sqlite'},
    modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},
      {id:"memory-growth",required:true,config:{}}] as {id:string;required:boolean;config:Record<string,unknown>}[]};
  if(enabled)config.plugins.push(executor);
  await writeFile(join(root,'persona.md'),'受管离线夹具人格，不调用模型。');await writeFile(file,JSON.stringify(config));
  const old=loadHostConfig(file);initializeProfile(old,coordination);
  return {root,file,coordination,config,old,enable:async()=>{config.plugins.push(executor);await writeFile(file,JSON.stringify(config));return loadHostConfig(file);}};
}
function bundle(f:Awaited<ReturnType<typeof fixture>>){return {coreDir:f.old.paths.core,memoryDir:f.old.paths.memory,sessionsDir:f.old.paths.sessions,backupDir:join(f.root,'backups'),identity};}
function rows(file:string){const db=new DatabaseSync(file,{readOnly:true});try{return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>{
  const name=String(row.name);assert.match(name,/^[a-z_]+$/);return {name,rows:db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()};});}finally{db.close();}}
async function seed(core:string,state:'completed'|'unknown'='completed'){
  const file=join(core,'executor.sqlite'),taskId=randomUUID(),scope={kind:'task' as const,agentId:identity.agentId,taskId,scopeKey:taskScopeKey(identity.agentId,taskId)},store=new ExecutorStore(file,identity,true);
  try{
    const spec=ExecutorJobSpecSchema.parse({schemaVersion:1,scope,intentVersion:1,requestId:'fixture-job',authorizationKey:hash,goalHash:hash,inputHash:hash,profileHash:hash,commandHash:hash,executableHash:hash,budgetAuthorizationId:'fictional-budget'});
    const job=store.prepare(spec,{runId:randomUUID(),operationId:randomUUID(),authorizationHash:hash}).job,launch=store.claimLaunch(job.id,scope,job.version,'b'.repeat(64));
    const running=store.running(job.id,scope,launch.version,{nonceHash:launch.nonceHash!,profileHash:hash,process:{pid:74123,creationId:'simulated-storage-only-process',executableHash:hash}});
    const bytes=Buffer.from(JSON.stringify({schemaVersion:1,jobId:job.id,visible:'仅虚构结果存档；没有启动任何进程。'})),relative=`results/${job.id}.json`;
    await mkdir(join(core,'results'),{recursive:true});await writeFile(join(core,relative),bytes,{flag:'wx'});
    const link={callId:randomUUID(),reservationId:randomUUID(),requestHash:hash};store.linkBudget(job.id,scope,link);store.settleBudget(job.id,scope,{callId:link.callId,reservationId:link.reservationId,state:state==='unknown'?'unknown':'settled',settlementHash:hash});
    store.seal(job.id,scope,running.version,{state,effects:state==='unknown'?'unknown':'confirmed',sessionId:'fictional-session',exit:{code:0,signal:null,verified:state!=='unknown'},output:{relative,hash:digest(bytes),bytes:bytes.length},gaps:state==='unknown'?['EXECUTOR_TREE_UNCONTAINED']:[]});
    return {file,relative,bytes,jobId:job.id};
  }finally{store.close();}
}
