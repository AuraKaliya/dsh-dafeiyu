import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Context} from '@deepseek-ai/cordis';
import {QqStore,GroupDirectory,GroupSyncConfigSchema} from '@dafeiyu/qq';
import {QqCapabilities,qqResourceRoute} from '../packages/channel-qq/lib/capabilities.js';
import type {Extension,ResourceProof,Conversation,ExecutionContext} from '@dafeiyu/contracts';
import type {DafeiyuService} from '../packages/core/lib/index.js';
import {testTempDir} from './test-temp.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('QQ observation proofs pin the group grant across rejoin, including empty pages and asynchronous reads',async()=>{
  const root=await mkdtemp(join(testTempDir(),'qq-proof-generation-')),qq=new QqStore(join(root,'qq.sqlite')),ctx=new Context();let joined=true,extension!:Extension;
  const group:Conversation={channel:'qq',account:'100001',kind:'group',id:'300001'},privateScene:Conversation={...group,kind:'private',id:'200001'};
  const groups=new GroupDirectory({account:group.account,allowed:[group.id],store:qq,config:GroupSyncConfigSchema.parse({enabled:true}),fetchGroups:async()=>joined?[{id:group.id,name:'fixture',msgMask:1}]:[],rejectIdentity:()=>{}});await groups.start();
  ctx.provide('dafeiyu',{registerExtension:(value:Extension)=>{extension=value;return {dispose(){}};},executionAuthority:()=>{},authorizeCapabilityResource:()=>{},recordCapabilityObservation:()=>{throw new Error('UNEXPECTED_OBSERVATION');}} as unknown as DafeiyuService);
  const capabilities=new QqCapabilities(ctx,{agentId:'fish',botId:group.account,ownerId:privateScene.id,store:qq,groups,allowed:()=>true,available:()=>true,readHistory:async()=>{joined=false;await groups.refresh();joined=true;await groups.refresh();return {};}});
  try{qq.remember(qqResourceRoute(group),'message','200001','synthetic group text',{occurredAt:new Date().toISOString(),unsupported:[],groupGeneration:groups.generation(group.id)});
    const cache=qq.cache.messageProof(qqResourceRoute(group),'message'),empty=qq.cache.browse(qqResourceRoute({...group,id:'300002'}),'fixture',{requestId:'empty',limit:1,includeRecentHistory:false}).proof;
    const roots=cache.parts.map(part=>`qq:${group.account}:group:${group.id}:message:${part.id}`);
    const legacy:ResourceProof={provider:'qq-capabilities',scene:group,key:'qq-cache:'+cache.hash,version:1,hash:cache.hash,roots,detail:cache};
    const bind=(base=cache):ResourceProof=>{const detail={cache:base,groupGeneration:groups.generation(group.id)},fingerprint=hash(detail);return {...legacy,version:2,key:'qq-cache:'+fingerprint,hash:fingerprint,detail,roots:base.parts.length?roots:[`qq:${group.account}:group:${group.id}:empty-cache`]};};
    const privateScope={agentId:'fish',route:JSON.stringify(['fish','qq','100001','private','200001'])};
    const old=bind(),generation=groups.generation(group.id),epoch=extension.resourceProofs!.epoch!({agentId:'fish',route:'[]'}),privateEpoch=extension.resourceProofs!.epoch!(privateScope);
    assert.equal(extension.resourceProofs!.current(legacy),true);assert.equal(extension.resourceProofs!.current(old),true);
    const emptyCache={...empty,route:qqResourceRoute(group),parts:[]};emptyCache.hash=hash({route:emptyCache.route,parts:[]});const emptyProof=bind(emptyCache);assert.equal(extension.resourceProofs!.current(emptyProof),true);
    joined=false;await groups.refresh();assert.equal(extension.resourceProofs!.current(old),false);joined=true;await groups.refresh();assert.ok(groups.generation(group.id)>generation);
    assert.equal(extension.resourceProofs!.current(old),false);assert.equal(extension.resourceProofs!.current(legacy),false);assert.equal(extension.resourceProofs!.current(emptyProof),false);assert.notEqual(extension.resourceProofs!.epoch!({agentId:'fish',route:'[]'}),epoch);
    assert.notEqual(extension.resourceProofs!.epoch!(privateScope),privateEpoch,'owner-private source caches must see cross-group grant changes');
    assert.equal(extension.resourceProofs!.current(bind()),true,'a new authorized read may inspect retained historical cache');
    const taskId=randomUUID(),context={scope:{kind:'task',agentId:'fish',taskId,scopeKey:'fixture-task'},intentVersion:1,runId:randomUUID(),operationId:randomUUID(),signal:new AbortController().signal} as unknown as ExecutionContext;
    const action=extension.actions!.find(action=>action.id==='qq_browse')!;
    await assert.rejects(Promise.resolve().then(()=>action.execute({requestId:'race',target:group,includeRecentHistory:true},context)),/GROUP_ACCESS_REVOKED/);
  }finally{capabilities.close();groups.pause();await groups.whenIdle();qq.close();await ctx.fiber.dispose();}
});
