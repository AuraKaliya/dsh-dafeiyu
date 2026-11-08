import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {API_VERSION,RELEASE_VERSION,MessageInstructionSubmitSchema} from '@dafeiyu/contracts';
import type {Conversation,ExtensionHandle,DshToolsPort} from '@dafeiyu/contracts';
import {QqStore} from '@dafeiyu/qq';
import {QqSegmentedTransport} from '../packages/channel-qq/lib/transport.js';
import {FixtureAdapter,textResponse,toolResponse,verificationResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';
import {captureAcceptance,acceptanceDatabase,requestMeasurements} from './acceptance-evidence.js';

test('a diagnostic task actually reads the loaded sender and shares one status projection with management',{timeout:30000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'dsh-diagnostic-flow-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const file=join(root,'host.json'),loaded=resolve('packages/channel-qq/lib/transport.js'),owner:Conversation={channel:'qq',account:'100001',kind:'private',id:'200001'};
  const sender=await readFile(loaded,'utf8'),digest=createHash('sha256').update(sender).digest('hex'),lines=sender.split(/\r?\n/),position=lines.findIndex(line=>line.includes('this.host.ledger.confirm'));
  assert.ok(position>=0);const sent:string[]=[],catalogVersion='a'.repeat(64);let reads=0,submitted=false,step=0,channel:ExtensionHandle|undefined;
  const answer=()=>`已读取当前发送器 ${RELEASE_VERSION} 的片段，文件摘要 ${digest}。这段材料不能证明某条平台消息的实际发送情况。`;
  const adapter=new FixtureAdapter(request=>{
    const session=String(request.sessionId);
    if(session.startsWith('memory-expression-verify-'))return verificationResponse(request);
    if(session.startsWith('dafeiyu-delivery-')){assert.equal(reads,1);assert.ok(JSON.stringify(request.messages).includes(digest));return textResponse(answer());}
    if(!session.startsWith('dafeiyu-task-')){if(submitted)return textResponse('已受理检查。');submitted=true;return toolResponse('fixture_task_submit',{requestId:'diagnose'});}
    if(step++===0)return toolResponse('dsh_tool_list',{name:'inspect-file'});
    if(step===2)return toolResponse('dsh_tool_read',{catalogVersion,name:'inspect-file',argumentsJson:JSON.stringify({path:loaded})});
    if(step===3){assert.equal(reads,1);assert.ok(JSON.stringify(request.messages).includes(digest));return toolResponse('dafeiyu_task_outcome',{next:'complete',goalStatus:'met',reason:'已经取得指定片段并保留观察范围',requiredCapabilities:[]});}
    return textResponse(answer());
  });
  const port:DshToolsPort={catalog:async()=>({version:catalogVersion,tools:[{name:'inspect-file',description:'读取已加载发送器片段',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}]}),execute:async()=>assert.fail('diagnostic reads must not gain write dispatch'),read:async call=>{
    assert.equal(call.name,'inspect-file');assert.equal(JSON.parse(call.argumentsJson).path,loaded);const actual=await readFile(loaded,'utf8');assert.equal(actual,sender);reads++;
    return {isError:false,effect:'none',value:{path:loaded,version:RELEASE_VERSION,sha256:digest,sourceLines:lines.slice(Math.max(0,position-3),position+4)}};
  }};
  await writeFile(join(root,'persona.md'),'本机隔离验收。');await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'dsh-diagnostic',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true}],authorityPolicies:[{id:'conversation',producers:['fixture-qq'],actions:['fixture_task_submit'],allowLocalWrite:true},{id:'owner-task',producers:['fixture-tasks'],actions:['dsh_tool_list','dsh_tool_read','dsh_result_read'],allowLocalWrite:true,resources:[owner]}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);const qq=new QqStore(join(root,'qq.sqlite'));
  const transport=new QqSegmentedTransport({ledger:qq.delivery,check:async()=>{},send:async(_reply,text)=>{sent.push(text);return String(10000+sent.length);},confirmed:()=>{}});
  const host=await ManagedHost.start(config,{coordination,adapter,signal:t.signal,dshTools:port,installChannels:ctx=>{
    channel=ctx.dafeiyu.registerExtension({id:'fixture-qq',version:'1',protocolVersion:API_VERSION,agentId:'fish',channels:[{channel:'qq',account:owner.account,deliver:(reply,signal,guard)=>transport.deliver(reply,signal,guard),deliverTaskResult:(reply,_anchor,signal,guard,begin)=>transport.deliver(reply,signal,guard,begin)}]});
    ctx.dafeiyu.registerExtension({id:'fixture-tasks',version:'1',protocolVersion:API_VERSION,agentId:'fish',actions:[{id:'fixture_task_submit',version:'1',description:'受理任务',inputSchema:MessageInstructionSubmitSchema,outputSchema:z.json(),effects:'local-write',scope:'conversation',execute:async(input,context)=>({status:'succeeded',effects:'confirmed',completeness:'complete',data:z.json().parse(ctx.dafeiyu.submitMessageTask(context,'fixture-tasks',{...MessageInstructionSubmitSchema.parse(input),kind:'explicit-task'})),sources:[],receipts:[]})}]});
    ctx.dafeiyu.bindMessageTasks({id:'fixture-tasks',pluginId:'fixture-tasks',channelExtensionId:'fixture-qq',channel:'qq',account:owner.account,ownerId:owner.id,policyId:'owner-task',version:'1',autoDeliver:true,active:()=>true,classify:message=>({kind:'submit',text:message.text})});
  }});
  try{channel!.ingest({id:'owner-diagnose',occurredAt:new Date().toISOString(),conversation:owner,sender:{id:owner.id,displayName:'主人'},text:'通过DSH读取当前发送器的回执记录代码片段，并说明材料范围。',mainText:'通过DSH读取当前发送器的回执记录代码片段，并说明材料范围。'});await host.ctx.dafeiyu.whenIdle();
    const rows=await host.management('tasks','list',{}) as {id:string;taskId:string|null;progress:unknown}[],row=rows.find(item=>item.taskId)!;
    const view=host.ctx.dafeiyu.taskProgress(row.id),detail=await host.management('tasks','detail',{id:row.id}) as {progress:unknown};assert.deepEqual(row.progress,view);assert.deepEqual(detail.progress,view);
    assert.equal(view.goal.status,'met');assert.equal(view.goal.source,'agent');assert.equal(view.goal.programVerified,false);assert.equal(view.execution.state,'completed');assert.equal(view.delivery.state,'sent');
    assert.equal(view.facts.inspection.catalogCalls,1);assert.equal(view.facts.inspection.dispatchCalls,1);assert.equal(view.facts.inspection.resultReads,1);assert.equal(reads,1);assert.ok(sent.some(text=>text.includes(digest)));
    if(process.env.DAFEIYU_ACCEPTANCE_DIR)captureAcceptance('diagnostic-flow',{progress:view,database:acceptanceDatabase(root),requests:requestMeasurements(adapter.requests),sent,reads,source:{version:RELEASE_VERSION,text:sender,sha256:digest}});
  }finally{await host.close();qq.close();}
});
