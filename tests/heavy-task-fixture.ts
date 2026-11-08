import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {Session as InspectorSession} from 'node:inspector/promises';
import {z} from 'zod';
import {API_VERSION,MessageInstructionSubmitSchema} from '@dafeiyu/contracts';
import type {Conversation,ExtensionHandle,DshToolsPort} from '@dafeiyu/contracts';
import {FixtureAdapter,textResponse,toolResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';
import {acceptanceDatabase} from './acceptance-evidence.js';
import {NativeExpression} from '../packages/memory/lib/native-expression.js';
import {ExecutionEvidence} from '../packages/core/lib/execution-evidence.js';

export const heavySample={reads:64,characters:6000,model:'scripted',maxTokens:1000000};
export async function heavyTask(signal:AbortSignal,options:{cancelAfter?:number;crashBeforeSend?:boolean;resumeRoot?:string}={}){
  const root=options.resumeRoot??await mkdtemp(join(testTempDir(),'heavy-task-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const file=join(root,'host.json'),owner:Conversation={channel:'qq',account:'100001',kind:'private',id:'200001'},version='a'.repeat(64);
  const phases:Record<string,{calls:number;totalMs:number;maxMs:number}>={};
  const originalOpen=NativeExpression.prototype.open,originalValidate=ExecutionEvidence.prototype.validate;let depth=0;
  const timed=<T>(name:string,work:()=>T)=>{const start=performance.now();try{return work();}finally{const elapsed=performance.now()-start,row=phases[name]??={calls:0,totalMs:0,maxMs:0};row.calls++;row.totalMs+=elapsed;row.maxMs=Math.max(row.maxMs,elapsed);}};
  NativeExpression.prototype.open=function(...args){return timed('expression.open',()=>originalOpen.apply(this,args));};
  ExecutionEvidence.prototype.validate=function(...args){if(depth)return originalValidate.apply(this,args);depth++;try{return timed('evidence.validate',()=>originalValidate.apply(this,args));}finally{depth--;}};
  let submitted=false,reads=0,channel:ExtensionHandle|undefined,cancelRequestedAt:number|undefined,cancelAppliedAt:number|undefined,cancelError:unknown;const sent:string[]=[];
  const adapter=new FixtureAdapter(request=>{
    if(!String(request.sessionId).startsWith('dafeiyu-task-')){if(submitted)return textResponse('已受理。');submitted=true;return toolResponse('fixture_task_submit',{requestId:'heavy-fixed'});}
    assert.match(JSON.stringify(request.messages),/禁止修改文件/);
    if(reads<heavySample.reads)return toolResponse('dsh_tool_read',{catalogVersion:version,name:'read-fixture',argumentsJson:JSON.stringify({index:reads})});
    return textResponse('六十四份资料各读取了前四千字符，剩余部分未读。未修改文件。');
  });
  const port:DshToolsPort={catalog:async()=>({version,tools:[{name:'read-fixture',description:'只读合成材料',parameters:{type:'object',properties:{index:{type:'integer'}},required:['index']}}]}),execute:async()=>assert.fail('writes forbidden'),read:async(call,scope)=>{
    assert.equal(options.resumeRoot,undefined,'Restart must not replay the completed reads');
    const {index}=z.object({index:z.number().int()}).parse(JSON.parse(call.argumentsJson));assert.equal(index,reads++);
    if(reads===options.cancelAfter){cancelRequestedAt=performance.now();setTimeout(()=>{void (async()=>{
      const detail=z.object({run:z.object({version:z.number()})}).parse(await host.ctx.dafeiyu.managementTasks('detail',{id:scope.runId}));
      await host.ctx.dafeiyu.managementTasks('cancel',{id:scope.runId,requestId:randomUUID(),expectedVersion:detail.run.version});cancelAppliedAt=performance.now();
    })().catch(error=>{cancelError=error;});},0);}
    return {effect:'none',isError:false,value:`PAGE_${index}_`+'证'.repeat(heavySample.characters)};
  }};
  if(!options.resumeRoot){await writeFile(join(root,'persona.md'),'隔离重任务验证。');await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'heavy-task',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true}],authorityPolicies:[{id:'conversation',producers:['fixture-qq'],actions:['fixture_task_submit'],allowLocalWrite:true},{id:'owner-task',producers:['fixture-tasks'],actions:['dsh_tool_read','dsh_result_read'],allowLocalWrite:true,resources:[owner]}]}));}
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');if(!options.resumeRoot)initializeProfile(config,coordination);
  const profileFile=process.env.DAFEIYU_HEAVY_PROFILE??(process.env.DAFEIYU_PERFORMANCE_DIR&&!options.cancelAfter&&!options.crashBeforeSend&&!options.resumeRoot?join(process.env.DAFEIYU_PERFORMANCE_DIR,'heavy.cpuprofile'):undefined);
  const profiler=profileFile?new InspectorSession():null;if(profiler){profiler.connect();await profiler.post('Profiler.enable');await profiler.post('Profiler.start');}
  const loop=monitorEventLoopDelay({resolution:10});loop.enable();const started=performance.now();
  const host=await ManagedHost.start(config,{coordination,adapter,signal,dshTools:port,installChannels:ctx=>{
    channel=ctx.dafeiyu.registerExtension({id:'fixture-qq',version:'1',protocolVersion:API_VERSION,agentId:'fish',channels:[{channel:'qq',account:owner.account,deliver:async()=>({status:'sent',receiptId:'notice'}),deliverTaskResult:async(reply,_anchor,_signal,guard,begin)=>{
      if(options.crashBeforeSend){process.send?.({type:'heavy-crash-ready',root});await new Promise<never>(()=>{});}
      guard();const finish=begin();try{sent.push(reply.text);return {status:'sent',receiptId:'result'};}finally{finish();}}}]});
    ctx.dafeiyu.registerExtension({id:'fixture-tasks',version:'1',protocolVersion:API_VERSION,agentId:'fish',actions:[{id:'fixture_task_submit',version:'1',description:'受理任务',inputSchema:MessageInstructionSubmitSchema,outputSchema:z.json(),effects:'local-write',scope:'conversation',execute:async(input,context)=>({status:'succeeded',effects:'confirmed',completeness:'complete',data:z.json().parse(ctx.dafeiyu.submitMessageTask(context,'fixture-tasks',{...MessageInstructionSubmitSchema.parse(input),kind:'explicit-task'})),sources:[],receipts:[]})}]});
    ctx.dafeiyu.bindMessageTasks({id:'fixture-tasks',pluginId:'fixture-tasks',channelExtensionId:'fixture-qq',channel:'qq',account:owner.account,ownerId:owner.id,policyId:'owner-task',version:'1',autoDeliver:true,active:()=>true,classify:message=>({kind:'submit',text:message.text})});
  }});
  try{if(!options.resumeRoot)channel!.ingest({id:'heavy-owner',occurredAt:new Date().toISOString(),conversation:owner,sender:{id:owner.id,displayName:'主人'},text:'核对六十四份材料的片段并报告覆盖，禁止修改文件。',mainText:'核对六十四份材料的片段并报告覆盖，禁止修改文件。'});await host.ctx.dafeiyu.whenIdle();
    // Let the delay monitor observe the last synchronous completion span as well.
    await new Promise(done=>setTimeout(done,10));
    const database=z.object({runs:z.array(z.object({state:z.string(),definition:z.object({taskId:z.string().nullable()})})),deliveries:z.array(z.object({state:z.string()})),requests:z.array(z.unknown())}).parse(acceptanceDatabase(root));
    if(cancelError)throw cancelError;
    if(options.cancelAfter){assert.equal(reads,options.cancelAfter);assert.equal(sent.length,0);assert.ok(cancelAppliedAt);assert.ok(database.runs.some(run=>run.definition.taskId&&run.state==='cancelled'));}
    else{assert.equal(reads,options.resumeRoot?0:64);assert.equal(sent.length,1);assert.equal(database.deliveries[0]?.state,'sent');}
    const report={sample:heavySample,durationMs:performance.now()-started,maxLoopDelayMs:loop.max/1e6,p99LoopDelayMs:loop.percentile(99)/1e6,phases,reads,requests:adapter.requests.length,storedRequests:database.requests.length,taskRuns:database.runs.filter(row=>row.definition.taskId).length,sent:sent[0]??null,capacity:host.ctx.dafeiyu.contextBudget().maxTokens,
      cancelResponseMs:cancelRequestedAt&&cancelAppliedAt?cancelAppliedAt-cancelRequestedAt:null,cancelSettledMs:cancelRequestedAt?performance.now()-cancelRequestedAt:null};
    console.log(JSON.stringify({kind:'heavy-task-performance',...report}));
    const target=process.env.DAFEIYU_HEAVY_REPORT??(process.env.DAFEIYU_PERFORMANCE_DIR?join(process.env.DAFEIYU_PERFORMANCE_DIR,options.resumeRoot?'recovery.json':options.cancelAfter?'cancellation.json':'heavy.json'):undefined);
    if(target){await writeFile(target+'.tmp',JSON.stringify(report,null,2)+'\n',{flag:'wx'});await rename(target+'.tmp',target);}
    return report;
  }finally{await host.close();loop.disable();NativeExpression.prototype.open=originalOpen;ExecutionEvidence.prototype.validate=originalValidate;
    if(profiler){const {profile}=await profiler.post('Profiler.stop');await writeFile(profileFile!,JSON.stringify(profile));profiler.disconnect();}}
}
