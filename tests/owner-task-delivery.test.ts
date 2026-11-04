import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {API_VERSION,MessageInstructionSubmitSchema} from '@dafeiyu/contracts';
import type {Conversation,ExtensionHandle,Reply} from '@dafeiyu/contracts';
import {QqStore,GroupDirectory,GroupSyncConfigSchema} from '@dafeiyu/qq';
import {QqCapabilities,qqResourceRoute} from '../packages/channel-qq/lib/capabilities.js';
import {FixtureAdapter,textResponse,toolResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';

test('an owner task delivers the actual group text and mention evidence through the native result verifier',{timeout:30000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'owner-task-delivery-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const owner:Conversation={channel:'qq',account:'100001',kind:'private',id:'200001'},group:Conversation={...owner,kind:'group',id:'300001'};
  const qq=new QqStore(join(root,'qq.sqlite')),groups=new GroupDirectory({account:owner.account,allowed:[group.id],store:qq,config:GroupSyncConfigSchema.parse({enabled:true}),fetchGroups:async()=>[{id:group.id,name:'fixture group',msgMask:1}],rejectIdentity:()=>{}});await groups.start();
  qq.remember(qqResourceRoute(group),'group-message',owner.id,'GROUP_TEXT_MUST_REACH_OWNER',{occurredAt:new Date().toISOString(),unsupported:[],mentionedBot:true,groupGeneration:groups.generation(group.id)});
  let channel:ExtensionHandle|undefined,capabilities:QqCapabilities|undefined,submitted=false,taskStep=0,sawGroupEvidence=false;const delivered:Reply[]=[];
  const adapter=new FixtureAdapter(request=>{
    if(String(request.sessionId).startsWith('memory-expression-verify-'))return textResponse('{"faithful":true,"issues":[]}');
    if(String(request.sessionId).startsWith('dafeiyu-delivery-')){const text=request.messages.flatMap(message=>message.content.flatMap(block=>block.type==='text'?[block.text]:[])).join(' ');assert.match(text,/GROUP_TEXT_MUST_REACH_OWNER/);assert.match(text,/mentionedBot/);sawGroupEvidence=true;return textResponse('{"qq_messages":[{"type":"text","text":"已核对群消息 GROUP_TEXT_MUST_REACH_OWNER，确实提到了我。"}]}');}
    if(request.tools?.some(tool=>tool.name==='fixture_task_submit')){if(submitted)return textResponse('已经承接检查。');submitted=true;return toolResponse('fixture_task_submit',{requestId:'inspect-groups',title:'检查群消息'});}
    if(taskStep++===0)return toolResponse('qq_groups',{});
    if(taskStep===2)return toolResponse('qq_browse',{requestId:'read-group',target:group,limit:20});return textResponse('群原文和提及记录已取得。');
  });
  await writeFile(join(root,'persona.md'),'隔离验收。');const file=join(root,'host.json');await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'owner-delivery',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true}],authorityPolicies:[{id:'conversation',producers:['channel-qq'],actions:['fixture_task_submit'],allowLocalWrite:true},{id:'owner-task',producers:['fixture-tasks'],actions:['qq_browse','qq_groups'],resources:[]}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const host=await ManagedHost.start(config,{coordination,adapter,signal:t.signal,installChannels:ctx=>{
    channel=ctx.dafeiyu.registerExtension({id:'channel-qq',version:'1',protocolVersion:API_VERSION,agentId:'fish',channels:[{channel:'qq',account:owner.account,deliver:async reply=>({status:'sent',receiptId:reply.id}),deliverTaskResult:async(reply,_anchor,_signal,guard,begin)=>{guard();const finish=begin();try{delivered.push(reply);return {status:'sent',receiptId:'123456'};}finally{finish();}}}]});
    capabilities=new QqCapabilities(ctx,{agentId:'fish',botId:owner.account,ownerId:owner.id,store:qq,groups,available:()=>true,allowed:scene=>scene.account===owner.account&&(scene.kind==='private'?scene.id===owner.id:scene.id===group.id)});
    ctx.dafeiyu.registerExtension({id:'fixture-tasks',version:'1',protocolVersion:API_VERSION,agentId:'fish',actions:[{id:'fixture_task_submit',version:'1',description:'受理检查',inputSchema:MessageInstructionSubmitSchema,outputSchema:z.json(),effects:'local-write',execute:async(raw,context)=>({status:'succeeded',effects:'confirmed',completeness:'complete',sources:[],receipts:[],data:z.json().parse(ctx.dafeiyu.submitMessageTask(context,'fixture-tasks',{...MessageInstructionSubmitSchema.parse(raw),kind:'explicit-task'}))})}]});
    ctx.dafeiyu.bindMessageTasks({id:'fixture-tasks',pluginId:'fixture-tasks',channelExtensionId:'channel-qq',channel:'qq',account:owner.account,ownerId:owner.id,policyId:'owner-task',version:'1',autoDeliver:true,active:()=>true,classify:message=>({kind:'submit',text:message.text})});
  }});
  try{channel!.ingest({id:'owner-request',occurredAt:new Date().toISOString(),conversation:owner,sender:{id:owner.id,displayName:'主人'},text:'请检查我在群里发的消息和@标记。',mainText:'请检查我在群里发的消息和@标记。'});await host.ctx.dafeiyu.whenIdle();assert.equal(delivered.length,1);assert.match(delivered[0]!.text,/GROUP_TEXT_MUST_REACH_OWNER/);assert.equal(delivered[0]!.conversation.kind,'private');assert.equal(delivered[0]!.conversation.id,owner.id);assert.equal(sawGroupEvidence,true);
  }finally{capabilities?.close();await host.close();groups.pause();await groups.whenIdle();qq.close();}
});
