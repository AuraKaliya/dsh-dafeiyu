import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { memoryFixture } from '../build-tests/memory-fixture.js';
import { config,fakeDependencies } from '../build-tests/retrieval-fixture.js';
import { observationReport } from '../build-tests/observation-fixture.js';
import { textReply } from '../build-tests/harness.js';

const root=resolve('.runtime/demos',`delivery-${randomUUID()}`);await mkdir(root,{recursive:true});
const fake=fakeDependencies(),h=await memoryFixture(root,{context:{},compaction:{inputTokens:1000000},retrieval:config},fake.dependency);
try{
  const target={channel:'simulator',account:'local',kind:'local',id:'delivery-demo'},handle=h.simulator.handle;
  for(const [key,text,privateOnly] of [['public','虚构资料：下雨外出应带雨伞。',false],['private','私有雨具计划：PRIVATE_NOT_FOR_DELIVERY。',true]])handle.observeMemory(observationReport({conversation:target,sources:[{key,occurredAt:'2026-10-20T00:00:00Z',archive:{kind:'text',text},...(privateOnly?{policy:{externalExpression:'none'}}:{})}],contributions:[{id:key,form:'original',source:key,exposure:[key]}]}));
  const task=h.core.createTaskWorkspace({requestId:randomUUID(),title:'虚构交付任务',goal:'PRIVATE_GOAL_NOT_FOR_DELIVERY'});
  handle.tasks.join(task.reference,{requestId:randomUUID(),conversation:target});handle.tasks.activate(task.reference,{requestId:randomUUID(),conversation:target,expectedVersion:0});
  h.core.setTaskMemoryPolicy({requestId:randomUUID(),id:'demo',expectedVersion:0,enabled:true,sources:[{conversation:target}],reason:'虚构内部检索'});
  const access=task.memory.grant({requestId:randomUUID(),policyId:'demo',expectedPolicyVersion:1,sources:[{conversation:target}],expiresAt:new Date(Date.now()+3600000).toISOString(),reason:'虚构任务'});
  const hits=await access.recall({query:'雨',limit:10}),links=access.select({requestId:randomUUID(),expectedVersion:task.read().task.version,hitIds:hits.items.map(i=>i.hitId)}).links;
  const prepare=async()=>{h.setResponse(()=>textReply('收到，我会整理本次虚构资料。'));const question=h.simulator.send(target.id,'下雨出门要准备什么？',{id:randomUUID()});await h.core.whenIdle();
    const packet=task.expression.prepare({requestId:randomUUID(),inboundId:question.id,linkIds:links}),draft=await task.expression.generate({requestId:randomUUID(),packetId:packet.packetId,target});
    h.setResponse(()=>textReply('记得带把伞呀，虚构资料说今天出门要防雨。'));return {requestId:randomUUID(),jobId:draft.jobId,target};};
  const first=await prepare(),before=h.adapter.requests.length,result=await task.delivery.submit(first);assert.equal(result.status,'sent');
  const delivered=h.simulator.deliveries.filter(r=>r.id.startsWith('task-delivery:'));assert.equal(delivered.length,1);assert.match(delivered[0].text,/记得带把伞/);
  const persona=h.adapter.requests.slice(before).find(r=>String(r.sessionId).startsWith('dafeiyu-'));assert.ok(persona);const visible=JSON.stringify(persona.messages);assert.ok(!visible.includes('PRIVATE_NOT_FOR_DELIVERY'));assert.ok(!visible.includes('PRIVATE_GOAL_NOT_FOR_DELIVERY'));
  const calls=h.adapter.requests.length;await task.delivery.submit({...first,requestId:randomUUID()});assert.equal(h.adapter.requests.length,calls);
  const uncertain=await prepare();h.simulator.nextDelivery({status:'unknown',code:'fictional-ack-lost'});assert.equal((await task.delivery.submit(uncertain)).status,'uncertain');await task.delivery.submit(uncertain);
  const revoked=await prepare();h.setResponse(()=>{task.memory.revoke({requestId:randomUUID(),id:access.id,expectedVersion:1});return textReply('撤销后的旧回答');});assert.equal((await task.delivery.submit(revoked)).status,'rejected');
  assert.equal(h.simulator.deliveries.filter(r=>r.id.startsWith('task-delivery:')).length,1);
  const report={at:new Date().toISOString(),projectVersion:'0.19.0',samples:'fictional-only',model:'scripted-through-real-DSH-loop',channel:'@dafeiyu/channel-simulator',serverAccess:false,realQQ:false,realModel:false,
    targetPersonaSessionUsed:true,personaWordingSentInsteadOfDraft:true,privateInputsExcluded:true,simulatedTaskRepliesSent:1,duplicateDidNotRegenerateOrResend:true,
    unknownOutcomeTerminal:true,revocationDuringPersonaBlocked:true,deliveryCredentialPersisted:true};
  await writeFile(resolve(root,'result.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve('docs/agent-memory-phase-d3-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await h.close();}
