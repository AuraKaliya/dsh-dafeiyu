import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {API_VERSION} from '@dafeiyu/contracts';
import type {ExtensionHandle} from '@dafeiyu/contracts';
import {LlmError} from '@deepseek-ai/dsh-llm';
import {FixtureAdapter} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';

test('conversation failure uses a program notice and never invokes a second model to explain the first failure',{timeout:30000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'conversation-fault-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');const file=join(root,'host.json');
  await writeFile(join(root,'persona.md'),'隔离测试。');await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'conversation-fault',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true}],authorityPolicies:[]}));
  const adapter=new FixtureAdapter(()=>{throw new LlmError('fixture outage','HTTP_ERROR',{status:402});}),sent:string[]=[];let channel:ExtensionHandle|undefined;
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const options:Parameters<typeof ManagedHost.start>[1]={coordination,adapter,signal:t.signal,installChannels:ctx=>{
    channel=ctx.dafeiyu.registerExtension({id:'fixture-qq',version:'1',protocolVersion:API_VERSION,agentId:'fish',channels:[{channel:'qq',account:'100001',deliver:async(reply,_signal,guard)=>{guard?.();sent.push(reply.text);return {status:'sent',receiptId:'10000'};}}]});
  }};
  let host=await ManagedHost.start(config,options);
  try{channel!.ingest({id:'owner-input',occurredAt:new Date().toISOString(),conversation:{channel:'qq',account:'100001',kind:'private',id:'200001'},sender:{id:'200001',displayName:'主人'},text:'请回答。',mainText:'请回答。'});
    await host.ctx.dafeiyu.whenIdle();assert.equal(adapter.requests.length,1);assert.equal(sent.length,1);assert.match(sent[0]!,/未完成/);assert.doesNotMatch(sent[0]!,/MODEL_|402/);
    await host.close();host=await ManagedHost.start(config,options);await host.ctx.dafeiyu.whenIdle();assert.equal(sent.length,1);assert.equal(adapter.requests.length,1);
  }finally{await host.close();}
});
