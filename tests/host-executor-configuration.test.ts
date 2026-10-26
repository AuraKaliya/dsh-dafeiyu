import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { HostConfigSchema } from '@dafeiyu/contracts';
import type { HostConfig } from '@dafeiyu/contracts';
import { loadHostConfig,pluginConfig,initializeProfile,inspectHost,readManifest } from '@dafeiyu/host';
import { ServerExecutorPluginConfigSchema,serverExecutorScene } from '@dafeiyu/server-executor';
import { RUNTIME_SCHEMA_VERSION,runtimeHash } from '@dafeiyu/core/runtime-store';
import { MEMORY_SCHEMA_VERSION } from '@dafeiyu/memory/store';
import { testTempDir } from './test-temp.js';

const execute='dafeiyu_server_execute_owner',autonomous='dafeiyu_server_execute_autonomous',status='dafeiyu_server_execution_status';
const exact={extensionId:'server-executor',actionId:execute,actionVersion:'1'},pin='1'.repeat(64);
const object=(raw:unknown)=>z.record(z.string(),z.json()).parse(raw);
function withPlugin(config:HostConfig,id:string,settings:unknown):HostConfig{return {...config,plugins:config.plugins.map(plugin=>plugin.id===id?{...plugin,config:object(settings)}:plugin)};}
const executorSettings=(config:HostConfig)=>ServerExecutorPluginConfigSchema.parse(config.plugins.find(plugin=>plugin.id==='server-executor')?.config);

/** Configuration and explicit storage initialization only: never starts Host, DSH, a connector, or an executor. */
async function fixture(){
  const root=await mkdtemp(join(testTempDir(),'host-executor-config-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
  const settings={command:{nodePath:process.execPath,nodeHash:pin,entryPath:join(root,'fixed-launcher.js'),entryHash:pin,cwd:root,args:[join(root,'fixed-manifest.json')],profilePath:join(root,'fixed-manifest.json'),profileHash:pin,env:{}},
    route:{provider:'local-test',model:'scripted',reasoningEffort:null,contextWindow:32768,maxOutputTokens:2048,maxRequestBytes:100000},budgetAuthorizationId:'fictional-ledger',resultOwner:{account:'12345678',ownerId:'87654321'}};
  // Deliberately declare executor before its providers: actual feature dependencies must determine the order.
  const config=HostConfigSchema.parse({schemaVersion:1,profileId:'executor-config',agent:{id:'dafeiyu'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},
    modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},
    plugins:[{id:'server-executor',required:true,config:settings},{id:'memory',required:true,config:{sourceTracking:true}},{id:'timeline',required:true,config:{execution:true}},{id:'model-scripted',required:true,config:{}}],
    authorityPolicies:[{id:'owner-work',producers:['host-cli'],actions:[execute,status],allowLocalWrite:true,externalActions:[exact],resources:[serverExecutorScene('executor-config')]}]});
  await writeFile(join(root,'persona.md'),'虚构配置测试底色，不包含真实经历。\n');await writeFile(file,JSON.stringify(config));
  return {root,file,coordination,config,prepared:loadHostConfig(file)};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function changed(f:Fixture,config:unknown){await writeFile(f.file,JSON.stringify(config));return ()=>loadHostConfig(f.file);}
async function digest(file:string){return createHash('sha256').update(await readFile(file)).digest('hex');}

test('executor uses the fixed plugin and dependency graph; profile JSON cannot install an adapter or select offline mode',async()=>{
  const f=await fixture(),prepared=f.prepared;
  for(const [first,last] of [['model-scripted','core'],['core','timeline'],['timeline','memory'],['memory','core-execution'],['core-execution','server-executor']] as const){
    assert.ok(prepared.order.includes(first));assert.ok(prepared.order.includes(last));assert.ok(prepared.order.indexOf(first)<prepared.order.indexOf(last));
  }
  assert.equal(prepared.plugins.filter(plugin=>plugin.id==='server-executor').length,1);assert.ok(Object.isFrozen(prepared.plugins.find(plugin=>plugin.id==='server-executor')?.config));
  const settings=pluginConfig(prepared,'server-executor')!;assert.equal(settings.command.entryPath,join(f.root,'fixed-launcher.js'));assert.equal(Object.hasOwn(settings,'mode'),false);
  for(const field of [{mode:'offline'},{allowedTools:['pwsh']},{modulePath:join(f.root,'unreviewed-plugin.js')}])assert.throws(await changed(f,withPlugin(f.config,'server-executor',{...executorSettings(f.config),...field})),/HOST_CONFIG_INVALID/);
  assert.throws(await changed(f,{...f.config,plugins:f.config.plugins.map(plugin=>plugin.id==='server-executor'?{...plugin,id:'unreviewed-executor'}:plugin)}),/HOST_UNKNOWN_PLUGIN/);
  assert.equal(existsSync(prepared.paths.core),false);assert.equal(existsSync(prepared.paths.memory),false);assert.equal(existsSync(f.coordination),false);
});

test('executor requires a memory provider and tracked sources, while configured compaction is a legitimate tracking provider',async()=>{
  const f=await fixture(),withoutMemory=withPlugin({...f.config,plugins:f.config.plugins.filter(plugin=>plugin.id!=='memory')},'timeline',{execution:false});
  assert.throws(await changed(f,withoutMemory),/HOST_EXECUTOR_MEMORY_REQUIRED/);
  const untracked=withPlugin(f.config,'memory',{});assert.throws(await changed(f,untracked),/HOST_EXECUTOR_SOURCE_TRACKING_REQUIRED/);
  const compacted={...untracked,context:{...untracked.context,compactionInputTokens:4096}};
  assert.doesNotThrow(await changed(f,compacted));
  assert.throws(await changed(f,{...f.config,plugins:f.config.plugins.filter(plugin=>plugin.id!=='timeline')}),/HOST_DEPENDENCY_UNAVAILABLE/);
});

test('executor route and result recipient must match the Host model and actual configured QQ binding',async()=>{
  const f=await fixture(),settings=executorSettings(f.config);
  for(const route of [{...settings.route,model:'different'},{...settings.route,provider:'different'},{...settings.route,reasoningEffort:'max'}])assert.throws(await changed(f,withPlugin(f.config,'server-executor',{...settings,route})),/HOST_EXECUTOR_MODEL_ROUTE_MISMATCH/);
  const qq=HostConfigSchema.shape.plugins.element.parse({id:'channel-qq',config:{botId:'12345678',ownerId:'87654321',groupIds:[],httpURL:'http://127.0.0.1:1/',wsURL:'ws://127.0.0.1:1/',tokenFile:'./fictional-token'}});
  const bound={...f.config,paths:{...f.config.paths,channels:{'channel-qq':'./data/qq'}},plugins:[...f.config.plugins,qq]};assert.doesNotThrow(await changed(f,bound));
  for(const resultOwner of [{account:'22334455',ownerId:'87654321'},{account:'12345678',ownerId:'22334455'}])assert.throws(await changed(f,withPlugin(bound,'server-executor',{...settings,resultOwner})),/HOST_EXECUTOR_OWNER_MISMATCH/);
  assert.equal(existsSync(join(f.root,'fictional-token')),false,'configuration validation must not require or create a login file');
});

test('executor policy requires an exact external grant and its own resource; conversation policy cannot invoke it',async()=>{
  const f=await fixture(),policy=f.config.authorityPolicies[0]!;
  const {externalActions:_omitted,...missingGrant}=policy;
  for(const invalid of [missingGrant,{...policy,externalActions:[{...exact,actionVersion:'2'}]}])assert.throws(await changed(f,{...f.config,authorityPolicies:[invalid]}),/HOST_EXECUTOR_EXTERNAL_POLICY_REQUIRED/);
  for(const invalid of [{...policy,resources:[]},{...policy,resources:[serverExecutorScene('another-profile')]},{...policy,id:'conversation',producers:['channel-qq']}])assert.throws(await changed(f,{...f.config,authorityPolicies:[invalid]}),/HOST_EXECUTOR_RESOURCE_POLICY_REQUIRED/);
  // A task-bound status reader needs the resource, but does not acquire an external execution permission.
  const readOnly={...missingGrant,actions:[status],allowLocalWrite:false};const parsed=(await changed(f,{...f.config,authorityPolicies:[readOnly]}))();
  assert.equal(Object.hasOwn(parsed.config.authorityPolicies[0]!,'externalActions'),false);
});

test('autonomous executor configuration needs a separate standing authority reference, not just the owner grant',async()=>{
  const f=await fixture(),policy=f.config.authorityPolicies[0]!,autonomousPolicy={...policy,actions:[autonomous],externalActions:[{...exact,actionId:autonomous}]};
  const raw={...f.config,authorityPolicies:[autonomousPolicy]};assert.throws(await changed(f,raw),/HOST_EXECUTOR_STANDING_AUTHORITY_REQUIRED/);
  const configured=withPlugin(raw,'server-executor',{...executorSettings(raw),standingAuthority:{path:join(f.root,'authority.json'),configurationRoot:f.root,id:'fictional-standing',version:1,hash:pin}});
  const prepared=(await changed(f,configured))();assert.equal(pluginConfig(prepared,'server-executor')?.standingAuthority?.path,join(f.root,'authority.json'));
  assert.equal(existsSync(join(f.root,'authority.json')),false,'parsing a pinned reference does not assert that a live standing grant exists');
});

test('executor rejects network paths and standing authority stored in mutable Host data',async()=>{
  const f=await fixture(),settings=executorSettings(f.config);
  assert.throws(await changed(f,withPlugin(f.config,'server-executor',{...settings,command:{...settings.command,entryPath:'//fictional-host/share/launcher.js'}})),/HOST_EXECUTOR_LOCAL_PATH_REQUIRED/);
  const standing={path:join(f.root,'authority.json'),configurationRoot:f.root,id:'fictional-standing',version:1,hash:pin};
  for(const path of [join(f.prepared.paths.core,'authority.json'),join(f.prepared.paths.memory,'authority.json')])assert.throws(await changed(f,withPlugin(f.config,'server-executor',{...settings,standingAuthority:{...standing,path}})),/HOST_EXECUTOR_AUTHORITY_INSIDE_DATA/);
  assert.throws(await changed(f,withPlugin(f.config,'server-executor',{...settings,standingAuthority:{...standing,path:'//fictional-host/share/authority.json'}})),/HOST_CONFIG_INVALID/);
  assert.equal(existsSync(f.prepared.paths.core),false);assert.equal(existsSync(f.prepared.paths.memory),false);
});

test('omitted or disabled executor preserves old policy hashes and existing profile data without creating or migrating its store',async()=>{
  const f=await fixture(),legacyPolicy={id:'local',producers:['host-cli'],actions:[],allowLocalWrite:false,sourceRules:[],resources:[]};
  const legacy={...f.config,plugins:f.config.plugins.filter(plugin=>plugin.id!=='server-executor'),authorityPolicies:[legacyPolicy]};
  const before=(await changed(f,legacy))();assert.equal(Object.hasOwn(before.config.authorityPolicies[0]!,'externalActions'),false);assert.equal(runtimeHash(before.config.authorityPolicies[0]),runtimeHash(legacyPolicy));
  assert.equal(initializeProfile(before,f.coordination).ready,true);assert.equal(readManifest(before)?.requiredStores.includes('executor'),false);assert.equal(existsSync(join(before.paths.core,'executor.sqlite')),false);
  const files=[join(before.paths.core,'runtime.sqlite'),join(before.paths.memory,'memory.sqlite'),join(before.paths.core,'host-profile.json'),before.paths.foundation];
  const hashes=await Promise.all(files.map(digest));
  const disabled={...legacy,plugins:[...legacy.plugins,{...f.config.plugins.find(plugin=>plugin.id==='server-executor')!,enabled:false,required:false}]};
  const parsed=(await changed(f,disabled))();assert.equal(pluginConfig(parsed,'server-executor'),undefined);assert.equal(parsed.order.includes('server-executor'),false);assert.equal(inspectHost(parsed,f.coordination).ready,true);
  assert.equal(parsed.foundation.hash,before.foundation.hash);assert.equal(runtimeHash(parsed.config.authorityPolicies[0]),runtimeHash(legacyPolicy));assert.equal(Object.hasOwn(parsed.config.authorityPolicies[0]!,'externalActions'),false);
  assert.notEqual(parsed.hash,before.hash,'an explicitly changed JSON config gets its own hash rather than pretending to be the old config');
  assert.deepEqual(await Promise.all(files.map(digest)),hashes);assert.equal(existsSync(join(before.paths.core,'executor.sqlite')),false);
  for(const [path,version] of [[files[0]!,RUNTIME_SCHEMA_VERSION],[files[1]!,MEMORY_SCHEMA_VERSION]] as const){const db=new DatabaseSync(path,{readOnly:true});try{assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,version);}finally{db.close();}}
  const restored=(await changed(f,legacy))();assert.equal(restored.hash,before.hash);assert.equal(inspectHost(restored,f.coordination).ready,true);assert.deepEqual(await Promise.all(files.map(digest)),hashes);
});
