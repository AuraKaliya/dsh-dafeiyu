import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,mkdir,symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadHostConfig,initializeProfile,inspectHost,planMigration,applyMigration,verifyMigration,inspectStorage } from '@dafeiyu/host';
import { MediaStore,MediaFiles } from '@dafeiyu/media';
import { taskScopeKey } from '@dafeiyu/contracts';
import { testTempDir } from './test-temp.js';
import { migrationFixture } from './runtime-migration-fixture.js';
import { mediaIoFixture,byteChunks } from './media-io-fixture.js';

async function profile(){const root=await mkdtemp(join(testTempDir(),'host-media-profile-')),file=join(root,'host.json'),config={schemaVersion:1,profileId:'fixture',agent:{id:'fish'},paths:{core:'data/core',memory:'data/memory',sessions:'data/sessions',query:'data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'persona.md',kind:'test'},
  plugins:[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},{id:'memory',required:true,config:{sourceTracking:true}},{id:'media',required:true,config:{ffmpeg:process.execPath,ffprobe:process.execPath}}],authorityPolicies:[{id:'local',producers:['host-cli'],actions:[],allowLocalWrite:false}]};
  await writeFile(join(root,'persona.md'),'虚构媒体Host测试底色');await writeFile(file,JSON.stringify(config));return {root,file,config,coordination:join(root,'coordination.sqlite')};}
async function seeded(){const f=await migrationFixture(),base=await mediaIoFixture(),store=new MediaStore(join(f.coreDir,'media.sqlite'),f.identity,true),files=new MediaFiles(join(f.coreDir,'media'),store);await files.initialize();
  const original=base.access,scope={kind:'task' as const,agentId:'fish',taskId:original.execution.view.taskId!,scopeKey:taskScopeKey('fish',original.execution.view.taskId!)},access={...original,execution:{...original.execution,view:{...original.execution.view,scope}}};
  const source=store.rememberSource(access,base.source.description),data=Buffer.from('fixture media bytes'),ref=await files.ingest(access,'asset',source,{bytes:data.length,mime:'text/plain',stream:byteChunks(data)},new AbortController().signal);store.close();base.close();
  await mkdir(join(f.coreDir,'media-analysis'));await writeFile(join(f.coreDir,'media-analysis/session.jsonl'),'fictional analysis record\n');await writeFile(join(f.coreDir,'media/work/preserve-note.txt'),'not a formal media snapshot');
  const db=new DatabaseSync(join(f.coreDir,'media.sqlite'));db.exec('DROP TABLE media_reply_exports;DROP TABLE media_reply_heads;DROP TABLE media_reply_drafts;PRAGMA user_version=1;');db.close();return {...f,ref,data};}

test('media Host configuration checks dependencies, resolves paths and initializes an explicit v2 store',async()=>{
  const f=await profile(),prepared=loadHostConfig(f.file);assert.ok(prepared.order.indexOf('memory')<prepared.order.indexOf('media'));assert.ok(prepared.order.indexOf('core-execution')<prepared.order.indexOf('media'));assert.equal(inspectHost(prepared,f.coordination).canInitialize,true);
  assert.equal(initializeProfile(prepared,f.coordination).ready,true);assert.equal(inspectStorage(join(prepared.paths.core,'media.sqlite'),'media',{agentId:'fish',profileId:'fixture'}).version,2);
  await writeFile(f.file,JSON.stringify({...f.config,plugins:f.config.plugins.filter(p=>p.id!=='memory').map(p=>p.id==='timeline'?{...p,config:{execution:false}}:p)}));assert.throws(()=>loadHostConfig(f.file),/HOST_MEDIA_MEMORY_REQUIRED/);
  await writeFile(f.file,JSON.stringify({...f.config,plugins:f.config.plugins.map(p=>p.id==='memory'?{...p,config:{sourceTracking:false}}:p)}));assert.throws(()=>loadHostConfig(f.file),/HOST_MEDIA_SOURCE_TRACKING_REQUIRED/);
});

test('media migration backs up actual immutable objects and formal analysis, preserving rows and excluding scratch work',async()=>{
  const f=await seeded(),file=join(f.coreDir,'media.sqlite'),old=new DatabaseSync(file,{readOnly:true}),rows=old.prepare('SELECT * FROM media_asset_revisions').all();old.close();
  const plan=await planMigration({...f,media:true});assert.equal(plan.mediaFiles?.length,2);assert.ok(plan.mediaFiles?.some(p=>p.relative.includes('session.jsonl')));assert.equal(plan.files.find(p=>p.kind==='media')?.targetVersion,2);
  const done=await applyMigration(plan);assert.equal(done.complete,true);assert.equal(verifyMigration(plan).passed,true);const target=join(f.backupDir,plan.id,'media-files','media/objects',f.ref.sha256.slice(0,2),f.ref.sha256);
  assert.deepEqual(await readFile(target),f.data);assert.equal(await readFile(join(f.backupDir,plan.id,'media-files/media-analysis/session.jsonl'),'utf8'),'fictional analysis record\n');
  assert.equal(await readFile(join(f.coreDir,'media/work/preserve-note.txt'),'utf8'),'not a formal media snapshot');const current=new DatabaseSync(file,{readOnly:true});try{assert.deepEqual(current.prepare('SELECT * FROM media_asset_revisions').all(),rows);}finally{current.close();}
});

test('media migration rejects changed files, omitted inventories, unsafe paths and linked analysis directories',async()=>{
  const f=await seeded(),plan=await planMigration({...f,media:true});const {mediaFiles:_files,...omitted}=plan;await assert.rejects(applyMigration(omitted),/SNAPSHOT_REQUIRED/);
  await assert.rejects(applyMigration({...plan,mediaFiles:[{relative:'../outside',bytes:1,hash:'a'.repeat(64)}]}),/PATH_INVALID/);
  await writeFile(join(f.coreDir,'media-analysis/session.jsonl'),'changed');await assert.rejects(applyMigration(plan),/MEDIA_CHANGED/);assert.equal(inspectStorage(join(f.coreDir,'media.sqlite'),'media').version,1);
  const external=join(f.root,'unrelated');await mkdir(external);await symlink(external,join(f.coreDir,'media-analysis/alias'),'junction');await assert.rejects(planMigration({...f,media:true}),/LINK_UNSUPPORTED/);
});

test('first-time media activation on an existing profile uses migration and can resume after the new store step',async()=>{
  const f=await migrationFixture(),plan=await planMigration({...f,media:true});await assert.rejects(applyMigration(plan,{afterStep:kind=>{if(kind==='media')throw new Error('fixture interruption');}}),/BACKUP_RETAINED/);
  assert.equal(inspectStorage(join(f.coreDir,'media.sqlite'),'media',f.identity).version,2);assert.equal((await applyMigration(plan)).complete,true);assert.equal(verifyMigration(plan).passed,true);
});
