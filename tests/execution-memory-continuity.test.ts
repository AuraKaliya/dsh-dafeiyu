import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { testTempDir as tmpdir } from './test-temp.js';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { ExecutionContextV3,PersonaSourceRef,ExtensionV3 } from '@dafeiyu/contracts';
import { executionHarness } from './execution-fixture.js';
import { call,textReply } from './harness.js';

type H=Awaited<ReturnType<typeof executionHarness>>;
const root=()=>mkdtemp(join(tmpdir(),'dafeiyu-execution-memory-'));
const request={requestId:'first',title:'虚构内部观察',goal:'核对虚构材料，保留条件和未决项，不向聊天发送',policyId:'test-policy'};
const observation={requestId:'observe',occurredAt:'2026-10-24T00:00:00.000Z',text:'蓝灯🦈尚未确认，必须保留反证。',kind:'primary',completeness:'partial',resource:'fixture:blue-lamp',coverage:['文字片段0—20；没有音频、画面'],dependencies:[]};
function fixture(execute:(c:ExecutionContextV3)=>unknown,effects:'read'|'local-write'='local-write'):Omit<ExtensionV3,'agentId'|'protocolVersion'>{return {id:'fixture',version:'plugin-7',actions:[{id:'fixture_observe',version:'action-3',description:'仅本机虚构文字观察',inputSchema:z.strictObject({}),outputSchema:z.json(),effects,requiresTask:true,execute:async(_input,c)=>({status:'succeeded',effects:effects==='read'?'none':'confirmed',completeness:'partial',data:z.json().parse(execute(c)),sources:[],receipts:[]})}]};}
function rows(directory:string,sql:string,dbName='memory'){const db=new DatabaseSync(join(directory,dbName,dbName==='core'?'runtime.sqlite':'memory.sqlite'),{readOnly:true});try{return db.prepare(sql).all();}finally{db.close();}}
async function archive(directory:string):Promise<string>{let text='';for(const file of await readdir(directory,{withFileTypes:true})){const path=join(directory,file.name);if(file.isDirectory())text+=await archive(path);else if(file.name.endsWith('.jsonl'))text+=await readFile(path,'utf8');}return text;}
function sql(directory:string,statement:string,dbName='memory'){const db=new DatabaseSync(join(directory,dbName,dbName==='core'?'runtime.sqlite':'memory.sqlite'));try{db.exec(statement);}finally{db.close();}}

test('native observations, Unicode excerpts and inferred contributions retain task-only boundaries and atomic audit',async()=>{
  const directory=await root();let h:H,step=0,ref:PersonaSourceRef|undefined;
  h=await executionHarness(directory,()=>++step===1?call('fixture_observe',{}):textReply('仅记录了文字片段，其他信息未知'),fixture(c=>{
    const p=h.memory.persona!;ref=p.recordObservation(c,observation,'fixture');assert.deepEqual(p.recordObservation(c,observation,'fixture'),ref);
    assert.throws(()=>p.recordObservation({...c},observation,'fixture'),/SCOPE_DENIED/);
    const page=p.openSource(c,{source:ref,offset:2,limit:1},'fixture');assert.equal(page.text,'🦈');assert.equal(page.nextOffset,3);
    const excerpt=p.contribute(c,{requestId:'excerpt',source:ref.id,version:1,mode:'excerpt',start:0,end:3,reason:'保留标识并单独记录覆盖范围'},'fixture');
    const summary=p.contribute(c,{requestId:'summary',source:ref.id,version:1,mode:'summary',text:'该虚构文字仍有反证，结论未定。',reason:'保留不确定性'},'fixture');
    p.selectEvidence(c,{requestId:'select',expectedVersion:0,entries:[summary.source],reason:'供后续任务核对'},'fixture');return {ref,excerpt,summary};}));
  try{const accepted=h.port.submitTask(request);await h.core.whenIdle();const status=h.port.status(accepted.run);assert.equal(status.state,'completed');
    const bodies=rows(directory,'SELECT body FROM memory_revisions').map(row=>JSON.parse(String(row.body)));assert.equal(bodies.length,2);assert.equal(bodies[0].content,'蓝灯🦈');assert.equal(bodies[1].claimType,'inference');
    const bounds=rows(directory,'SELECT body FROM memory_boundaries').map(row=>JSON.parse(String(row.body)));assert.ok(bounds.every(b=>b.schemaVersion===2&&b.internalUse.kind==='task'&&b.externalExpression.kind==='none'));
    const events=h.core.journal.executionEvents('dafeiyu',accepted.task.id);assert.equal(events.filter(e=>e.type==='execution.observation.recorded').length,1);assert.equal(events.filter(e=>e.type==='memory.created').length,2);
    const versions=rows(directory,"SELECT body FROM run_inputs WHERE input_id LIKE 'operation-version:%'",'core').map(row=>JSON.parse(String(row.body)));assert.deepEqual(versions[0],{schemaVersion:1,pluginVersion:'plugin-7',actionVersion:'action-3'});
    assert.equal(rows(directory,'SELECT * FROM continuity_checkpoints').length,1);assert.equal(rows(directory,'SELECT * FROM task_execution_results').length,1);
    assert.ok((await archive(join(directory,'sessions'))).includes('dafeiyu-execution'));assert.ok(!h.core.journal.list().length);
  }finally{await h.close();}
});

test('selected internal evidence survives restart but neither another task nor a cloned authority can read it',async()=>{
  const directory=await root();let h:H,step=0,ref:PersonaSourceRef|undefined,taskId='';const spec=fixture(c=>{ref=h.memory.persona!.recordObservation(c,observation,'fixture');h.memory.persona!.selectEvidence(c,{requestId:'selected',expectedVersion:0,entries:[ref],reason:'只在本任务接续'},'fixture');return {ref};});
  h=await executionHarness(directory,()=>++step===1?call('fixture_observe',{}):textReply('已保存范围'),spec);try{const accepted=h.port.submitTask(request);taskId=accepted.task.id;await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'completed');h.port.updateTask(accepted.task,{requestId:'updated-goal',expectedVersion:1,goal:'新目标仍可核验本任务的已选历史资料，不能把旧结果当成新交付'});}finally{await h.close();}
  let calls=0;h=await executionHarness(directory,()=>++calls===2?call('fixture_observe',{}):textReply('接续检查'),fixture(c=>{assert.throws(()=>h.memory.persona!.openSource(c,{source:ref},'fixture'),/SOURCE_STALE/);return {denied:true};}),false);
  try{const task=h.port.openTask(taskId),next=h.port.submitTask({requestId:'restart',taskId,expectedVersion:2,policyId:'test-policy'},task);await h.core.whenIdle();assert.equal(h.port.status(next.run).state,'completed');assert.ok(JSON.stringify(h.adapter.requests[0]?.messages).includes(observation.text));
    const other=h.port.submitTask({...request,requestId:'other'});await h.core.whenIdle();assert.equal(h.port.status(other.run).state,'completed');assert.ok(!JSON.stringify(h.adapter.requests[1]?.messages).includes(observation.text));
  }finally{await h.close();}
});

test('source deletion retires paired tool history and derived results; restore never revives old proofs',async()=>{
  const directory=await root();let h:H,mode='record',step=0,ref:PersonaSourceRef|undefined;
  const spec=fixture(c=>{const p=h.memory.persona!;if(mode==='record'){ref=p.recordObservation(c,observation,'fixture');return {ref,text:observation.text};}
    return p.changeSource(c,{requestId:mode,id:ref!.id,expectedVersion:mode==='delete'?1:2,deleted:mode==='delete'},'fixture');});
  h=await executionHarness(directory,()=>++step===1?call('fixture_observe',{}):textReply(mode==='record'?observation.text:'旧资料已退出，无法断言其内容'),spec);
  try{const first=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(first.run).state,'completed');
    mode='delete';step=0;const deleted=h.port.submitTask({requestId:'delete',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await h.core.whenIdle();assert.equal(h.port.status(deleted.run).operations[0]?.effects,'confirmed');assert.equal(h.port.status(deleted.run).state,'failed');
    await assert.rejects(()=>h.port.readResult(first.run),/SOURCE_STALE/);
    mode='neutral';step=8;const clean=h.port.submitTask({requestId:'clean',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await h.core.whenIdle();assert.equal(h.port.status(clean.run).state,'completed');assert.ok(!JSON.stringify(h.adapter.requests.at(-1)?.messages).includes(observation.text));
    mode='restore';step=0;const restored=h.port.submitTask({requestId:'restore',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await h.core.whenIdle();assert.equal(h.port.status(restored.run).state,'completed');await assert.rejects(()=>h.port.readResult(first.run),/SOURCE_STALE/);
    assert.ok((await archive(join(directory,'sessions'))).includes(observation.text));assert.equal(rows(directory,'SELECT state_version FROM execution_sources')[0]?.state_version,3);
  }finally{await h.close();}
});

test('contribution rollback keeps the original observation and retries memory without repeating the capability',async()=>{
  const directory=await root();let h:H,step=0,observed=0;
  h=await executionHarness(directory,()=>++step===1?call('fixture_observe',{}):textReply('贡献重试完成'),fixture(c=>{const p=h.memory.persona!,ref=p.recordObservation(c,observation,'fixture');observed++;
    const input={requestId:'contribute',source:ref.id,version:1,mode:'original',reason:'保留实际文字'};
    sql(directory,"CREATE TRIGGER fixture_fail_contribution BEFORE INSERT ON execution_contributions BEGIN SELECT RAISE(ABORT,'fixture rollback');END;");assert.throws(()=>p.contribute(c,input,'fixture'),/fixture rollback/);
    assert.equal(rows(directory,'SELECT * FROM memory_items').length,0);assert.equal(rows(directory,'SELECT * FROM execution_sources').length,1);
    sql(directory,'DROP TRIGGER fixture_fail_contribution');const result=p.contribute(c,input,'fixture');assert.deepEqual(p.contribute(c,input,'fixture'),result);return result;
  }));try{const accepted=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'completed');assert.equal(observed,1);assert.equal(rows(directory,'SELECT * FROM memory_items').length,1);}finally{await h.close();}
});

test('blocking objections pause related writes, allow independent work, and require trusted resolution',async()=>{
  const directory=await root();let h:H,step=0,related=0,independent=0,phase='object';
  const action=(id:string,work:()=>void)=>({id,version:'1',description:'虚构任务操作',inputSchema:z.strictObject({}),outputSchema:z.null(),effects:'local-write' as const,execute:async()=>{work();return {status:'succeeded' as const,effects:'confirmed' as const,completeness:'complete' as const,data:null,sources:[],receipts:[]};}});
  h=await executionHarness(directory,()=>{step++;if(phase==='object'){
    if(step===1)return call('dafeiyu_task_object',{requestId:'objection',category:'missing-information',blocking:true,actions:['fixture_related'],reason:'虚构样本的关键条件缺失',evidence:[]});
    if(step===2)return call('fixture_related',{});if(step===3)return call('fixture_independent',{});
  }else if(step===1)return call('fixture_related',{});return textReply('已处理可行步骤，保留原目标');},{id:'fixture',version:'1',actions:[action('fixture_related',()=>related++),action('fixture_independent',()=>independent++)]},true,{executionActions:true});
  try{const first=h.port.submitTask(request);await h.core.whenIdle();const status=h.port.status(first.run);assert.equal(status.state,'waiting');assert.equal(status.error,'TASK_OBJECTION_UNRESOLVED');assert.equal(related,0);assert.equal(independent,1);
    const objection=JSON.parse(String(rows(directory,"SELECT body FROM task_intent_events WHERE json_extract(body,'$.kind')='objection'")[0]?.body));
    assert.throws(()=>h.port.resolveObjection({id:first.task.id},{requestId:'resolve',objectionId:objection.id,reason:'已补齐虚构条件'}),/SCOPE_DENIED/);
    h.port.resolveObjection(first.task,{requestId:'resolve',objectionId:objection.id,reason:'已补齐虚构条件，维持原目标'});phase='resolved';step=0;
    const next=h.port.resume(first.task,{requestId:'resume',taskId:first.task.id,expectedVersion:1,policyId:'test-policy',parentRunId:first.run.id,checkpointId:status.checkpoints.at(-1)!});await h.core.whenIdle();assert.equal(h.port.status(next.run).state,'completed');assert.equal(related,1);assert.equal(independent,1);
    assert.equal(JSON.parse(String(rows(directory,'SELECT body FROM task_workspaces')[0]?.body)).goal,request.goal);
    assert.equal(JSON.parse(String(rows(directory,"SELECT body FROM task_intent_events WHERE json_extract(body,'$.kind')='accepted'")[0]?.body)).motivation.kind,'explicit-task');
  }finally{await h.close();}
});

test('preference objections cannot block tasks and trusted exploration motivation stays separate from Run origin',async()=>{
  const directory=await root();let h:H,step=0;
  h=await executionHarness(directory,()=>++step===1?call('fixture_observe',{}):textReply('有不同偏好，但照约定执行'),fixture(c=>{const p=h.memory.persona!;
    assert.throws(()=>p.object(c,{requestId:'bad',category:'preference',blocking:true,actions:[],reason:'我不喜欢这个主题'},'fixture'),/INVALID_OBJECTION/);
    return p.object(c,{requestId:'good',category:'preference',blocking:false,actions:[],reason:'我偏好另一主题，当前任务仍执行'},'fixture');}));
  try{const port=h.core.executionProducer('local-test',{motivation:{kind:'self-exploration',basis:['受信测试活动生产者']} }),run=port.submitTask(request);await h.core.whenIdle();assert.equal(port.status(run.run).state,'completed');
    const body=JSON.parse(String(rows(directory,"SELECT body FROM task_intent_events WHERE json_extract(body,'$.kind')='accepted'")[0]?.body));assert.equal(body.motivation.kind,'self-exploration');
    const definition=JSON.parse(String(rows(directory,'SELECT definition FROM runs','core')[0]?.definition));assert.equal(definition.origin.kind,'native');
  }finally{await h.close();}
});

test('a lost continuity binding leaves an orphan checkpoint which restart cannot adopt or replay',async()=>{
  const directory=await root();let h=await executionHarness(directory,()=>textReply('虚构可见结果'));let taskId='';
  try{sql(directory,"CREATE TRIGGER fixture_lost_checkpoint BEFORE INSERT ON run_inputs WHEN NEW.input_id='continuity-reference' BEGIN SELECT RAISE(ABORT,'fixture lost reference');END;",'core');
    const first=h.port.submitTask(request);taskId=first.task.id;await h.core.whenIdle();assert.equal(h.port.status(first.run).state,'failed');assert.equal(rows(directory,'SELECT * FROM continuity_checkpoints').length,1);assert.equal(rows(directory,"SELECT * FROM run_inputs WHERE input_id='continuity-reference'",'core').length,0);
  }finally{await h.close();}
  sql(directory,'DROP TRIGGER fixture_lost_checkpoint','core');h=await executionHarness(directory,()=>textReply('明确接续缺口'),undefined,false);
  try{assert.equal(h.adapter.requests.length,0);const task=h.port.openTask(taskId),next=h.port.submitTask({requestId:'next',taskId,expectedVersion:1,policyId:'test-policy'},task);await h.core.whenIdle();assert.equal(h.port.status(next.run).state,'completed');
    const message=h.adapter.requests[0]?.messages.findLast(m=>m.source?.kind==='dafeiyu-execution');assert.ok(message);const body=JSON.parse(message.content.filter(b=>b.type==='text').map(b=>b.text).join(''));assert.equal(body.continuity,null);
  }finally{await h.close();}
});

test('v3 context contributors enter real task context, are source-checked and remain scoped',async()=>{
  const directory=await root();let active=true,seenTask='';const secret='独立插件的虚构上下文限定';
  const spec:Omit<ExtensionV3,'agentId'|'protocolVersion'>={id:'fixture',version:'1',contexts:[{id:'native-context',prepare:async view=>{seenTask=view.taskId!;return [{id:'sample',version:'1',text:secret,expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:'fixture:context',version:'1',hash:'fixture'}]}];},validate:()=>active}]};
  const h=await executionHarness(directory,()=>{assert.ok(seenTask);active=false;return textReply('这个结果必须失效');},spec);
  try{const run=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(run.run).state,'failed');assert.ok(JSON.stringify(h.adapter.requests[0]?.messages).includes(secret));assert.equal(h.port.status(run.run).result,null);}finally{await h.close();}
});

test('native compression uses DSH provenance and preserves constraints through restart',async()=>{
  const directory=await root(),long='虚构材料：不可把未核验结论写成事实；保留未决问题。'.repeat(70);let summaries=0;
  const options={compaction:{inputTokens:2048,thresholdRatio:0.6,targetRatio:0.3,minGrowthTokens:0,minSavingsTokens:64,cooldownMs:0,retainTurns:1,maxSourceBytes:65536,maxSummaryChars:400,timeoutMs:10000}};
  const response:Parameters<typeof executionHarness>[1]=opts=>opts.purpose==='compaction'?(summaries++,textReply(JSON.stringify({fragments:[{kind:'constraint',text:'旧虚构材料的结论尚未核验，不能写成事实；未决问题必须保留。'}]}))):textReply(long);
  let h=await executionHarness(directory,response,undefined,true,options),taskId='',sessionId='';
  try{const first=h.port.submitTask(request);taskId=first.task.id;await h.core.whenIdle();assert.equal(h.port.status(first.run).state,'completed');sessionId=h.port.status(first.run).result!.sessionId;
    for(let i=0;i<5;i++){const run=h.port.submitTask({requestId:`round-${i}`,taskId,expectedVersion:1,policyId:'test-policy'},first.task);await h.core.whenIdle();assert.equal(h.port.status(run.run).state,'completed');}
    const text=await archive(join(directory,'sessions'));assert.ok(summaries>0);assert.ok(text.includes('compaction/end'));assert.ok(text.includes('plugin:dafeiyu/request-sources'));assert.equal(rows(directory,'SELECT * FROM continuity_checkpoints').length,6);
  }finally{await h.close();}
  h=await executionHarness(directory,response,undefined,false,options);try{const task=h.port.openTask(taskId),next=h.port.submitTask({requestId:'after-restart',taskId,expectedVersion:1,policyId:'test-policy'},task);await h.core.whenIdle();assert.equal(h.port.status(next.run).state,'completed');assert.equal(h.port.status(next.run).result!.sessionId,sessionId);
    assert.ok(JSON.stringify(h.adapter.requests.filter(r=>r.purpose!=='compaction').at(-1)?.messages).includes('未决'));assert.ok(!(await archive(join(directory,'sessions'))).includes('replayState'));
  }finally{await h.close();}
});

test('nonempty action source references are verified after persisting the actual effect receipt',async()=>{
  const directory=await root();let h:H,step=0,invalid=false;
  const spec:Omit<ExtensionV3,'agentId'|'protocolVersion'>={id:'fixture',version:'plugin-7',actions:[{id:'fixture_observe',version:'action-3',description:'虚构带来源回执',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'local-write',execute:async(_input,c)=>{
    const ref=h.memory.persona!.recordObservation(c,{...observation,requestId:invalid?'second':'first'},'fixture');return {status:'partial',effects:'confirmed',completeness:'partial',data:{coverage:['文字片段']},sources:[{id:ref.id,scopeKey:ref.scopeKey,version:invalid?99:ref.version,contentHash:ref.contentHash}],receipts:[]};}}]};
  h=await executionHarness(directory,()=>++step===1?call('fixture_observe',{}):textReply('根据实际部分资料回答'),spec);
  try{const first=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(first.run).state,'completed');assert.equal(h.port.status(first.run).operations[0]?.status,'partial');invalid=true;step=0;
    const second=h.port.submitTask({...request,requestId:'bad-reference'});await h.core.whenIdle();assert.equal(h.port.status(second.run).operations[0]?.effects,'confirmed');
    assert.equal(h.port.status(second.run).state,'failed');
    assert.ok((await archive(join(directory,'sessions'))).includes('SOURCE_STALE'));assert.equal(rows(directory,'SELECT * FROM execution_sources').length,2);
  }finally{await h.close();}
});

test('unknown effects cannot be bypassed with a new Run and a different request body',async()=>{
  const directory=await root();let calls=0,step=0;const h=await executionHarness(directory,()=>++step%2===1?call('fixture_write',{value:String(step)}):textReply('写入效果未知，不能重复'),{
    id:'fixture',version:'1',actions:[{id:'fixture_write',version:'1',description:'虚构未知效果',inputSchema:z.strictObject({value:z.string()}),outputSchema:z.null(),effects:'local-write',execute:async()=>{calls++;return {status:'unknown',effects:'unknown',completeness:'unknown',data:null,sources:[],receipts:[]};}}]});
  try{const first=h.port.submitTask(request);await h.core.whenIdle();const second=h.port.submitTask({requestId:'new-run',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await h.core.whenIdle();assert.equal(calls,1);assert.equal(h.port.status(second.run).operations.length,0);
    const checkpoint=JSON.parse(String(rows(directory,'SELECT body FROM continuity_checkpoints LIMIT 1')[0]?.body));assert.equal(checkpoint.unknownOperations.length,1);
  }finally{await h.close();}
});

test('a result projection interrupted after runtime completion is repaired without model or action replay',async()=>{
  const directory=await root();let h=await executionHarness(directory,()=>textReply('虚构已持久化结果')),runId='';
  try{sql(directory,"CREATE TRIGGER fixture_lost_result BEFORE INSERT ON task_execution_results BEGIN SELECT RAISE(ABORT,'fixture lost projection');END;");const first=h.port.submitTask(request);runId=first.run.id;
    await assert.rejects(()=>h.core.whenIdle(),/PERSISTENCE_FAILED/);assert.equal(h.port.status(first.run).state,'completed');assert.equal(rows(directory,'SELECT * FROM task_execution_results').length,0);
  }finally{await h.close().catch(()=>{});}
  sql(directory,'DROP TRIGGER fixture_lost_result');h=await executionHarness(directory,()=>{throw new Error('Recovery must not call the model');},undefined,false);
  try{assert.equal(rows(directory,'SELECT * FROM task_execution_results').length,1);assert.equal(h.adapter.requests.length,0);assert.equal(await h.port.readResult(h.port.restoreRun(runId)),'虚构已持久化结果');}finally{await h.close();}
});

test('the operational event index cannot launder free-form selection reasons as fresh source text',async()=>{
  const directory=await root(),note='PRIVATE_DERIVED_EVENT_NOTE';let h:H,step=0;
  h=await executionHarness(directory,()=>++step===1?call('fixture_observe',{}):step===2?call('dafeiyu_execution_events',{limit:30}):textReply('事件仅用于核对操作状态'),fixture(c=>{
    const ref=h.memory.persona!.recordObservation(c,observation,'fixture');h.memory.persona!.selectEvidence(c,{requestId:'select',expectedVersion:0,entries:[ref],reason:note},'fixture');return {sourceId:ref.id};}),true,{timelineExecution:true});
  try{const run=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(run.run).state,'completed');assert.ok(h.core.journal.executionEvents('dafeiyu',run.task.id).some(event=>JSON.stringify(event.data).includes(note)));
    assert.ok(!JSON.stringify(h.adapter.requests.at(-1)?.messages).includes(note));assert.ok(JSON.stringify(h.adapter.requests.at(-1)?.messages).includes('operational-index-only'));
  }finally{await h.close();}
});
