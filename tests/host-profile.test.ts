import { loadHostConfig } from '@dafeiyu/host';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,symlink,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { testTempDir as tmpdir } from './test-temp.js';

async function fixture(){const root=await mkdtemp(join(tmpdir(),'dafeiyu-host-profile-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
  const config={schemaVersion:1,profileId:'fixture',agent:{id:'dafeiyu'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},
    modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},{id:"memory-growth",required:true,config:{}}],authorityPolicies:[{id:'local',producers:['host-cli'],actions:[],allowLocalWrite:false}]};
  await writeFile(join(root,'persona.md'),'只用于本机虚构Host验收的底色，不是真实经历。\n');await writeFile(file,JSON.stringify(config));return {root,file,config,coordination,prepared:loadHostConfig(file)};}
async function changed(f:Awaited<ReturnType<typeof fixture>>,raw:unknown){await writeFile(f.file,JSON.stringify(raw));return ()=>loadHostConfig(f.file);}

test('Host configuration resolves paths from its file and freezes actual plugin settings',async()=>{const f=await fixture(),p=f.prepared;
  assert.equal(p.paths.core,join(f.root,'data/core'));assert.equal(p.config.runtime.maxConcurrentRuns,2);assert.ok(Object.isFrozen(p.plugins[0]?.config));
  assert.ok(p.order.indexOf('timeline')<p.order.indexOf('memory'));assert.ok(p.order.indexOf('memory')<p.order.indexOf('core-execution'));
  assert.deepEqual(p.config.authorityPolicies[0]?.producers,['host-cli']);});

test('Host rejects arbitrary imports, inline secrets, actor overrides and test models in formal profiles',async()=>{const f=await fixture();
  for(const raw of [
    {...f.config,plugins:[...f.config.plugins,{id:'arbitrary-package',config:{}}]},
    {...f.config,plugins:[{id:'model-scripted',config:{response:'api_key=PRIVATE_SENTINEL'}}]},
    {...f.config,plugins:[...f.config.plugins.slice(0,2),{id:"memory-growth",config:{agentId:'another',lifecycleMode:'legacy'}}]},
    {...f.config,persona:{...f.config.persona,kind:'formal'}},
  ])assert.throws(await changed(f,raw),error=>error instanceof Error&&/^HOST_/.test(error.message)&&!error.message.includes('PRIVATE_SENTINEL'));
});

test('Host validates QQ observation dependencies and policy before any connector opens',async()=>{const f=await fixture();
  const qq={id:"qq",required:true,config:{botId:'12345678',ownerId:'87654321',groupIds:['11223344'],httpURL:'http://127.0.0.1:1/',wsURL:'ws://127.0.0.1:1/',tokenFile:'./fictional-token',capabilities:{enabled:true}}};
  const policy={id:'conversation',producers:['channel-qq'],actions:['qq_groups','qq_browse','qq_observe_select'],allowLocalWrite:true};
  const base={...f.config,paths:{...f.config.paths,channels:{qq:'./data/qq'}},authorityPolicies:[...f.config.authorityPolicies,policy]};
  assert.throws(await changed(f,{...base,plugins:[{id:'model-scripted',required:true},qq]}),/HOST_QQ_MEMORY_REQUIRED/);
  assert.doesNotThrow(await changed(f,{...base,plugins:[...f.config.plugins,qq]}));
  const plugins=[...f.config.plugins.map(p=>p.id==='memory-growth'?{...p,config:{}}:p),qq];
  for(const authorityPolicies of [f.config.authorityPolicies,[{...policy,allowLocalWrite:false}],[{...policy,actions:['qq_browse']}]] )
    assert.throws(await changed(f,{...base,plugins,authorityPolicies}),/HOST_QQ_CAPABILITY_POLICY_REQUIRED/);
  const prepared=(await changed(f,{...base,plugins}))();assert.ok(prepared.order.indexOf('core-execution')<prepared.order.indexOf('channel-qq'));
  assert.ok(prepared.order.indexOf('memory')<prepared.order.indexOf('channel-qq'));
  const taskQq={...qq,config:{...qq.config,tasks:{enabled:true}}},taskPlugins=[...plugins.filter(p=>p.id!=='qq'),taskQq];
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
