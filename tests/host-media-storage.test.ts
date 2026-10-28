import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,mkdir,symlink } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {loadHostConfig,initializeProfile,inspectHost,inspectStorage,pluginConfig} from '@dafeiyu/host';
import { MediaStore,MediaFiles } from '@dafeiyu/media';
import { taskScopeKey } from '@dafeiyu/contracts';
import { testTempDir } from './test-temp.js';
import { mediaIoFixture,byteChunks } from './media-io-fixture.js';

async function profile(){const root=await mkdtemp(join(testTempDir(),'host-media-profile-')),file=join(root,'host.json'),config={schemaVersion:1,profileId:'fixture',agent:{id:'fish'},paths:{core:'data/core',memory:'data/memory',sessions:'data/sessions',query:'data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'persona.md',kind:'test'},
  plugins:[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},{id:"memory-growth",required:true,config:{}},{id:'media',required:true,config:{ffmpeg:process.execPath,ffprobe:process.execPath}}],authorityPolicies:[{id:'local',producers:['host-cli'],actions:[],allowLocalWrite:false}]};
  await writeFile(join(root,'persona.md'),'虚构媒体Host测试底色');await writeFile(file,JSON.stringify(config));return {root,file,config,coordination:join(root,'coordination.sqlite')};}

test('media example explicitly enables receiving without granting output or voice-task authority',()=>{
  const prepared=loadHostConfig(resolve('profiles/host.media.example.json')),qq=pluginConfig(prepared,'channel-qq')!,media=pluginConfig(prepared,'media')!;
  assert.equal(qq.media.enabled,true);assert.equal(qq.media.sendEnabled,false);assert.equal(qq.media.voiceDirectives,false);assert.equal(media.vision,undefined);assert.ok(media.documents);
  assert.ok(prepared.config.authorityPolicies.every(p=>!p.actions.includes('dafeiyu_media_reply')));
});

test('media Host configuration checks dependencies, resolves paths and initializes an explicit v2 store',async()=>{
  const f=await profile(),prepared=loadHostConfig(f.file);assert.ok(prepared.order.indexOf('memory')<prepared.order.indexOf('media'));assert.ok(prepared.order.indexOf('core-execution')<prepared.order.indexOf('media'));assert.equal(inspectHost(prepared,f.coordination).canInitialize,true);
  assert.equal(initializeProfile(prepared,f.coordination).ready,true);assert.equal(inspectStorage(join(prepared.paths.core,'media.sqlite'),'media',{agentId:'fish',profileId:'fixture'}).version,2);
  await writeFile(f.file,JSON.stringify({...f.config,plugins:f.config.plugins.filter(p=>p.id!=='memory-growth').map(p=>p.id==='timeline'?{...p,config:{execution:false}}:p)}));assert.throws(()=>loadHostConfig(f.file),/HOST_MEDIA_MEMORY_REQUIRED/);
  await writeFile(f.file,JSON.stringify({...f.config,plugins:f.config.plugins.map(p=>p.id==='memory-growth'?{...p,config:{}}:p)}));assert.doesNotThrow(()=>loadHostConfig(f.file));
});
