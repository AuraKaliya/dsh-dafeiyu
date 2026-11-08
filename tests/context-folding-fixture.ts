import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {API_VERSION,MessageInstructionSubmitSchema,DshResultReadSchema} from '@dafeiyu/contracts';
import type {Conversation,ExtensionHandle,DshToolsPort} from '@dafeiyu/contracts';
import {FixtureAdapter,textResponse,toolResponse,verificationResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';
import {requestMeasurements,acceptanceDatabase} from './acceptance-evidence.js';

export const contextSample={reads:12,characters:6000,firstPage:4000,reopenLimit:2000,
  goal:'检查十二份材料。纠正：只核对收到的片段，不代表读完全文。禁止修改文件。待办：最后回查第一份尾段，再报告覆盖范围。'};
const material=(index:number)=>`MATERIAL_${String(index).padStart(2,'0')}_`+'证'.repeat(contextSample.characters-12);
const record=z.object({data:z.object({page:z.object({resultId:z.uuid()})})});
/** Same decisions and coverage before/after folding; only the SDK input projection may change. */
export async function runContextFoldingFixture(signal:AbortSignal,reopenMode:'single'|'batch'|'source'='single'){
  const batch=reopenMode==='batch';
  const root=await mkdtemp(join(testTempDir(),'context-folding-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const file=join(root,'host.json'),owner:Conversation={channel:'qq',account:'100001',kind:'private',id:'200001'},version='a'.repeat(64);
  let submitted=false,step=0,reads=0,firstResult:string|undefined,channel:ExtensionHandle|undefined;const sent:string[]=[],taskInputs:string[]=[],preflight:{sessionId:string|null;bytes:number;inputHash:string}[]=[];
  const adapter=new FixtureAdapter(request=>{
    const session=String(request.sessionId);
    if(session.startsWith('memory-expression-verify-'))return verificationResponse(request);
    if(session.startsWith('dafeiyu-delivery-'))return textResponse('已核对十二份材料的开头，并补读第一份尾段。其余尾段尚未读取；未修改文件。');
    if(!session.startsWith('dafeiyu-task-')){if(submitted)return textResponse('已受理。');submitted=true;return toolResponse('fixture_task_submit',{requestId:'context-fixed-sample'});}
    const input=JSON.stringify(request.messages);taskInputs.push(input);assert.match(input,/禁止修改文件/);assert.match(input,/纠正/);assert.match(input,/待办/);
    if(!firstResult)for(const message of request.messages)if(message.role==='tool')for(const block of message.content)if(block.type==='text'){
      try{const parsed=record.safeParse(JSON.parse(block.text));if(parsed.success){firstResult=parsed.data.data.page.resultId;break;}}catch{/* Non-result tool text. */}
    }
    if(step<contextSample.reads)return toolResponse('dsh_tool_read',{catalogVersion:version,name:'read-fixture',argumentsJson:JSON.stringify({index:step++})});
    if(step++===contextSample.reads){assert.ok(firstResult);
      if(reopenMode==='source')for(const message of request.messages)if(message.role==='tool')for(const block of message.content)if(block.type==='text'){
        const folded=z.object({data:z.object({kind:z.literal('archived-tool-result'),reopen:z.object({action:z.literal('dsh_result_read'),reads:z.array(DshResultReadSchema)})})}).safeParse(JSON.parse(block.text));
        if(folded.success)return toolResponse(folded.data.data.reopen.action,folded.data.data.reopen.reads[0]);
      }
      assert.notEqual(reopenMode,'source','a scoped archive reference must be present');
      return batch?toolResponse('dsh_result_read_batch',{reads:[{resultId:firstResult,offset:4000,limit:1000},{resultId:firstResult,offset:5000,limit:1000}]}):toolResponse('dsh_result_read',{resultId:firstResult,offset:4000,limit:2000});}
    if(reopenMode==='source'){assert.ok(input.includes(material(0).slice(0,4000)));return textResponse('已回查第一份合法来源页；尾段仍待处理，未修改文件。');}
    return textResponse('十二份材料各读到前四千字符；第一份尾段已回查，其余尾段未读。禁止事项保持。');
  });
  const port:DshToolsPort={catalog:async()=>({version,tools:[{name:'read-fixture',description:'读取固定材料',parameters:{type:'object',properties:{index:{type:'integer'}},required:['index']}}]}),execute:async()=>assert.fail('no write dispatch'),read:async call=>{
    const {index}=z.object({index:z.number().int().min(0).max(11)}).parse(JSON.parse(call.argumentsJson));reads++;return {isError:false,effect:'none',value:material(index)};
  }};
  await writeFile(join(root,'persona.md'),'本机隔离上下文比较。');await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'context-folding',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true}],authorityPolicies:[{id:'conversation',producers:['fixture-qq'],actions:['fixture_task_submit'],allowLocalWrite:true},{id:'owner-task',producers:['fixture-tasks'],actions:['dsh_tool_read','dsh_result_read',...(batch?['dsh_result_read_batch']:[]),'dafeiyu_execution_source_open'],allowLocalWrite:true,resources:[owner]}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const host=await ManagedHost.start(config,{coordination,adapter,signal,dshTools:port,installChannels:ctx=>{
    ctx.root.on('llm/stream',async function*(request,next){const text=JSON.stringify({messages:request.messages,tools:request.tools??[],toolHistory:request.toolHistory??null});preflight.push({sessionId:request.sessionId??null,bytes:Buffer.byteLength(text),inputHash:createHash('sha256').update(text).digest('hex')});yield* next();},{global:true});
    channel=ctx.dafeiyu.registerExtension({id:'fixture-qq',version:'1',protocolVersion:API_VERSION,agentId:'fish',channels:[{channel:'qq',account:owner.account,deliver:async()=>({status:'sent',receiptId:'notice'}),deliverTaskResult:async(reply,_anchor,_signal,guard,begin)=>{guard();const finish=begin();try{sent.push(reply.text);return {status:'sent',receiptId:'result'};}finally{finish();}} }]});
    ctx.dafeiyu.registerExtension({id:'fixture-tasks',version:'1',protocolVersion:API_VERSION,agentId:'fish',actions:[{id:'fixture_task_submit',version:'1',description:'受理任务',inputSchema:MessageInstructionSubmitSchema,outputSchema:z.json(),effects:'local-write',scope:'conversation',execute:async(input,context)=>({status:'succeeded',effects:'confirmed',completeness:'complete',data:z.json().parse(ctx.dafeiyu.submitMessageTask(context,'fixture-tasks',{...MessageInstructionSubmitSchema.parse(input),kind:'explicit-task'})),sources:[],receipts:[]})}]});
    ctx.dafeiyu.bindMessageTasks({id:'fixture-tasks',pluginId:'fixture-tasks',channelExtensionId:'fixture-qq',channel:'qq',account:owner.account,ownerId:owner.id,policyId:'owner-task',version:'1',autoDeliver:true,active:()=>true,classify:message=>({kind:'submit',text:message.text})});
  }});
  try{channel!.ingest({id:'context-owner',occurredAt:new Date().toISOString(),conversation:owner,sender:{id:owner.id,displayName:'主人'},text:contextSample.goal,mainText:contextSample.goal});await host.ctx.dafeiyu.whenIdle();
    const database=acceptanceDatabase(root),measured=requestMeasurements(adapter.requests),taskRequests=measured.filter(row=>row.sessionId?.startsWith('dafeiyu-task-'));
    const facts=z.object({deliveries:z.array(z.object({state:z.string()})),operations:z.array(z.object({action:z.string()}))}).parse(database);
    assert.equal(reads,12);assert.equal(taskRequests.length,14);assert.equal(sent.length,1);assert.equal(facts.deliveries[0]?.state,'sent');
    assert.equal(facts.operations.filter(op=>op.action===(batch?'dsh_result_read_batch':'dsh_result_read')).length,1);
    for(let index=0;index<12;index++)assert.ok(taskInputs.some(input=>input.includes(material(index).slice(0,4000))),`material ${index} must reach a model request before folding`);
    const result={sample:contextSample,taskRequests:taskRequests.length,allRequests:measured.length,taskInputBytes:taskRequests.map(row=>row.inputBytes),totalInputBytes:measured.reduce((n,row)=>n+row.inputBytes,0),
      totalTaskInputBytes:taskRequests.reduce((n,row)=>n+row.inputBytes,0),peakTaskInputBytes:Math.max(...taskRequests.map(row=>row.inputBytes)),repeatedBodies:taskInputs.reduce((n,input)=>n+Array.from({length:12},(_,i)=>material(i).slice(0,4000)).filter(text=>input.includes(text)).length,0),
      foldedRequests:taskInputs.filter(input=>input.includes('archived-tool-result')).length,reads,reopens:1,sent:sent[0],requests:measured,database,
      taskInputs,preflight,inputUsage:host.ctx.dafeiyu.getStatus().modelUsage,capacity:host.ctx.dafeiyu.contextBudget()};
    return result;
  }finally{await host.close();}
}
export async function saveContextBaseline(result:Awaited<ReturnType<typeof runContextFoldingFixture>>){
  const file=resolve('tests/fixtures/acceptance/context-baseline.json');
  const {requests:_requests,database:_database,taskInputs:_inputs,preflight:_preflight,inputUsage:_usage,capacity:_capacity,...measurement}=result;
  try{await readFile(file);throw new Error('Baseline already exists');}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
  await writeFile(file+'.tmp',JSON.stringify({schemaVersion:1,version:'0.28.9',revision:'3d04ae4',mode:'offline-sdk',paidCalls:false,...measurement},null,2)+'\n',{flag:'wx'});await rename(file+'.tmp',file);
}
