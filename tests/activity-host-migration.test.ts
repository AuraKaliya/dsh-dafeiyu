import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,access } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { testTempDir } from './test-temp.js';
import { loadHostConfig,initializeProfile,inspectHost,planMigration,applyMigration,verifyMigration,inspectStorage } from '@dafeiyu/host';
import { bindMigratedProfile,readManifest } from '../packages/host/lib/profile.js';

async function fixture(){const root=await mkdtemp(join(testTempDir(),'activity-migration-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
  const config={schemaVersion:1,profileId:'activity-fixture',agent:{id:'dafeiyu'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},
    modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},
    plugins:[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},{id:'memory',required:true,config:{sourceTracking:true,maintenance:{}}}] as {id:string;required:boolean;config:Record<string,unknown>}[],
    authorityPolicies:[{id:'local',producers:['host-cli'],actions:[] as string[],allowLocalWrite:true},
      {id:'activity-explore',producers:['activity'],actions:['dafeiyu_activity_plan','dafeiyu_activity_update','dafeiyu_activity_status'],allowLocalWrite:true},
      {id:'activity-maintenance',producers:['activity'],actions:['dafeiyu_memory_consolidate'],allowLocalWrite:true}]};
  await writeFile(join(root,'persona.md'),'本机虚构底色');await writeFile(file,JSON.stringify(config));const old=loadHostConfig(file);initializeProfile(old,coordination);
  return {root,file,coordination,config,old,enable:async()=>{config.plugins.push({id:'activity',required:true,config:{maintenance:true}});await writeFile(file,JSON.stringify(config));return loadHostConfig(file);}};
}

test('enabling activity in an existing profile requires explicit backed-up migration and preserves every prior memory row',async()=>{
  const f=await fixture(),prepared=await f.enable(),file=join(prepared.paths.core,'activity.sqlite');
  assert.ok(inspectHost(prepared,f.coordination).codes.includes('HOST_MIGRATION_REQUIRED'));assert.throws(()=>initializeProfile(prepared,f.coordination),/REQUIRES_EMPTY/);
  const memory=new DatabaseSync(join(prepared.paths.memory,'memory.sqlite'),{readOnly:true});const before=memory.prepare('SELECT * FROM memory_schema_migrations').all();memory.close();
  const plan=await planMigration({coreDir:prepared.paths.core,memoryDir:prepared.paths.memory,sessionsDir:prepared.paths.sessions,backupDir:join(f.root,'backups'),identity:{agentId:'dafeiyu',profileId:'activity-fixture'},activity:true});
  assert.equal(plan.files.find(p=>p.kind==='activity')?.before.exists,false);await applyMigration(plan);assert.equal(verifyMigration(plan).passed,true);assert.equal(inspectStorage(file,'activity',{agentId:'dafeiyu',profileId:'activity-fixture'}).identityMatches,true);
  assert.equal(inspectHost(prepared,f.coordination).ready,true);bindMigratedProfile(prepared);assert.ok(readManifest(prepared)?.requiredStores.includes('activity'));
  const after=new DatabaseSync(join(prepared.paths.memory,'memory.sqlite'),{readOnly:true});try{assert.deepEqual(after.prepare('SELECT * FROM memory_schema_migrations').all(),before);}finally{after.close();}
  await access(join(f.root,'backups',plan.id,'1-memory.sqlite'));assert.equal((await applyMigration(plan)).complete,true);
});

test('interruption after creating the activity sidecar resumes without overwriting it',async()=>{
  const f=await fixture(),prepared=await f.enable(),plan=await planMigration({coreDir:prepared.paths.core,memoryDir:prepared.paths.memory,sessionsDir:prepared.paths.sessions,backupDir:join(f.root,'backups'),identity:{agentId:'dafeiyu',profileId:'activity-fixture'},activity:true});
  await assert.rejects(applyMigration(plan,{afterStep:kind=>{if(kind==='activity')throw new Error('injected-after-sidecar');}}),/BACKUP_RETAINED/);
  assert.equal(inspectHost(prepared,f.coordination).ready,false);assert.equal((await applyMigration(plan)).complete,true);assert.equal(verifyMigration(plan).passed,true);
});

test('wrong activity identity and missing v11 memory tables fail during read-only inspection',async()=>{
  const f=await fixture(),prepared=await f.enable(),plan=await planMigration({coreDir:prepared.paths.core,memoryDir:prepared.paths.memory,sessionsDir:prepared.paths.sessions,backupDir:join(f.root,'backups'),identity:{agentId:'dafeiyu',profileId:'activity-fixture'},activity:true});await applyMigration(plan);
  const file=join(prepared.paths.core,'activity.sqlite'),before=await readFile(file);assert.equal(inspectStorage(file,'activity',{agentId:'another',profileId:'activity-fixture'}).identityMatches,false);assert.deepEqual(await readFile(file),before);
  const memoryFile=join(prepared.paths.memory,'memory.sqlite'),db=new DatabaseSync(memoryFile);db.exec('DROP TABLE maintenance_watermarks');db.close();
  assert.equal(inspectStorage(memoryFile,'memory').supported,false);assert.ok(inspectHost(prepared,f.coordination).codes.includes('HOST_STORAGE_UNSUPPORTED'));
});

test('the checked-in activity template declares explicit policies, source tracking and bounded scheduling',()=>{
  const config=loadHostConfig(resolve('profiles/host.activity.example.json'));assert.ok(config.order.indexOf('core-execution')<config.order.indexOf('activity'));
  assert.equal(config.plugins.find(p=>p.id==='activity')?.config.maintenance,true);assert.equal(config.plugins.find(p=>p.id==='memory')?.config.sourceTracking,true);
});
