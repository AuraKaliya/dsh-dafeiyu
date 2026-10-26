import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadHostConfig,initializeProfile,inspectHost,inspectStorage,planMigration,applyMigration,verifyMigration,MigrationPlanSchema } from '@dafeiyu/host';
import { readManifest,bindMigratedProfile,layoutPaths } from '../packages/host/lib/profile.js';
import { runHostCommand } from '../packages/host/lib/cli.js';
import { runtimeHash } from '@dafeiyu/core/runtime-store';
import { BiliOwnerStore,BILI_OWNER_ACCOUNT,BILI_OWNER_UID,BILI_OWNER_SCENE,BILI_OWNER_TABLES,inspectBiliOwnerStorage } from '@dafeiyu/channel-bili-owner';
import type { BiliOwnerMessage,BiliOwnerPage,BiliOwnerIdentity } from '@dafeiyu/channel-bili-owner';
import { testTempDir } from './test-temp.js';

const identity={agentId:'fictional-fish',profileId:'host-bili-owner-storage'},binding:BiliOwnerIdentity={...identity,accountUid:BILI_OWNER_ACCOUNT,ownerUid:BILI_OWNER_UID};
const now=1793000000000,pin='a'.repeat(64),stamp='b'.repeat(64);
const plugin={id:'channel-bili-owner',required:true,config:{tasks:{enabled:false}}};
async function fixture(enabled=false){
  const root=await mkdtemp(join(testTempDir(),'host-bili-owner-storage-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
  const config={schemaVersion:1,profileId:identity.profileId,agent:{id:identity.agentId},paths:{core:'data/core',memory:'data/memory',sessions:'data/sessions',query:'data/query.sqlite'},
    modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},
      {id:'memory',required:true,config:{sourceTracking:true}}] as {id:string;required:boolean;config:Record<string,unknown>}[]};
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

test('incremental enable backs up old stores, resumes failed schema creation, then binds before handover',async()=>{
  const f=await fixture(),enabled=await f.enable(),before=rows(join(f.old.paths.memory,'memory.sqlite')),paths=readManifest(f.old)!.paths;
  assert.ok(inspectHost(enabled,f.coordination).codes.includes('HOST_MIGRATION_REQUIRED'));assert.equal(existsSync(f.database),false);assert.throws(()=>initializeProfile(enabled,f.coordination),/REQUIRES_EMPTY/);
  assert.throws(()=>bindMigratedProfile(enabled),/MIGRATION_REQUIRED/);const plan=await planMigration({...bundle(f),biliOwner:true});assert.equal(plan.files.find(value=>value.kind==='bili-owner')?.before.exists,false);
  await assert.rejects(applyMigration(plan,{afterStep:kind=>{if(kind==='bili-owner')throw new Error('fixture interrupted after schema');}}),/BACKUP_RETAINED/);
  assert.equal(inspectBiliOwnerStorage(f.database,binding).bindingReady,false);assert.throws(()=>bindMigratedProfile(enabled),/MIGRATION_REQUIRED/);
  const created=await readFile(f.database);await applyMigration(plan);assert.deepEqual(await readFile(f.database),created);assert.equal(verifyMigration(plan).passed,true);
  // Direct API callers must perform this binding before the separate handover mutates channel facts.
  bindMigratedProfile(enabled);assert.ok(readManifest(enabled)?.requiredStores.includes('bili-owner'));assert.deepEqual(readManifest(enabled)?.paths,paths);
  assert.ok(inspectHost(enabled,f.coordination).codes.includes('HOST_BILI_OWNER_HANDOVER_REQUIRED'));handover(f.database);
  assert.equal(inspectHost(enabled,f.coordination).ready,true);assert.deepEqual(rows(join(f.old.paths.memory,'memory.sqlite')),before);assert.equal(existsSync(join(f.root,'backups',plan.id,'1-memory.sqlite')),true);
});

test('an existing empty v2 is bound before handover without weakening frozen source-row verification',async()=>{
  const f=await fixture();new BiliOwnerStore(f.database,binding,true).close();const before=await readFile(f.database),enabled=await f.enable(),plan=await planMigration({...bundle(f),biliOwner:true});
  assert.equal(plan.files.find(value=>value.kind==='bili-owner')?.before.exists,true);await applyMigration(plan);assert.deepEqual(await readFile(f.database),before);assert.equal(verifyMigration(plan).passed,true);
  bindMigratedProfile(enabled);const manifest=await readFile(join(enabled.paths.core,'host-profile.json'));handover(f.database);
  assert.equal(verifyMigration(plan).passed,false);assert.equal(verifyMigration(plan).biliOwnerEvidencePreserved,false);assert.equal(inspectHost(enabled,f.coordination).ready,true);
  bindMigratedProfile(enabled);assert.deepEqual(await readFile(join(enabled.paths.core,'host-profile.json')),manifest);
});

test('existing fresh channel, unknown and sending rows are backed up unchanged and retained after disabling the plugin',async()=>{
  const f=await fixture(),initial=seedCurrent(f.database),enabled=await f.enable(),before=rows(f.database,BILI_OWNER_TABLES),bytes=await readFile(f.database),plan=await planMigration({...bundle(f),biliOwner:true});
  await applyMigration(plan);assert.equal(verifyMigration(plan).passed,true);assert.deepEqual(rows(f.database,BILI_OWNER_TABLES),before);assert.deepEqual(await readFile(f.database),bytes);
  const index=plan.files.findIndex(value=>value.kind==='bili-owner'),backup=join(f.root,'backups',plan.id,`${index}-bili-owner.sqlite`);assert.deepEqual(rows(backup,BILI_OWNER_TABLES),before);
  const imported=JSON.parse(String(before.bili_owner_handover?.[0]?.body)) as unknown;assert.deepEqual(imported,initial);assert.deepEqual(before.bili_owner_deliveries?.map(row=>row.state),['unknown','sending']);
  bindMigratedProfile(enabled);assert.equal(inspectHost(enabled,f.coordination).ready,true);await applyMigration(plan);assert.deepEqual(rows(f.database,BILI_OWNER_TABLES),before);
  f.config.plugins=f.config.plugins.filter(value=>value.id!=='channel-bili-owner');await writeFile(f.file,JSON.stringify(f.config));const disabled=loadHostConfig(f.file);
  assert.ok(readManifest(disabled)?.requiredStores.includes('bili-owner'));assert.equal(inspectHost(disabled,f.coordination).ready,true);
  const disabledPlan=await planMigration({...bundle(f),backupDir:join(f.root,'disabled-backups')});assert.equal(disabledPlan.bundle.biliOwner,undefined);assert.ok(disabledPlan.files.some(value=>value.kind==='bili-owner'));assert.deepEqual(rows(f.database,BILI_OWNER_TABLES),before);
});

test('wrong Bili owner identity and unknown schema fail read-only inspection and planning',async()=>{
  const f=await fixture(),enabled=await f.enable();new BiliOwnerStore(f.database,{...binding,agentId:'another-agent'},true).close();const original=await readFile(f.database);
  assert.equal(inspectStorage(f.database,'bili-owner',identity).identityMatches,false);assert.ok(inspectHost(enabled,f.coordination).codes.includes('HOST_PROFILE_IDENTITY_MISMATCH'));
  await assert.rejects(planMigration({...bundle(f),biliOwner:true}),/STORE_UNSUPPORTED/);assert.deepEqual(await readFile(f.database),original);
  const other=await fixture(true),db=new DatabaseSync(other.database);db.exec('PRAGMA user_version=999');db.close();const changed=await readFile(other.database);
  assert.equal(inspectStorage(other.database,'bili-owner',identity).supported,false);assert.ok(inspectHost(other.old,other.coordination).codes.includes('HOST_STORAGE_UNSUPPORTED'));
  await assert.rejects(planMigration({...bundle(other),biliOwner:true}),/STORE_UNSUPPORTED/);assert.deepEqual(await readFile(other.database),changed);
});

test('a damaged required backup prevents manifest binding even when the new Bili owner schema is valid',async()=>{
  const f=await fixture(),enabled=await f.enable(),plan=await planMigration({...bundle(f),biliOwner:true});await applyMigration(plan);assert.equal(verifyMigration(plan).passed,true);
  const backup=join(f.root,'backups',plan.id,'1-memory.sqlite'),db=new DatabaseSync(backup);db.exec('PRAGMA user_version=999');db.close();
  assert.equal(verifyMigration(plan).passed,false);assert.equal(verifyMigration(plan).biliOwnerEvidencePreserved,false);assert.throws(()=>bindMigratedProfile(enabled),/MIGRATION_REQUIRED/);
  assert.equal(readManifest(enabled)?.requiredStores.includes('bili-owner'),false);assert.equal(inspectBiliOwnerStorage(f.database,binding).bindingReady,false);
});

test('legacy plans keep their absent field and hash, and old profile layout/manifest bytes stay unchanged',async()=>{
  const f=await fixture(),manifest=await readFile(join(f.old.paths.core,'host-profile.json')),configHash=f.old.hash,plan=await planMigration(bundle(f)),raw=JSON.parse(JSON.stringify(plan)) as unknown;
  assert.equal(Object.hasOwn(plan.bundle,'biliOwner'),false);assert.equal(plan.files.some(value=>value.kind==='bili-owner'),false);assert.deepEqual(MigrationPlanSchema.parse(raw),raw);assert.equal(runtimeHash(MigrationPlanSchema.parse(raw)),runtimeHash(raw));
  await applyMigration(plan);assert.equal(verifyMigration(plan).passed,true);assert.equal(Object.hasOwn(verifyMigration(plan),'biliOwnerEvidencePreserved'),false);bindMigratedProfile(f.old);
  assert.deepEqual(await readFile(join(f.old.paths.core,'host-profile.json')),manifest);assert.equal(loadHostConfig(f.file).hash,configHash);assert.equal(existsSync(f.database),false);
});

test('CLI explicit migration binds the Bili owner schema while leaving the handover gate closed',async()=>{
  const f=await fixture(),enabled=await f.enable(),plan=await planMigration({...bundle(f),biliOwner:true,provenance:{sourceRevision:'fictional-storage-fixture',dirty:true,configHash:enabled.hash}}),planFile=join(f.root,'plan.json');await writeFile(planFile,JSON.stringify(plan));
  const output:unknown[]=[];assert.equal(await runHostCommand({mode:'migrate',migration:'apply',config:f.file,plan:planFile},value=>output.push(value)),0);assert.equal(output.length,1);
  assert.ok(readManifest(enabled)?.requiredStores.includes('bili-owner'));assert.equal(verifyMigration(plan).passed,true);assert.ok(inspectHost(enabled,f.coordination).codes.includes('HOST_BILI_OWNER_HANDOVER_REQUIRED'));
  const state=rows(f.database,['bili_owner_poll','bili_owner_handover','bili_owner_inbound']);assert.equal(state.bili_owner_poll?.[0]?.since,null);assert.equal(state.bili_owner_handover?.length,0);assert.equal(state.bili_owner_inbound?.length,0);
});
