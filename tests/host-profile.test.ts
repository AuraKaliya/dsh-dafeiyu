import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,readdir,mkdir,symlink,rename } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadHostConfig,inspectHost,initializeProfile,claim,owners,processAlive,readManifest } from '@dafeiyu/host';
import { MEMORY_SCHEMA_VERSION } from '@dafeiyu/memory/store';
import { resource } from '../packages/host/lib/paths.js';

async function fixture(){const root=await mkdtemp(join(tmpdir(),'dafeiyu-host-profile-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
  const config={schemaVersion:1,profileId:'fixture',agent:{id:'dafeiyu'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},
    modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},{id:'memory',required:true,config:{}}],authorityPolicies:[{id:'local',producers:['host-cli'],actions:[],allowLocalWrite:false}]};
  await writeFile(join(root,'persona.md'),'只用于本机虚构Host验收的底色，不是真实经历。\n');await writeFile(file,JSON.stringify(config));return {root,file,config,coordination,prepared:loadHostConfig(file)};}
async function tree(root:string):Promise<Record<string,string>>{const result:Record<string,string>={};for(const entry of await readdir(root,{recursive:true,withFileTypes:true})){if(!entry.isFile())continue;const file=join(entry.parentPath,entry.name);result[file]=createHash('sha256').update(await readFile(file)).digest('hex');}return result;}
async function changed(f:Awaited<ReturnType<typeof fixture>>,raw:unknown){await writeFile(f.file,JSON.stringify(raw));return ()=>loadHostConfig(f.file);}

test('Host configuration resolves paths from its file and freezes actual plugin settings',async()=>{const f=await fixture(),p=f.prepared;
  assert.equal(p.paths.core,join(f.root,'data/core'));assert.equal(p.config.runtime.maxConcurrentRuns,2);assert.ok(Object.isFrozen(p.plugins[0]?.config));
  assert.ok(p.order.indexOf('timeline')<p.order.indexOf('memory'));assert.ok(p.order.indexOf('memory')<p.order.indexOf('core-execution'));
  assert.deepEqual(p.config.authorityPolicies[0]?.producers,['host-cli']);});

test('Host rejects arbitrary imports, inline secrets, actor overrides and test models in formal profiles',async()=>{const f=await fixture();
  for(const raw of [
    {...f.config,plugins:[...f.config.plugins,{id:'arbitrary-package',config:{}}]},
    {...f.config,plugins:[{id:'model-scripted',config:{response:'api_key=PRIVATE_SENTINEL'}}]},
    {...f.config,plugins:[...f.config.plugins.slice(0,2),{id:'memory',config:{agentId:'another',lifecycleMode:'legacy'}}]},
    {...f.config,persona:{...f.config.persona,kind:'formal'}},
  ])assert.throws(await changed(f,raw),error=>error instanceof Error&&/^HOST_/.test(error.message)&&!error.message.includes('PRIVATE_SENTINEL'));
});

test('the checked-in QQ example declares the actual task, observation and delivery dependencies',()=>{
  const config=loadHostConfig(resolve('profiles/host.qq.example.json')),qq=config.plugins.find(plugin=>plugin.id==='channel-qq')!;
  assert.deepEqual(qq.config.tasks,{enabled:true,deliverResults:true,policyId:'qq-task'});assert.ok(config.order.indexOf('core-execution')<config.order.indexOf('channel-qq'));
  const native=config.config.authorityPolicies.find(policy=>policy.id==='qq-task')!;assert.deepEqual(native.producers,['qq-tasks']);assert.deepEqual(native.resources,[]);assert.ok(native.actions.includes('dafeiyu_task_object'));
});

test('Host validates QQ observation dependencies and policy before any connector opens',async()=>{const f=await fixture();
  const qq={id:'channel-qq',required:true,config:{botId:'12345678',ownerId:'87654321',groupIds:['11223344'],httpURL:'http://127.0.0.1:1/',wsURL:'ws://127.0.0.1:1/',tokenFile:'./fictional-token',capabilities:{enabled:true}}};
  const policy={id:'conversation',producers:['channel-qq'],actions:['qq_groups','qq_browse','qq_observe_select'],allowLocalWrite:true};
  const base={...f.config,paths:{...f.config.paths,channels:{'channel-qq':'./data/qq'}},authorityPolicies:[...f.config.authorityPolicies,policy]};
  assert.throws(await changed(f,{...base,plugins:[{id:'model-scripted',required:true},qq]}),/HOST_QQ_MEMORY_REQUIRED/);
  assert.throws(await changed(f,{...base,plugins:[...f.config.plugins,qq]}),/HOST_QQ_SOURCE_TRACKING_REQUIRED/);
  const plugins=[...f.config.plugins.map(p=>p.id==='memory'?{...p,config:{}}:p),qq];
  for(const authorityPolicies of [f.config.authorityPolicies,[{...policy,allowLocalWrite:false}],[{...policy,actions:['qq_browse']}]] )
    assert.throws(await changed(f,{...base,plugins,authorityPolicies}),/HOST_QQ_CAPABILITY_POLICY_REQUIRED/);
  const prepared=(await changed(f,{...base,plugins}))();assert.ok(prepared.order.indexOf('core-execution')<prepared.order.indexOf('channel-qq'));
  assert.ok(prepared.order.indexOf('memory')<prepared.order.indexOf('channel-qq'));
  const taskQq={...qq,config:{...qq.config,tasks:{enabled:true}}},taskPlugins=[...plugins.filter(p=>p.id!=='channel-qq'),taskQq];
  assert.throws(await changed(f,{...base,plugins:taskPlugins}),/HOST_QQ_TASK_POLICY_REQUIRED/);
  const taskPolicy={id:'qq-task',producers:['qq-tasks'],actions:['dafeiyu_task_intent','dafeiyu_task_object'],allowLocalWrite:true};
  const taskConversation={...policy,actions:[...policy.actions,'qq_task_submit','qq_task_status','qq_task_control']};
  assert.throws(await changed(f,{...base,plugins:taskPlugins,authorityPolicies:[taskConversation,{...taskPolicy,allowLocalWrite:false}]}),/HOST_QQ_TASK_POLICY_REQUIRED/);
  assert.doesNotThrow((await changed(f,{...base,plugins:taskPlugins,authorityPolicies:[taskConversation,taskPolicy]})));
});

test('Host rejects invalid UTF8, unknown keys, missing providers and dependency cycles before initialization',async()=>{const f=await fixture();
  await writeFile(f.file,Buffer.from([0xff,0xfe]));assert.throws(()=>loadHostConfig(f.file),/HOST_CONFIG_INVALID/);
  assert.throws(await changed(f,{...f.config,unknown:true}),/HOST_CONFIG_INVALID/);
  assert.throws(await changed(f,{...f.config,plugins:f.config.plugins.filter(p=>p.id!=='timeline')}),/HOST_DEPENDENCY_UNAVAILABLE/);
  assert.throws(await changed(f,{...f.config,plugins:f.config.plugins.map(p=>p.id==='timeline'?{...p,requires:['task.repository.v1']}:p)}),/HOST_DEPENDENCY_CYCLE/);
});

test('Host rejects overlapping directories and directory junction aliases',async()=>{const f=await fixture();
  assert.throws(await changed(f,{...f.config,paths:{...f.config.paths,memory:'./data/core/memory'}}),/HOST_PATH_OVERLAP/);
  const target=join(f.root,'target'),alias=join(f.root,'alias');await mkdir(target);await symlink(target,alias,process.platform==='win32'?'junction':'dir');
  assert.throws(await changed(f,{...f.config,paths:{...f.config.paths,core:target,memory:alias}}),/HOST_PATH_OVERLAP/);
});

test('Host inspect is read-only and does not initialize missing profile or coordination files',async()=>{const f=await fixture(),before=await tree(f.root),inspection=inspectHost(f.prepared,f.coordination);
  assert.equal(inspection.ready,false);assert.equal(inspection.canInitialize,true);assert.ok(inspection.codes.includes('HOST_INITIALIZATION_REQUIRED'));assert.deepEqual(await tree(f.root),before);
});

test('Host initializes an explicit empty profile and never rewrites its foundation or existing stores',async()=>{const f=await fixture(),foundation=await readFile(join(f.root,'persona.md'));
  const initialized=initializeProfile(f.prepared,f.coordination);assert.equal(initialized.ready,true);assert.equal(initialized.stores.find(store=>store.kind==='memory')?.version,MEMORY_SCHEMA_VERSION);assert.equal(readManifest(f.prepared)?.state,'initialized');
  assert.deepEqual(await readFile(join(f.root,'persona.md')),foundation);const before=await tree(join(f.root,'data'));
  assert.equal(inspectHost(f.prepared,f.coordination).ready,true);assert.deepEqual(await tree(join(f.root,'data')),before);
  assert.throws(()=>initializeProfile(f.prepared,f.coordination),/HOST_INIT_REQUIRES_EMPTY_DIRECTORIES/);assert.deepEqual(await tree(join(f.root,'data')),before);
  const db=new DatabaseSync(join(f.prepared.paths.memory,'memory.sqlite'),{readOnly:true});try{assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,MEMORY_SCHEMA_VERSION);assert.equal(db.prepare('SELECT count(*) AS n FROM persona_candidates').get()?.n,0);}finally{db.close();}
});

test('unknown files and partial initialization are retained and cannot be reset by init',async()=>{const f=await fixture();await mkdir(f.prepared.paths.memory,{recursive:true});const file=join(f.prepared.paths.memory,'keep.txt');await writeFile(file,'PRESERVE_ME');
  assert.throws(()=>initializeProfile(f.prepared,f.coordination),/HOST_INIT_REQUIRES_EMPTY_DIRECTORIES/);assert.equal(await readFile(file,'utf8'),'PRESERVE_ME');
  const other=await fixture();initializeProfile(other.prepared,other.coordination);const manifest=readManifest(other.prepared)!;await writeFile(join(other.prepared.paths.core,'host-profile.json'),JSON.stringify({...manifest,state:'failed'}));
  assert.ok(inspectHost(other.prepared,other.coordination).codes.includes('HOST_INITIALIZATION_INCOMPLETE'));assert.throws(()=>initializeProfile(other.prepared,other.coordination),/HOST_INIT_REQUIRES_EMPTY_DIRECTORIES/);
});

test('profile identity mismatch and a missing authoritative database block startup without recreating data',async()=>{const f=await fixture();initializeProfile(f.prepared,f.coordination);
  const other=(await changed(f,{...f.config,profileId:'different'}))();assert.ok(inspectHost(other,f.coordination).codes.includes('HOST_PROFILE_IDENTITY_MISMATCH'));
  const file=join(f.prepared.paths.core,'runtime.sqlite');await rename(file,file+'.preserved');const before=await tree(join(f.root,'data'));
  assert.ok(inspectHost(f.prepared,f.coordination).codes.includes('HOST_INITIALIZATION_REQUIRED'));assert.deepEqual(await tree(join(f.root,'data')),before);
});

test('resource leases reject live aliases, shared memory and ancestor overlap without stopping the owner',async()=>{const f=await fixture();initializeProfile(f.prepared,f.coordination);const lease=claim(f.prepared.resources,{profileId:'fixture',agentId:'dafeiyu'},f.coordination);
  try{assert.equal(inspectHost(f.prepared,f.coordination).occupied,true);assert.throws(()=>claim(f.prepared.resources,{profileId:'another',agentId:'dafeiyu'},f.coordination),/HOST_ALREADY_OWNED/);
    assert.throws(()=>claim([resource(join(f.prepared.paths.memory,'nested'),'directory')],{profileId:'nested',agentId:'dafeiyu'},f.coordination),/HOST_ALREADY_OWNED/);assert.equal(processAlive(process.pid),true);
  }finally{lease.release();lease.release();}assert.equal(owners(f.coordination).length,0);
});

test('a terminated process lease is reclaimed transactionally without deleting profile files',async()=>{const f=await fixture();initializeProfile(f.prepared,f.coordination);
  const code="import {loadHostConfig,claim} from '@dafeiyu/host';const p=loadHostConfig(process.argv[1]);const lease=claim(p.resources,{profileId:p.config.profileId,agentId:p.config.agent.id},process.argv[2]);console.log(lease.owner.pid);";
  const pid=Number(execFileSync(process.execPath,['--input-type=module','-e',code,f.file,f.coordination],{cwd:resolve('.'),encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());assert.equal(processAlive(pid),false);
  const before=await tree(join(f.root,'data')),lease=claim(f.prepared.resources,{profileId:'fixture',agentId:'dafeiyu'},f.coordination);assert.equal(owners(f.coordination).length,1);lease.release();assert.deepEqual(await tree(join(f.root,'data')),before);
});
