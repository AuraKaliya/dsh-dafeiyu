import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync,writeFileSync,readdirSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { readInstallationSettings,InstallationSettingsSchema,SettingsError } from 'dsh-dafeiyu/settings';
import { prepareInstallation, installationProfile } from 'dsh-dafeiyu/installation';
import { z } from 'zod';
import { testTempDir } from './test-temp.js';

test('missing owner/model configuration reports only fields and does not initialize data',()=>{
  const root=mkdtempSync(join(testTempDir(),'installation-settings-')),file=join(root,'settings.json');writeFileSync(file,JSON.stringify({schemaVersion:1,dataDir:'data',model:{model:'',credentialStore:''},qq:{ownerId:'PRIVATE_SENTINEL'}}));
  assert.throws(()=>readInstallationSettings(file),error=>error instanceof SettingsError&&error.fields.includes('qq.botId')&&!JSON.stringify(error).includes('PRIVATE_SENTINEL'));
  assert.deepEqual(readdirSync(root),['settings.json']);
});
test('owner and bot must be supplied separately; no provider credentials or private identity defaults',()=>{
  assert.equal(InstallationSettingsSchema.safeParse({}).success,false);
  assert.equal(InstallationSettingsSchema.safeParse({schemaVersion:1,dataDir:'data',model:{model:'fixture',credentialStore:'file'},qq:{botId:'12345678',ownerId:'12345678',tokenFile:'file',httpURL:'http://127.0.0.1:13000/',wsURL:'ws://127.0.0.1:13001/'}}).success,false);
});
test('allowlisted and joined installations both use the one verified group directory',()=>{
  for(const joinedGroups of [false,true]){
    const settings=InstallationSettingsSchema.parse({schemaVersion:1,dataDir:'data',model:{model:'fixture',credentialStore:'unused'},qq:{botId:'12345678',ownerId:'87654321',tokenFile:'token',httpURL:'http://127.0.0.1:13000/',wsURL:'ws://127.0.0.1:13001/',groupIds:['11223344'],joinedGroups}});
    const config=installationProfile(settings,{schemaVersion:1,instanceId:'11111111-1111-4111-8111-111111111111',profileId:'fixture',agentId:'fish',createdAt:'2026-10-27T00:00:00.000Z',identityHash:'0'.repeat(64),biliOwner:null},'persona.md','settings.json',{scripted:true});
    const qq=config.plugins.find(plugin=>plugin.id==='qq');assert.ok(qq);
    assert.deepEqual(z.object({groupSync:z.object({enabled:z.boolean(),mode:z.string()})}).parse(qq.config).groupSync,{enabled:true,mode:joinedGroups?'joined':'allowlist'});
  }
});
test('a missing or short OneBot token is rejected before creating the instance directory',()=>{
  const root=mkdtempSync(join(testTempDir(),'installation-token-')),file=join(root,'settings.json');
  writeFileSync(file,JSON.stringify({schemaVersion:1,dataDir:'data',model:{model:'fixture',credentialStore:'unused'},qq:{botId:'12345678',ownerId:'87654321',tokenFile:'token',httpURL:'http://127.0.0.1:13000/',wsURL:'ws://127.0.0.1:13001/'}}));
  const check=()=>assert.throws(()=>prepareInstallation(file,{scripted:true}),error=>error instanceof SettingsError&&error.fields.includes('qq.tokenFile'));
  check();writeFileSync(join(root,'token'),'short-fixture');check();assert.deepEqual(readdirSync(root).sort(),['settings.json','token']);
});
test('a fresh install starts actual DSH with a simulated QQ connector, restarts and isolates a second instance',async()=>{
  const {stdout}=await promisify(execFile)(process.execPath,[resolve('build-tests/installation-runtime-fixture.js')],{cwd:resolve('.'),timeout:30000,maxBuffer:200000});
  assert.equal(JSON.parse(stdout.trim().split('\n').at(-1)!).passed,true);
});
