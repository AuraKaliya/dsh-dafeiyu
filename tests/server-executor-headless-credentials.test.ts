import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { HeadlessCredentialBindingSchema,inspectPinnedModelCredential,assertPinnedCredentialDescription } from '../packages/server-executor/lib/headless-credentials.js';
import type { HeadlessCredentialBinding } from '../packages/server-executor/lib/headless-credentials.js';
import { HeadlessLaunchManifestSchema,headlessFileHash,headlessProfilePatch,loadPinnedHeadlessManifest } from '../packages/server-executor/lib/headless-manifest.js';
import type { HeadlessLaunchManifest } from '../packages/server-executor/lib/headless-manifest.js';
import { headlessFixture } from './server-executor-headless-fixture.js';
import { testTempDir } from './test-temp.js';

const fake='SYNTHETIC_MODEL_CREDENTIAL_NEVER_A_REAL_KEY',valid='version: 1\nrefs:\n  DEEPSEEK_API_KEY: '+fake+'\nrecords: {}\n';
async function credentialFixture(content=valid){const root=await mkdtemp(join(testTempDir(),'headless-credential-')),file=join(root,'synthetic-model.credentials.yaml');await writeFile(file,content,{mode:0o600});
  const binding:HeadlessCredentialBinding={credentialStore:{path:file,hash:headlessFileHash(file)},credentialName:'DEEPSEEK_API_KEY',baseURL:'https://api.deepseek.com/anthropic'};return {root,file,binding};}
async function productionFixture(){
  const f=await headlessFixture(),credential=await credentialFixture(),{offlineProvider:_offline,...base}=structuredClone(f.manifest),packages=dirname(dirname(base.installAnchor));
  const files=['dsh-credentials','dsh-credentials-local','dsh-llm-deepseek','dsh-llm-deepseek-api-key'].flatMap(name=>['package.json','lib/index.js'].map(relative=>join(packages,name,relative)));
  const manifest:HeadlessLaunchManifest=HeadlessLaunchManifestSchema.parse({...base,mode:'production',modelCredential:credential.binding,route:{...base.route,provider:'deepseek-official',model:'fictional-config-only-model',reasoningEffort:'max'},
    runtimePins:[...base.runtimePins,...files.map(path=>({path,hash:headlessFileHash(path)}))]});
  await writeFile(manifest.profilePatch.path,headlessProfilePatch(manifest,f.manifestPath));manifest.profilePatch.hash=headlessFileHash(manifest.profilePatch.path);
  await writeFile(f.manifestPath,JSON.stringify(manifest,null,2)+'\n');const hash=headlessFileHash(f.manifestPath);
  return {...f,credential,production:manifest,productionHash:hash};
}

test('production requires an explicit selected model binding and offline manifests cannot carry credentials',async()=>{
  const f=await headlessFixture(),c=await credentialFixture();try{const {offlineProvider:_offline,...base}=f.manifest;
    assert.throws(()=>HeadlessLaunchManifestSchema.parse({...base,mode:'production',route:{...base.route,provider:'deepseek-official',reasoningEffort:'max'}}));
    assert.throws(()=>HeadlessLaunchManifestSchema.parse({...f.manifest,modelCredential:c.binding}));
    assert.throws(()=>HeadlessCredentialBindingSchema.parse({...c.binding,credentialName:'QQ_ACCESS_TOKEN'}));
    for(const baseURL of ['http://api.deepseek.com/anthropic','https://user:pass@example.test/','https://example.test/?credential=fake','https://example.test/#credential'])assert.throws(()=>HeadlessCredentialBindingSchema.parse({...c.binding,baseURL}));
  }finally{await f.cleanup();}
});
test('selected-only v1 parsing returns metadata and leaves the synthetic document unchanged',async()=>{
  const f=await credentialFixture(),before=headlessFileHash(f.file),metadata=inspectPinnedModelCredential(f.binding);
  assert.deepEqual(metadata,{schemaVersion:1,credentialName:'DEEPSEEK_API_KEY',source:'file',configured:true,storeHash:before});assert.ok(!JSON.stringify(metadata).includes(fake));assert.equal(headlessFileHash(f.file),before);
});
test('legacy, malformed, empty, wrong-name and mixed-account credential documents fail without migration or value-bearing errors',async()=>{
  for(const content of ['DEEPSEEK_API_KEY: '+fake+'\n','version: 1\nrefs:\n  OTHER_MODEL_KEY: '+fake+'\n',valid.replace('records: {}','  QQ_ACCESS_TOKEN: SYNTHETIC_OTHER_ACCOUNT\nrecords: {}'),
    valid.replace('records: {}','records:\n  other/account:\n    kind: api-key\n    key: SYNTHETIC_OTHER_ACCOUNT'),valid.replace(fake,'""'),valid+'foreign: SYNTHETIC_OTHER_ACCOUNT\n','version: [\n'+fake]){
    const f=await credentialFixture(content),before=headlessFileHash(f.file);let failure:unknown;try{inspectPinnedModelCredential(f.binding);}catch(error){failure=error;}
    assert.ok(failure instanceof Error);assert.match(failure.message,/^EXECUTOR_CREDENTIAL_[A-Z_]+$/);assert.ok(!failure.message.includes(fake));assert.equal(headlessFileHash(f.file),before);
  }
});
test('metadata service checks never resolve a value and reject environment fallback or a rotation during describe',async()=>{
  const f=await credentialFixture();let resolutions=0,descriptions=0;const service={describe:async(name:unknown)=>{assert.equal(name,'DEEPSEEK_API_KEY');descriptions++;return {configured:true,source:'file',writable:true};},resolve:async()=>{resolutions++;throw new Error('NO_VALUE_RESOLUTION_ALLOWED');}};
  await assertPinnedCredentialDescription(service,f.binding);assert.equal(descriptions,1);assert.equal(resolutions,0);
  await assert.rejects(assertPinnedCredentialDescription({describe:async()=>({configured:true,source:'env'})},f.binding),/REFERENCE_MISSING/);
  await assert.rejects(assertPinnedCredentialDescription({describe:async()=>({configured:false})},f.binding),/REFERENCE_MISSING/);
  await assert.rejects(assertPinnedCredentialDescription(undefined,f.binding),/SERVICE_MISSING/);
  await assert.rejects(assertPinnedCredentialDescription({describe:async()=>{await writeFile(f.file,valid.replace(fake,'SYNTHETIC_ROTATED_MODEL_KEY'));return {configured:true,source:'file'};}},f.binding),/STORE_CHANGED/);
});
test('fixed production profile selects watch=false and the exact adapter route, and its guard rejects path changes and key rotation',async()=>{
  const f=await productionFixture();try{const pinned=await loadPinnedHeadlessManifest(f.manifestPath,f.productionHash),patch=z.array(z.object({id:z.string().optional(),disabled:z.boolean().optional(),config:z.record(z.string(),z.unknown()).optional(),insert:z.array(z.object({id:z.string(),inject:z.array(z.string()).optional()})).optional()})).parse(JSON.parse(headlessProfilePatch(f.production,f.manifestPath)));
    const credentials=patch.find(entry=>entry.id==='credentials'),adapter=patch.find(entry=>entry.id==='llm-deepseek'),budget=patch.flatMap(entry=>entry.insert??[]).find(entry=>entry.id==='dafeiyu-executor-budget');
    assert.deepEqual(credentials,{id:'credentials',disabled:false,config:{path:f.credential.file,watch:false}});assert.ok(adapter?.config);assert.ok(budget);assert.equal(adapter.config.apiKeyEnv,'DEEPSEEK_API_KEY');assert.equal(adapter.config.baseURL,f.credential.binding.baseURL);
    const models=z.array(z.object({id:z.string()})).parse(adapter.config.models);assert.equal(models.length,1);assert.equal(models[0]?.id,f.production.route.model);assert.equal(adapter.config.reasoningEffort,'max');assert.equal(adapter.config.defaultContextWindow,f.production.route.contextWindow);assert.equal(adapter.config.maxTokens,f.production.route.maxOutputTokens);assert.deepEqual(budget.inject,['credentials']);
    assert.ok(!JSON.stringify(patch).includes(fake));await writeFile(f.credential.file,valid.replace(fake,'SYNTHETIC_ROTATED_MODEL_KEY'));assert.throws(pinned.guard,/STORE_CHANGED/);
    const changed=structuredClone(f.production);changed.modelCredential!.credentialStore.path=join(f.credential.root,'other.credentials.yaml');await writeFile(f.manifestPath,JSON.stringify(changed));await assert.rejects(loadPinnedHeadlessManifest(f.manifestPath,f.productionHash),/MANIFEST_CHANGED/);
  }finally{await f.cleanup();}
});
test('missing store, wrong hash and missing official provider pins reject before any CLI or model can start',async()=>{
  const f=await productionFixture();try{assert.throws(()=>inspectPinnedModelCredential({...f.credential.binding,credentialStore:{...f.credential.binding.credentialStore,path:join(f.credential.root,'missing.yaml')}}),/STORE_UNAVAILABLE/);
    assert.throws(()=>inspectPinnedModelCredential({...f.credential.binding,credentialStore:{...f.credential.binding.credentialStore,hash:'f'.repeat(64)}}),/STORE_CHANGED/);
    const changed={...f.production,runtimePins:f.production.runtimePins.filter(pin=>!pin.path.includes('dsh-credentials-local'))};await writeFile(f.manifestPath,JSON.stringify(changed));await assert.rejects(loadPinnedHeadlessManifest(f.manifestPath,headlessFileHash(f.manifestPath)),/PROVIDER_UNPINNED/);
  }finally{await f.cleanup();}
});
test('actual installed official Credentials accepts only the synthetic store metadata without a model adapter or secret export',async()=>{
  const f=await credentialFixture(),installed=String.raw`D:\DSH\DSH Desktop\resources\app\node_modules\@deepseek-ai`,before=headlessFileHash(f.file);
  const cordis:unknown=await import(pathToFileURL(join(installed,'cordis','lib','index.js')).href),credentials:unknown=await import(pathToFileURL(join(installed,'dsh-credentials-local','lib','index.js')).href);
  if(!cordis||typeof cordis!=='object'||!('Context'in cordis)||typeof cordis.Context!=='function'||!credentials||typeof credentials!=='object'||!('default'in credentials)||typeof credentials.default!=='function')throw new Error('FIXTURE_OFFICIAL_SDK_MISSING');
  const raw:unknown=Reflect.construct(cordis.Context,[]);if(!raw||typeof raw!=='object'||!('plugin'in raw)||typeof raw.plugin!=='function'||!('get'in raw)||typeof raw.get!=='function'||!('provide'in raw)||typeof raw.provide!=='function'||!('fiber'in raw)||!raw.fiber||typeof raw.fiber!=='object'||!('dispose'in raw.fiber)||typeof raw.fiber.dispose!=='function')throw new Error('FIXTURE_CONTEXT_ABI');
  const plugin=raw.plugin,get=raw.get,provide=raw.provide,fiber=raw.fiber,dispose=raw.fiber.dispose;
  try{inspectPinnedModelCredential(f.binding);Reflect.apply(provide,raw,['launchEnvironment',{get:()=>undefined,getFrom:()=>undefined}]);await Reflect.apply(plugin,raw,[credentials.default,{path:f.file,watch:false}]);
    await assertPinnedCredentialDescription(Reflect.apply(get,raw,['credentials']),f.binding);assert.equal(Reflect.apply(get,raw,['llm']),undefined);assert.equal(headlessFileHash(f.file),before);
    await writeFile(f.file,valid.replace(fake,'SYNTHETIC_ROTATED_MODEL_KEY'));assert.throws(()=>inspectPinnedModelCredential(f.binding),/STORE_CHANGED/);
  }finally{await Reflect.apply(dispose,fiber,[]);}
});
test('actual official DeepSeek Config and resolver accept the production patch with fixed text input and zero automatic retries without HTTP',async()=>{
  const f=await productionFixture(),priorFetch=globalThis.fetch;let fetches=0;globalThis.fetch=async()=>{fetches++;throw new Error('CONFIG_VALIDATION_MUST_NOT_FETCH');};
  try{const packages=dirname(dirname(f.production.installAnchor)),sdk:unknown=await import(pathToFileURL(join(packages,'dsh-llm-deepseek-api-key','lib','index.js')).href);
    if(!sdk||typeof sdk!=='object'||!('Config'in sdk)||typeof sdk.Config!=='function'||!('plainOptions'in sdk)||typeof sdk.plainOptions!=='function'||!('resolveAdapterOptions'in sdk)||typeof sdk.resolveAdapterOptions!=='function')throw new Error('FIXTURE_DEEPSEEK_CONFIG_ABI');
    const entries=z.array(z.object({id:z.string().optional(),config:z.record(z.string(),z.unknown()).optional()})).parse(JSON.parse(headlessProfilePatch(f.production,f.manifestPath))),row=entries.find(entry=>entry.id==='llm-deepseek');assert.ok(row?.config);
    const checked:unknown=Reflect.apply(sdk.Config,undefined,[row.config]),plain:unknown=Reflect.apply(sdk.plainOptions,undefined,[checked]),environment={get:()=>undefined,getFrom:()=>undefined};
    const options=z.object({baseURL:z.string(),apiKeyEnv:z.string(),defaultContextWindow:z.number(),maxTokens:z.number(),defaults:z.object({thinking:z.string(),reasoningEffort:z.string()}),
      models:z.array(z.object({id:z.string(),inputModalities:z.array(z.string())})),retryPolicy:z.object({mode:z.literal('normal'),maxRetries:z.number()})}).parse(Reflect.apply(sdk.resolveAdapterOptions,undefined,[plain,environment]));
    assert.equal(options.baseURL,f.credential.binding.baseURL);assert.equal(options.apiKeyEnv,'DEEPSEEK_API_KEY');assert.equal(options.defaultContextWindow,f.production.route.contextWindow);assert.equal(options.maxTokens,f.production.route.maxOutputTokens);
    assert.deepEqual(options.defaults,{thinking:'enabled',reasoningEffort:'max'});assert.deepEqual(options.models.map(model=>({id:model.id,inputModalities:model.inputModalities})),[{id:f.production.route.model,inputModalities:['text']}]);assert.equal(options.retryPolicy.maxRetries,0);
    const withoutRetry={...row.config};delete withoutRetry.retryPolicy;const defaults:unknown=Reflect.apply(sdk.resolveAdapterOptions,undefined,[Reflect.apply(sdk.plainOptions,undefined,[Reflect.apply(sdk.Config,undefined,[withoutRetry])]),environment]);
    assert.equal(z.object({retryPolicy:z.object({maxRetries:z.number()})}).parse(defaults).retryPolicy.maxRetries,5);assert.equal(fetches,0);assert.ok(!JSON.stringify(options).includes(fake));
  }finally{globalThis.fetch=priorFetch;await f.cleanup();}
});
