import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {API_VERSION,MessageInstructionSubmitSchema} from '@dafeiyu/contracts';
import type {ExtensionHandle} from '@dafeiyu/contracts';
import {RuntimeStore} from '@dafeiyu/core/runtime-store';
import {FixtureAdapter,textResponse,toolResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';

test('bare acknowledgements and progress queries reuse the real task instead of creating new goals',{timeout:30000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'message-intent-')),file=join(root,'host.json');
  process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  let channel:ExtensionHandle|undefined;const actions:string[]=[];let toolRequests=0,nativeDeliveries=0;const nativeReads=new Set<string>();const results:any[]=[];
  const adapter=new FixtureAdapter(request=>{
    const session=String(request.sessionId);
    if(session.startsWith('memory-expression-verify-'))return textResponse('{"faithful":true,"issues":[]}');
    if(session.startsWith('dafeiyu-task-')||session.startsWith('dafeiyu-delivery-')){if(request.tools?.some(tool=>tool.name==='dafeiyu_memory_pending')&&!nativeReads.has(session)){nativeReads.add(session);return toolResponse('dafeiyu_memory_pending',{});}return textResponse('已依据当前对话答复。');}
    toolRequests++;
    if(toolRequests>12)throw new Error('SCRIPTED_TOOL_LOOP');
    const textOf=(message:any)=>Array.isArray(message.content)?message.content.filter((block:any)=>block.type==='text').map((block:any)=>block.text).join('\n'):String(message.content??'');
    const lastUser=request.messages.findLastIndex((message:any)=>message.role==='user'&&(message.source?.kind==='user'||message.source===undefined));
    const current=lastUser<0?'':textOf(request.messages[lastUser]).split('[消息正文]\n').at(-1)!;
    const acted=lastUser>=0&&request.messages.slice(lastUser+1).some((message:any)=>message.role==='tool'||message.source?.kind==='tool'
      ||(Array.isArray(message.content)&&message.content.some((block:any)=>block.type==='tool-result'||block.type==='tool-call-result')));
    if(acted){const toolMessage=request.messages.slice(lastUser+1).findLast((message:any)=>message.role==='tool'||message.source?.kind==='tool');
      if(toolMessage){try{results.push(JSON.parse(textOf(toolMessage)));}catch{results.push(null);}}return textResponse('已处理。');}
    if(/补充/u.test(current)){actions.push('amend');return toolResponse('fixture_task_submit',{requestId:'submit-amend',intent:{relation:'amend',expectedVersion:1,delegatedDecisions:['自行过滤和选择视频']}});}
    if(/进度/u.test(current)){actions.push('status');return toolResponse('fixture_task_submit',{requestId:'submit-status',intent:{relation:'status',expectedVersion:1}});}
    if(/继续/u.test(current)){actions.push('continue');return toolResponse('fixture_task_submit',{requestId:'submit-continue',intent:{relation:'continue',expectedVersion:1,proposalRef:'task-result:00000000-0000-0000-0000-000000000000'}});}
    if(/可以/u.test(current)){actions.push('confirm');return toolResponse('fixture_task_submit',{requestId:'submit-confirm',intent:{relation:'confirm',expectedVersion:1}});}
    actions.push('new');
    return toolResponse('fixture_task_submit',{requestId:'submit-original',title:'挑选并观看养鱼视频',intent:{relation:'new',resolvedGoal:'模型整理不替换用户原话',delegatedDecisions:['由Agent选择视频']}});
  });
  await writeFile(join(root,'persona.md'),'本机虚构验收人格。');
  await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'message-intent',agent:{id:'fish'},
    paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},
    modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},
    plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true}],
    authorityPolicies:[{id:'conversation',producers:['fixture-channel'],actions:['fixture_task_submit'],allowLocalWrite:true},
      {id:'intent-task',producers:['fixture-tasks'],actions:['dafeiyu_memory_pending'],allowLocalWrite:false}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const options:Parameters<typeof ManagedHost.start>[1]={coordination,adapter,signal:t.signal,installChannels:ctx=>{
    channel=ctx.dafeiyu.registerExtension({id:'fixture-channel',version:'1',protocolVersion:API_VERSION,agentId:'fish',channels:[{
      channel:'fixture',account:'local',deliver:async(_reply,_signal,authority)=>{authority?.();return {status:'sent' as const,receiptId:'ack'};},
      deliverTaskResult:async(_reply,_anchor,_signal,authority,writeWindow)=>{authority();const end=writeWindow();try{nativeDeliveries++;return {status:'sent' as const,receiptId:'result'};}finally{end();}}}]});
    ctx.dafeiyu.registerExtension({id:'fixture-tasks',version:'1',protocolVersion:API_VERSION,agentId:'fish',actions:[{
      id:'fixture_task_submit',version:'1',description:'受理当前真实任务',inputSchema:MessageInstructionSubmitSchema,
      outputSchema:z.json(),effects:'local-write',scope:'conversation',execute:async(input,context)=>({
        status:'succeeded',effects:'confirmed',completeness:'complete',sources:[],receipts:[],
        data:(()=>{const submission={...MessageInstructionSubmitSchema.parse(input),kind:'explicit-task' as const};
        let value;if(submission.intent?.relation==='amend'){
          const original=RuntimeStore.prototype.finishMessageIntent;let interrupted=false;
          RuntimeStore.prototype.finishMessageIntent=function(...args){if(!interrupted){interrupted=true;throw new Error('SIMULATED_RECEIPT_CRASH');}return original.apply(this,args);};
          try{assert.throws(()=>ctx.dafeiyu.submitMessageTask(context,'fixture-tasks',submission),/SIMULATED_RECEIPT_CRASH/);}finally{RuntimeStore.prototype.finishMessageIntent=original;}
          value=ctx.dafeiyu.submitMessageTask(context,'fixture-tasks',submission);
        }else value=ctx.dafeiyu.submitMessageTask(context,'fixture-tasks',submission);const replay=ctx.dafeiyu.submitMessageTask(context,'fixture-tasks',{...MessageInstructionSubmitSchema.parse(input),requestId:'different-retry-id',kind:'explicit-task'});assert.deepEqual(replay,value,'The platform message, not a newly generated requestId, freezes acceptance');return z.json().parse(value);})()})}]});
    ctx.dafeiyu.bindMessageTasks({id:'fixture-tasks',pluginId:'fixture-tasks',channelExtensionId:'fixture-channel',channel:'fixture',account:'local',
      ownerId:'owner',policyId:'intent-task',version:'1',autoDeliver:true,classify:message=>({kind:'submit',text:message.mainText??''}),active:()=>true});
  }};
  const host=await ManagedHost.start(config,options);
  try{
    let messages=0;
    const say=async(text:string)=>{const id='inbound-'+(messages++);channel!.ingest({id,occurredAt:new Date().toISOString(),conversation:{channel:'fixture',account:'local',kind:'private',id:'owner'},
      sender:{id:'owner',displayName:'验收'},text,mainText:text});await host.ctx.dafeiyu.whenIdle();};
    await say('找一个养鱼视频看看，看完汇报');
    await say('可以');
    await say('进度怎么样了');
    await say('继续');
    assert.deepEqual(actions,['new','confirm','status','continue'],'Every message must reach the intended intent action');
    assert.ok(toolRequests<=8,'Scripted tool loop must fail fast instead of hanging');
    assert.equal(results.length,4,'Each intent action must return one tool receipt');
    const receipts=results.map(row=>row?.value??row);
    assert.ok(receipts.every(row=>row?.status==='succeeded'),JSON.stringify(results));
    const data=receipts.map(row=>row?.data);
    assert.ok(data[0]?.taskId&&data[0]?.runId,'The original task must be accepted');
    for(const row of data.slice(1))assert.equal(row?.accepted,false,'Confirmation, status and continue must not create a new task');
    const db=new DatabaseSync(join(root,'data/memory/memory.sqlite'),{readOnly:true});
    try{
      const tasks=db.prepare('SELECT id,version,epoch,status,body FROM task_workspaces').all() as {id:string;version:number;epoch:number;status:string;body:string}[];
      assert.equal(tasks.length,1,JSON.stringify(tasks));
      assert.match(tasks[0]!.body,/养鱼视频/);
      assert.doesNotMatch(tasks[0]!.body,/"goal":"可以"/u);
      const revisions=db.prepare('SELECT COUNT(*) AS n FROM task_revisions').get()!.n;
      assert.equal(revisions,1,'Confirmation and progress must not revise the task');
    }finally{db.close();}
    const runtime=new DatabaseSync(join(root,'data/core/runtime.sqlite'),{readOnly:true});
    try{
      const sources=runtime.prepare('SELECT body FROM execution_requests WHERE producer=? ORDER BY rowid').all('fixture-tasks') as {body:string}[];
      assert.equal(sources.length,1,'Confirmation and progress must not queue new runs');
      const source=JSON.parse(sources[0]!.body).messageSource;
      assert.equal(source?.intent?.relation,'new');
      assert.equal(source?.intent?.originalRequest?.messageId,'inbound-0');
      assert.deepEqual(source?.intent?.delegatedDecisions,['由Agent选择视频']);
      assert.equal(runtime.prepare("SELECT COUNT(*) AS n FROM runs JOIN execution_requests ON runs.request_key=execution_requests.id WHERE execution_requests.producer='fixture-tasks'").get()!.n,1,'Confirmation and progress must not add task runs');
      const events=(runtime.prepare('SELECT body FROM runtime_outbox').all() as {body:string}[]).map(row=>JSON.parse(row.body));
      const journal=new DatabaseSync(join(root,'data/core/journal.sqlite'),{readOnly:true});
      try{const platform=new Map((journal.prepare('SELECT id,message_id FROM inbox').all() as {id:string;message_id:string}[]).map(row=>[row.id,row.message_id]));
        const decisions=events.filter(event=>event.type==='task.intent.decision');
        assert.ok(decisions.some(event=>event.data.relation==='confirm'&&platform.get(event.data.inboundId)==='inbound-1'),'Confirmation must map to the real platform message and be recorded against the completed task');
        assert.ok(decisions.some(event=>event.data.relation==='continue'&&platform.get(event.data.inboundId)==='inbound-3'),'Continue against a completed task must be recorded without rerunning it');
      }finally{journal.close();}
    }finally{runtime.close();}
    const amendment='补充：如何寻找、过滤和选择由你自行决定。'+ '保留最初的题材、热度和汇报要求。'.repeat(160);
    await say(amendment);
    const revised=new DatabaseSync(join(root,'data/memory/memory.sqlite'),{readOnly:true});
    try{const tasks=revised.prepare('SELECT version,epoch,body FROM task_workspaces').all();assert.equal(tasks.length,1);assert.equal(tasks[0]!.version,2);assert.equal(tasks[0]!.epoch,2);
      const body=JSON.parse(String(tasks[0]!.body));assert.match(body.goal,/找一个养鱼视频看看，看完汇报/);assert.ok(body.goal.endsWith(amendment),'No silent 2000-character truncation');}
    finally{revised.close();}
    const persisted=new DatabaseSync(join(root,'data/core/runtime.sqlite'),{readOnly:true});
    try{const decisions=persisted.prepare('SELECT body,result FROM message_intents').all();assert.equal(decisions.length,5);assert.ok(decisions.every(row=>row.result));
      const plan=JSON.parse(String(decisions.at(-1)!.body));assert.equal(plan.expectedVersion,1);assert.equal(plan.source.intent.originalRequest.messageId,'inbound-0');assert.equal(plan.source.intent.amendments.at(-1).text,amendment);
      const requests=persisted.prepare("SELECT body FROM execution_requests WHERE producer='fixture-tasks'").all();assert.equal(requests.length,2,'Duplicate submission never creates a second amendment run');const states=persisted.prepare("SELECT state FROM runs JOIN execution_requests ON runs.request_key=execution_requests.id WHERE execution_requests.producer='fixture-tasks'").all();assert.ok(states.every(row=>row.state==='completed'),'Replaying after receipt failure must not cancel its already accepted child');}
    finally{persisted.close();}
    assert.equal(nativeDeliveries,2,'A list-valued pending-memory receipt and a long amended goal must both survive final delivery');
  }finally{await host.close();}
});
