import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { Conversation,ExecutionScope,ResourceProof } from '@dafeiyu/contracts';
import { qqCapabilityFixture,scene,bot,owner,otherGroup } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';

const privateTarget:Conversation={channel:'qq',account:bot,kind:'private',id:owner};
const localScene:Conversation={channel:'executor-fixture',account:'fixture',kind:'local',id:'result'};
const view={kind:'executor-self-report',text:'RECIPIENT_ONLY_SELF_REPORT：执行器的虚构自述，不是已核实的业务事实。'};
const digest=(raw:unknown)=>createHash('sha256').update(JSON.stringify(raw)).digest('hex');
const native=(id:unknown)=>String(id).startsWith('dafeiyu-task-'),render=(id:unknown)=>String(id).startsWith('dafeiyu-delivery-v3-'),verify=(id:unknown)=>String(id).startsWith('memory-expression-verify-delivery-');
type Fixture=Awaited<ReturnType<typeof qqCapabilityFixture>>;
function runId(h:Fixture){const db=new DatabaseSync(join(h.root,'core','runtime.sqlite'),{readOnly:true});try{return String(db.prepare("SELECT r.id FROM runs r JOIN execution_requests q ON q.id=r.request_key WHERE q.producer='qq-tasks' ORDER BY r.rowid DESC LIMIT 1").get()?.id);}finally{db.close();}}

async function fixture(options:{mixedPrivate?:boolean;opaqueContext?:boolean}={}){let valid=true,permission=true,revision=1,proof:ResourceProof|undefined,bound:ExecutionScope|undefined,actionError:unknown;
  const h=await qqCapabilityFixture({tasks:true,extraTaskActions:['fixture_execution_result'],extraTaskResources:[localScene],beforeActivate:async ctx=>{
    if(options.opaqueContext)ctx.dafeiyu.registerExtension({protocolVersion:4,id:'unclassified-context',version:'1',agentId:'dafeiyu',contexts:[{id:'private-context',prepare:async()=>[{id:'opaque-fixture',version:'1',text:'UNCLASSIFIED_PRIVATE_CONTEXT_SENTINEL',expiresAt:'2099-01-01T00:00:00.000Z',sources:[{ref:'fixture-private',version:'1',hash:digest('fixture-private')}]}],validate:()=>true}]});
    ctx.dafeiyu.registerExtension({protocolVersion:4,id:'executor-fixture',version:'1',agentId:'dafeiyu',requires:['memory.capability-observation.v1'],resourceProofs:{
      current:input=>valid&&!!proof&&digest(input)===digest(proof),epoch:()=>valid?'fixture-current':'fixture-revoked',publicView:()=>false,
      targetView:(input,actual,target,scope)=>permission&&valid&&!!bound&&!!proof&&digest(scope)===digest(bound)&&digest(input)===digest(proof)&&actual===JSON.stringify(view)&&digest(target)===digest(privateTarget)?{kind:'inference',stamp:digest({revision,proof,target,scope,actual})}:null},
      actions:[{id:'fixture_execution_result',version:'1',description:'读取只授予指定目标的虚构执行器结果',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'read',scope:'task',execute:async(_input,context)=>{
        try{bound=context.scope;proof={provider:'executor-fixture',scene:localScene,key:'fictional-receipt',version:1,hash:digest(view),roots:['executor-fixture:receipt'],detail:{scope:context.scope}};
        const observation=ctx.dafeiyu.recordCapabilityObservation(context,'executor-fixture',{requestId:'observed-result',proof,text:JSON.stringify(view),occurredAt:new Date().toISOString(),coverage:['只提供模型自述；无独立业务核验'],counts:{received:1,processed:1}},{inheritExecutionHistory:true});
        const {id,scopeKey,version,contentHash}=observation.source;
        return {status:'succeeded',effects:'none',completeness:'partial',data:z.json().parse({page:view,observation}),sources:[{id,scopeKey,version,contentHash}],receipts:[]};}catch(error){actionError=error;throw error;}}}]});
  }});
  let chat=0,work=0;h.setResponse(request=>render(request.sessionId)?textReply('根据执行器的虚构自述，它报告了结果；尚未经独立核实。'):verify(request.sessionId)?textReply('{"faithful":true,"issues":[]}'):
    native(request.sessionId)?++work===1&&options.mixedPrivate?call('qq_browse',{requestId:'other-private',target:{...scene,id:otherGroup}}):work===(options.mixedPrivate?2:1)?call('fixture_execution_result',{}):textReply('OPAQUE_TASK_RESULT_MUST_STAY_OUT'):++chat===1?call('qq_task_submit',{requestId:'work'}):textReply('已受理'));
  return {...h,revoke:()=>{valid=false;},deny:()=>{permission=false;},changePermit:()=>{revision++;},proof:()=>proof!,scope:()=>bound!,assertObserved:()=>{assert.equal(actionError,undefined);assert.ok(proof);
    const db=new DatabaseSync(join(h.root,'core','runtime.sqlite'),{readOnly:true});try{const rows=db.prepare("SELECT outcome FROM run_operations WHERE plugin='executor-fixture'").all();assert.equal(rows.length,1);assert.equal(JSON.parse(String(rows[0]!.outcome)).status,'succeeded');}finally{db.close();}}};
}

test('a recipient-bound inference reaches a fresh persona session without becoming public or admitting opaque task text',async t=>{
  const h=await fixture();t.after(h.close);await h.message('任务：给我整理虚构执行器结果',{trigger:true,target:privateTarget});h.assertObserved();const id=runId(h);
  const packet=await h.core.prepareMessageTaskExpression(id);assert.equal(packet.resultIncluded,false);assert.equal(packet.evidence.filter(item=>item.id!=='CONTEXT').length,2);assert.equal(packet.evidence[0]!.kind,'inference');assert.match(packet.evidence[0]!.text,/RECIPIENT_ONLY_SELF_REPORT/);
  assert.equal(packet.evidence[1]!.kind,'reported');assert.equal(JSON.parse(packet.evidence[1]!.text).kind,'result-workflow');
  assert.equal(h.core.capabilityPublicView(h.proof(),JSON.stringify(view)),false);assert.equal(h.core.capabilityTargetView(h.proof(),JSON.stringify(view),scene,h.scope()),null);
  assert.equal(h.core.capabilityTargetView(h.proof(),JSON.stringify(view),privateTarget,{...h.scope(),agentId:'other'}),null);
  assert.equal((await h.core.deliverMessageTaskResult(id))?.state,'sent');const renderer=JSON.stringify(h.adapter.requests.find(r=>render(r.sessionId)));
  assert.match(renderer,/RECIPIENT_ONLY_SELF_REPORT/);assert.ok(!renderer.includes('OPAQUE_TASK_RESULT_MUST_STAY_OUT'));assert.ok(renderer.includes('inference'));assert.equal(h.platform.sent.length,2);
});

test('the same page cannot enter another conversation or an unauthorized target render',async t=>{
  const h=await fixture();t.after(h.close);await h.message('任务：整理虚构资料',{trigger:true,target:scene});h.assertObserved();const before=h.platform.sent.length;
  assert.equal((await h.core.deliverMessageTaskResult(runId(h)))?.state,'rejected');assert.equal(h.platform.sent.length,before);assert.equal(h.adapter.requests.some(r=>render(r.sessionId)),false);
});

test('revoking target permission excludes the page and does not fall back to the opaque native output',async t=>{
  const h=await fixture();t.after(h.close);await h.message('任务：读取虚构私聊结果',{trigger:true,target:privateTarget});h.assertObserved();h.deny();
  const before=h.platform.sent.length;assert.equal((await h.core.deliverMessageTaskResult(runId(h)))?.state,'rejected');assert.equal(h.platform.sent.length,before);assert.equal(h.adapter.requests.some(r=>render(r.sessionId)),false);
});

test('changing a target grant stamp during persona rendering invalidates the prepared packet and prevents sending',async t=>{
  const h=await fixture();t.after(h.close);await h.message('任务：按当前授权整理结果',{trigger:true,target:privateTarget});h.assertObserved();const before=h.platform.sent.length;
  h.setResponse(request=>{if(render(request.sessionId)){h.changePermit();return textReply('不应发出的旧授权结果');}return textReply('{"faithful":true,"issues":[]}');});
  assert.equal((await h.core.deliverMessageTaskResult(runId(h)))?.state,'rejected');assert.equal(h.platform.sent.length,before);
});

test('a target permission cannot launder an inference influenced by another private conversation',async t=>{
  const h=await fixture({mixedPrivate:true});t.after(h.close);await h.message('FOREIGN_PRIVATE_SOURCE_SENTINEL',{target:{...scene,id:otherGroup}});
  await h.message('任务：整理当前可用的虚构材料',{trigger:true,target:privateTarget});h.assertObserved();const before=h.platform.sent.length;
  const observed=h.rows().observations.map(row=>JSON.parse(String(row.body))).find(row=>row.producer==='executor-fixture');assert.ok(observed);assert.ok(observed.history.some((entry:{kind:string})=>entry.kind==='execution-operation'));
  assert.equal((await h.core.deliverMessageTaskResult(runId(h)))?.state,'rejected');assert.equal(h.platform.sent.length,before);assert.equal(h.adapter.requests.some(r=>render(r.sessionId)),false);
});

test('a registered but unclassified input context blocks derived target inference even with a valid page grant',async t=>{
  const h=await fixture({opaqueContext:true});t.after(h.close);await h.message('任务：核对未知来源的虚构上下文',{trigger:true,target:privateTarget});h.assertObserved();const before=h.platform.sent.length;
  assert.ok(h.adapter.requests.some(r=>native(r.sessionId)&&JSON.stringify(r.messages).includes('UNCLASSIFIED_PRIVATE_CONTEXT_SENTINEL')));
  assert.equal((await h.core.deliverMessageTaskResult(runId(h)))?.state,'rejected');assert.equal(h.platform.sent.length,before);assert.equal(h.adapter.requests.some(r=>render(r.sessionId)),false);
});
