import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import {QqStore,GroupDirectory,GroupSyncConfigSchema} from '@dafeiyu/qq';
import {QqMedia} from '../packages/channel-qq/lib/media.js';
import {QqMediaConfigSchema} from '../packages/channel-qq/lib/media-reader.js';
import type {Extension,MediaSourceProvider,Conversation} from '@dafeiyu/contracts';
import type {DafeiyuService} from '../packages/core/lib/index.js';
import {testTempDir} from './test-temp.js';

test('group media stays revoked after rejoin and a newly received binding gets a different version',async()=>{
  const root=await mkdtemp(join(testTempDir(),'qq-media-generation-')),store=new QqStore(join(root,'qq.sqlite')),ctx=new Context();let joined=true,extension!:Extension,provider!:MediaSourceProvider;
  const scene:Conversation={channel:'qq',account:'100001',kind:'group',id:'300001'},route=JSON.stringify([scene.account,scene.kind,scene.id]);
  const groups=new GroupDirectory({account:scene.account,allowed:[scene.id],store,config:GroupSyncConfigSchema.parse({enabled:true}),fetchGroups:async()=>joined?[{id:scene.id,name:'fixture',msgMask:1}]:[],rejectIdentity:()=>{}});await groups.start();
  ctx.provide('dafeiyu',{registerExtension:(value:Extension)=>{extension=value;return {dispose(){}};},registerMediaProvider:(value:MediaSourceProvider)=>{provider=value;return ()=>{};}} as unknown as DafeiyuService);
  const media=new QqMedia(ctx,{agentId:'fish',store,api:{} as ConstructorParameters<typeof QqMedia>[1]['api'],settings:QqMediaConfigSchema.parse({cacheRoots:[root]}),allowed:()=>joined,available:()=>true,groupGeneration:target=>target.kind==='group'?groups.generation(target.id):null,sourceEpoch:()=>groups.authorityEpoch(),rejectIdentity:()=>{}});
  const parts=[{type:'file',data:{file:'synthetic-platform-handle',name:'fixture.txt'}}];
  try{store.remember(route,'message','200001','文件',{occurredAt:new Date().toISOString(),unsupported:[],groupGeneration:groups.generation(scene.id)});
    const first=media.remember(scene,'message','200001',{message:'fixture'},parts).attachments[0]!.source,description=await provider.describe(first.key);assert.ok(description);assert.equal(extension.resourceProofs!.current(description.origin),true);
    joined=false;await groups.refresh();assert.equal(await provider.describe(first.key),null);
    joined=true;await groups.refresh();assert.equal(await provider.describe(first.key),null);assert.equal(extension.resourceProofs!.current(description.origin),false);
    await assert.rejects(provider.open(first.key,null,new AbortController().signal),/SOURCE_STALE/);
    const second=media.remember(scene,'message','200001',{message:'fixture'},parts).attachments[0]!.source;assert.notEqual(second.key,first.key);assert.ok(await provider.describe(second.key));assert.equal(await provider.describe(first.key),null);
  }finally{media.close();groups.pause();await groups.whenIdle();store.close();await ctx.fiber.dispose();}
});
