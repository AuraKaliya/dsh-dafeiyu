import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,mkdir,link } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { testTempDir as tmpdir } from './test-temp.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readHostStatus,loadHostConfig,claim } from '@dafeiyu/host';
import { migrationFixture } from './runtime-migration-fixture.js';
import { legacySnapshot } from './legacy-memory-fixture.js';
import { runtimeHash } from '@dafeiyu/core/runtime-store';
import { DatabaseSync } from 'node:sqlite';
import { resource } from '../packages/host/lib/paths.js';

const execute=promisify(execFile),cli=resolve('scripts/dafeiyu-host.mjs');
async function command(args:string[],extra?:string){try{const result=await execute(process.execPath,[extra??cli,...args],{cwd:resolve('.'),timeout:20000,maxBuffer:300000});return {code:0,stdout:result.stdout,values:result.stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))};}
  catch(error){if(!error||typeof error!=='object'||!('stdout'in error)||!('code'in error))throw error;const stdout=String(error.stdout);return {code:Number(error.code),stdout,values:stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))};}}
async function fixture(){const root=await mkdtemp(join(tmpdir(),'dafeiyu-host-cli-')),file=join(root,'host.json'),request=join(root,'request.json');
  const config={schemaVersion:1,profileId:'fixture',agent:{id:'dafeiyu'},paths:{core:'./core',memory:'./memory',sessions:'./sessions',query:'./query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},
    persona:{kind:'test',fixedFile:'./persona.md'},plugins:[{id:'model-scripted',required:true,config:{response:'虚构的命令验收结果'}},{id:'timeline',required:true},{id:'memory',required:true}],authorityPolicies:[{id:'local',producers:['host-cli'],actions:[],allowLocalWrite:false}],diagnostics:{snapshotIntervalMs:100}};
  await writeFile(join(root,'persona.md'),'PRIVATE_FOUNDATION_SENTINEL 虚构底色。');await writeFile(file,JSON.stringify(config));await writeFile(request,JSON.stringify({requestId:'sample',title:'虚构目标',goal:'PRIVATE_GOAL_SENTINEL',policyId:'local'}));return {root,file,request,config};}

test('CLI supports offline inspect, explicit init, one-shot run and idempotent result recovery',async()=>{const f=await fixture();
  const before=await command(['inspect','--config',f.file]);assert.equal(before.code,2);assert.equal(before.values[0].networkChecked,false);assert.equal(before.values[0].canInitialize,true);
  assert.equal((await command(['init','--config',f.file])).code,0);assert.equal((await command(['inspect','--config',f.file])).values[0].ready,true);
  const first=await command(['run','--config',f.file,'--request',f.request]);assert.equal(first.code,0);assert.equal(first.values[0].modelKind,'scripted');assert.equal(first.values[0].modelRequests.started,1);
  const second=await command(['run','--config',f.file,'--request',f.request]);assert.equal(second.code,0);assert.equal(second.values[0].runId,first.values[0].runId);assert.equal(second.values[0].modelRequests.started,0);
  const status=await command(['status','--config',f.file]);assert.equal(status.values[0].online,false);assert.equal(status.values[0].snapshot.phase,'stopped');assert.ok(!status.stdout.includes('PRIVATE_GOAL_SENTINEL'));assert.ok(!status.stdout.includes('PRIVATE_FOUNDATION_SENTINEL'));
});

test('CLI rejects forged execution identity and malformed arguments before runtime writes',async()=>{const f=await fixture();await command(['init','--config',f.file]);
  const file=join(f.root,'core/runtime.sqlite'),before=await readFile(file);await writeFile(f.request,JSON.stringify({requestId:'forged',title:'x',goal:'SECRET_SENTINEL',policyId:'local',producer:'administrator'}));
  const rejected=await command(['run','--config',f.file,'--request',f.request]);assert.equal(rejected.code,1);assert.equal(rejected.values[0].code,'HOST_REQUEST_INVALID');assert.ok(!rejected.stdout.includes('SECRET_SENTINEL'));assert.deepEqual(await readFile(file),before);
  assert.equal((await command(['start','--config',f.file,'--import','arbitrary-module'])).values[0].code,'HOST_ARGUMENT_INVALID');
});

test('CLI reports a missing model credential file during offline inspection without creating it',async()=>{const f=await fixture();await writeFile(f.file,JSON.stringify({...f.config,
  persona:{...f.config.persona,kind:'formal'},modelRoutes:{chat:{provider:'deepseek-official',model:'deepseek-flash'}},plugins:[{id:'model-deepseek',required:true,config:{credentialStore:'./missing-credentials.yaml'}},...f.config.plugins.slice(1)]}));
  const result=await command(['inspect','--config',f.file]);assert.equal(result.code,2);assert.equal(result.values[0].networkChecked,false);assert.ok(result.values[0].codes.includes('HOST_CREDENTIAL_FILE_MISSING'));
  await assert.rejects(()=>readFile(join(f.root,'missing-credentials.yaml')),{code:'ENOENT'});
});

test('CLI start follows the signal handler through drain and writes a stopped snapshot (simulated SIGINT)',async()=>{const f=await fixture();await command(['init','--config',f.file]);
  const result=await command([f.file],resolve('build-tests/host-cli-signal-fixture.js'));assert.equal(result.code,0);assert.equal(result.values[0].phase,'ready');assert.equal(result.values.at(-1).phase,'stopped');
  assert.equal((await command(['status','--config',f.file])).values[0].online,false);
});

test('status checks live lease, config hash and freshness, and rejects injected fields',async()=>{const f=await fixture();await command(['init','--config',f.file]);await command(['run','--config',f.file,'--request',f.request]);const config=loadHostConfig(f.file),file=join(config.paths.core,'host-status.json'),saved=JSON.parse(await readFile(file,'utf8'));
  const lease=claim(config.resources,{profileId:config.config.profileId,agentId:config.config.agent.id});try{
    const active={...saved,phase:'ready',accepting:true,instanceId:lease.owner.instanceId,pid:process.pid,at:new Date().toISOString()};await writeFile(file,JSON.stringify(active));assert.equal(readHostStatus(config).online,true);
    assert.equal(readHostStatus(config,undefined,Date.now()+10000).online,false);assert.ok(readHostStatus(config,undefined,Date.now()+10000).codes.includes('HOST_STATUS_STALE'));
    await writeFile(file,JSON.stringify({...active,configHash:'0'.repeat(64)}));assert.ok(readHostStatus(config).codes.includes('HOST_STATUS_CONFIG_MISMATCH'));
    await writeFile(file,JSON.stringify({...active,privateText:'PRIVATE_STATUS_SENTINEL'}));assert.throws(()=>readHostStatus(config),/HOST_STATUS_INVALID/);
  }finally{lease.release();}await writeFile(file,JSON.stringify({...saved,phase:'ready',accepting:true,at:new Date().toISOString()}));assert.equal(readHostStatus(config).online,false);
});

test('CLI migration uses fixed plans, preserves old rows and binds the selected profile',async()=>{const f=await migrationFixture(),file=join(f.root,'host.json'),plan=join(f.root,'plan.json');await writeFile(join(f.root,'persona.md'),'虚构迁移底色');
  const config={schemaVersion:1,profileId:f.identity.profileId,agent:{id:f.identity.agentId},paths:{core:f.coreDir,memory:f.memoryDir,sessions:f.sessionsDir,query:join(f.root,'query.sqlite')},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true},{id:'memory',required:true}],authorityPolicies:[]};
  await writeFile(file,JSON.stringify(config));const db=new DatabaseSync(join(f.memoryDir,'memory.sqlite'),{readOnly:true});let before;try{before=runtimeHash(legacySnapshot(db));}finally{db.close();}
  assert.equal((await command(['migrate','plan','--config',file,'--backup-dir',f.backupDir,'--out',plan])).code,0);
  assert.equal((await command(['migrate','apply','--config',file,'--plan',plan])).code,0);assert.equal((await command(['migrate','verify','--config',file,'--plan',plan])).values[0].passed,true);
  assert.equal((await command(['migrate','apply','--config',file,'--plan',plan])).code,0);
  const afterDb=new DatabaseSync(join(f.memoryDir,'memory.sqlite'),{readOnly:true});try{assert.equal(runtimeHash(legacySnapshot(afterDb)),before);}finally{afterDb.close();}
  const changed=join(f.root,'changed.json');await writeFile(changed,JSON.stringify({...config,paths:{...config.paths,core:join(f.root,'other-core')}}));assert.equal((await command(['migrate','apply','--config',changed,'--plan',plan])).values[0].code,'HOST_MIGRATION_CONFIG_MISMATCH');
});

test('different directory names cannot bypass exclusivity through a SQLite hard link',async()=>{const f=await fixture(),a=join(f.root,'a'),b=join(f.root,'b');await mkdir(a);await mkdir(b);await writeFile(join(a,'memory.sqlite'),'FICTIONAL_FILE_IDENTITY');await link(join(a,'memory.sqlite'),join(b,'memory.sqlite'));
  const coordination=join(f.root,'coordination.sqlite'),lease=claim([resource(a,'directory')],{profileId:'a',agentId:'dafeiyu'},coordination);
  try{assert.throws(()=>claim([resource(b,'directory')],{profileId:'b',agentId:'dafeiyu'},coordination),/HOST_ALREADY_OWNED/);assert.equal(await readFile(join(a,'memory.sqlite'),'utf8'),'FICTIONAL_FILE_IDENTITY');}finally{lease.release();}
});
