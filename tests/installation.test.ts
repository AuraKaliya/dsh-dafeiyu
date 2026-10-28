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

test('configured DSH catalog is a conversation capability without granting host execution',()=>{
  const settings=InstallationSettingsSchema.parse({schemaVersion:1,dataDir:'data',dshTools:true,model:{model:'fixture',credentialStore:'unused'},qq:{botId:'12345678',ownerId:'87654321',tokenFile:'token',httpURL:'http://127.0.0.1:1',wsURL:'ws://127.0.0.1:1'}});
  const profile=installationProfile(settings,{schemaVersion:1,instanceId:'11111111-1111-4111-8111-111111111111',profileId:'fixture',agentId:'fish',createdAt:'2026-10-27T00:00:00.000Z',identityHash:'0'.repeat(64),biliOwner:null},'persona.md','settings.json',{scripted:true});
  const conversation=profile.authorityPolicies.find(p=>p.id==='conversation')!;assert.ok(conversation.actions.includes('dsh_tool_list'));assert.ok(!conversation.actions.includes('dsh_tool_call'));
});

test('context settings map into the generated profile without silently enabling old installations',()=>{
  const raw={schemaVersion:1,dataDir:'data',model:{model:'fixture',credentialStore:'unused'},qq:{botId:'12345678',ownerId:'87654321',tokenFile:'token',httpURL:'http://127.0.0.1:1',wsURL:'ws://127.0.0.1:1'}};
  const metadata={schemaVersion:1 as const,instanceId:'11111111-1111-4111-8111-111111111111',profileId:'fixture',agentId:'fish',createdAt:'2026-10-27T00:00:00.000Z',identityHash:'0'.repeat(64),biliOwner:null};
  const legacy=installationProfile(InstallationSettingsSchema.parse(raw),metadata,'persona.md','settings.json',{scripted:true});assert.equal(legacy.context.assembly.mode,'legacy');
  const configured=InstallationSettingsSchema.parse({...raw,context:{recentState:{shared:true},background:{limit:6}},contextBudget:{maxBytes:24000},growthMaxBytes:5000});
  const profile=installationProfile(configured,metadata,'persona.md','settings.json',{scripted:true});assert.equal(profile.context.assembly.mode,'unified');assert.equal(profile.context.assembly.background.limit,6);assert.equal(profile.context.assembly.recentState.shared,true);assert.equal(profile.context.maxBytes,24000);assert.equal(profile.persona.growthRegion.maxBytes,5000);
});

test('a local installation may explicitly extend task duration without adding a tool-call limit',()=>{
  const settings=InstallationSettingsSchema.parse({schemaVersion:1,dataDir:'data',taskTimeoutMs:1800000,phaseTimeouts:{verification:60000},model:{model:'fixture',credentialStore:'unused'},qq:{botId:'12345678',ownerId:'87654321',tokenFile:'token',httpURL:'http://127.0.0.1:1',wsURL:'ws://127.0.0.1:1'}});
  const profile=installationProfile(settings,{schemaVersion:1,instanceId:'11111111-1111-4111-8111-111111111111',profileId:'fixture',agentId:'fish',createdAt:'2026-10-27T00:00:00.000Z',identityHash:'0'.repeat(64),biliOwner:null},'persona.md','settings.json',{scripted:true});
  assert.equal(profile.runtime.turnTimeoutMs,1800000);assert.equal('maxToolCalls' in profile.runtime,false);assert.equal(profile.runtime.phaseTimeouts.verification,60000);assert.equal(profile.runtime.phaseTimeouts.render,60000);
  assert.equal(InstallationSettingsSchema.safeParse({...settings,phaseTimeouts:{verification:60001}}).success,false);
});

test('DSH account installation selects the official account route without changing API-key installations',()=>{
  const base={schemaVersion:1,dataDir:'data',model:{model:'deepseek-flash',credentialStore:'credentials.yaml'},qq:{botId:'12345678',ownerId:'87654321',tokenFile:'token',httpURL:'http://127.0.0.1:13000/',wsURL:'ws://127.0.0.1:13001/'}};
  for(const auth of [undefined,'dsh-account'] as const){const settings=InstallationSettingsSchema.parse({...base,model:{...base.model,...(auth?{auth}:{})}});
    const config=installationProfile(settings,{schemaVersion:1,instanceId:'11111111-1111-4111-8111-111111111111',profileId:'fixture',agentId:'fish',createdAt:'2026-10-27T00:00:00.000Z',identityHash:'0'.repeat(64),biliOwner:null},'persona.md','settings.json');
    assert.equal(config.modelRoutes.chat.provider,auth?'deepseek-account':'deepseek-official');assert.equal(config.plugins.find(plugin=>plugin.id==='model-deepseek')?.config.auth,auth);
  }
});
test('allowlisted and joined installations both use the one verified group directory',()=>{
  for(const joinedGroups of [false,true]){
    const settings=InstallationSettingsSchema.parse({schemaVersion:1,dataDir:'data',model:{model:'fixture',credentialStore:'unused'},qq:{botId:'12345678',ownerId:'87654321',tokenFile:'token',httpURL:'http://127.0.0.1:13000/',wsURL:'ws://127.0.0.1:13001/',groupIds:['11223344'],joinedGroups}});
    const config=installationProfile(settings,{schemaVersion:1,instanceId:'11111111-1111-4111-8111-111111111111',profileId:'fixture',agentId:'fish',createdAt:'2026-10-27T00:00:00.000Z',identityHash:'0'.repeat(64),biliOwner:null},'persona.md','settings.json',{scripted:true});
    const qq=config.plugins.find(plugin=>plugin.id==='qq');assert.ok(qq);
    assert.equal(settings.qq.messageBatch.enabled,true);assert.equal(settings.qq.messageBatch.quietMs,5000);
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
