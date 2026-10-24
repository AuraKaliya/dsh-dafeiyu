import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expressionFixture } from '../build-tests/expression-fixture.js';
import { taskMemoryFixture,scenes } from '../build-tests/task-memory-fixture.js';

const root=resolve('.runtime/demos',`expression-${randomUUID()}`);await mkdir(root,{recursive:true});
const h=await expressionFixture(root);let closed=false;
try{
  const handle=h.handles[0],conversation=scenes[0];handle.tasks.join(h.task.reference,{requestId:randomUUID(),conversation});handle.tasks.activate(h.task.reference,{requestId:randomUUID(),conversation,expectedVersion:0});
  const work=handle.tasks.begin(h.task.reference,{requestId:randomUUID(),conversation,slot:'mixed',expectedSlotVersion:0,inputs:[h.linkFor(0),h.linkFor(1)]});
  handle.tasks.complete(work,{requestId:randomUUID(),text:'PRIVATE_MIXED_CONCLUSION'});
  const packet=h.prepare(await h.question(),h.links,['mixed']);assert.equal(packet.decisions.find(d=>d.id==='mixed').allowed,false);
  const before=h.adapter.requests.length,result=await h.task.expression.generate({requestId:'generate-once',packetId:packet.packetId,target:conversation});
  const requests=h.adapter.requests.slice(before);assert.equal(requests.length,2);const visible=JSON.stringify(requests.map(r=>r.messages));assert.match(visible,/A_ONLY/);
  for(const forbidden of ['B_INTERNAL_ONLY','C_DENIED','PRIVATE_MIXED_CONCLUSION'])assert.ok(!visible.includes(forbidden));
  assert.equal(result.sendAuthorized,false);assert.throws(()=>h.task.expression.result({jobId:result.jobId,target:scenes[1]}));
  const taskId=h.task.reference.id;h.task.memory.revoke({requestId:'revoke',id:h.access.id,expectedVersion:1});assert.throws(()=>h.task.expression.result({jobId:result.jobId,target:conversation}));
  await h.close();closed=true;const next=await taskMemoryFixture(root);
  try{assert.throws(()=>next.core.resumeTaskWorkspace(taskId).expression.result({jobId:result.jobId,target:conversation}));assert.equal(next.adapter.requests.length,0);
    const report={at:new Date().toISOString(),projectVersion:'0.18.0',schemaVersion:6,samples:'fictional-scenes-and-scripted-model',serverAccess:false,realModel:false,realChannelAccess:false,
      mixedConclusionRejected:true,targetEvidenceFiltered:true,privateInputsAbsentFromGenerationAndVerification:true,independentGenerationAndVerificationCalls:2,
      questionBoundToRealFictionalInbound:true,targetMismatchRejected:true,sendAuthorized:false,revocationInvalidatesCompletedResult:true,restartDoesNotReactivate:true};
    await writeFile(resolve(root,'result.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve('docs/agent-memory-phase-d2-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }finally{await next.close();}
}finally{if(!closed)await h.close();}
