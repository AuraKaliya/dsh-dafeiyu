import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { taskFixture,sceneB } from '../build-tests/task-workspace-fixture.js';
import { observationConversation } from '../build-tests/observation-fixture.js';

const root=resolve('.runtime/demos',`task-workspaces-${randomUUID()}`);await mkdir(root,{recursive:true});
const h=await taskFixture(root);let closed=false;
try{
  const task=h.core.createTaskWorkspace({requestId:randomUUID(),title:'虚构跨场景调研',goal:'内部任务目标，不进入聊天模型'});
  const other=h.core.createTaskWorkspace({requestId:randomUUID(),title:'虚构独立任务',goal:'保持结果独立'});
  h.join(task,h.handle,observationConversation);h.join(task,h.second,sceneB);h.join(other,h.handle,observationConversation);
  h.activate(task,h.handle,observationConversation,0);h.activate(task,h.second,sceneB,0);
  const a=h.link(task,h.handle,observationConversation,h.a.contributions[0].memoryId);
  const b=h.link(task,h.second,sceneB,h.b.contributions[0].memoryId);
  assert.match(JSON.stringify(task.read()),/A_ORIGINAL/);assert.match(JSON.stringify(task.read()),/B_PRIVATE_MEMORY/);
  assert.ok(!JSON.stringify(h.handle.tasks.view(task.reference,observationConversation)).includes('B_PRIVATE_MEMORY'));
  const wa=h.begin(task.reference,h.handle,observationConversation,'scene-a',[a]);
  const wb=h.begin(task.reference,h.second,sceneB,'scene-b',[b]);
  assert.equal(h.handle.tasks.complete(wa,{requestId:randomUUID(),text:'A独立进展'}).applied,true);
  assert.equal(h.second.tasks.complete(wb,{requestId:randomUUID(),text:'B独立进展'}).applied,true);
  const late=h.begin(task.reference,h.handle,observationConversation,'late',[a]);
  h.activate(other,h.handle,observationConversation,1);
  assert.equal(h.handle.tasks.complete(late,{requestId:randomUUID(),text:'LATE_MUST_NOT_OVERWRITE'}).applied,false);
  assert.ok(!JSON.stringify(task.read()).includes('LATE_MUST_NOT_OVERWRITE'));assert.ok(!JSON.stringify(other.read()).includes('LATE_MUST_NOT_OVERWRITE'));
  h.handle.changeObservationSource({conversation:observationConversation,ref:h.a.sources[0].ref,requestId:'delete',expectedVersion:1,action:'delete'});
  assert.ok(!JSON.stringify(task.read()).includes('A独立进展'));assert.match(JSON.stringify(task.read()),/B独立进展/);
  h.handle.changeObservationSource({conversation:observationConversation,ref:h.a.sources[0].ref,requestId:'restore',expectedVersion:2,action:'restore'});
  assert.ok(!JSON.stringify(task.read()).includes('A独立进展'));
  const pending=h.begin(task.reference,h.second,sceneB,'pending',[b]);
  const id=task.reference.id,selected=other.reference.id;await h.close();closed=true;
  // Reopen without replaying fixture observations from the restored (version 3) source.
  const {observationFixture}=await import('../build-tests/observation-fixture.js');
  const next=await observationFixture(root);
  try{
    const snapshot=next.core.resumeTaskWorkspace(id).read();assert.match(JSON.stringify(snapshot),/B独立进展/);
    assert.equal(snapshot.jobs.find(job=>job.id===pending.id).status,'interrupted');
    const otherTask=next.core.resumeTaskWorkspace(selected);assert.equal(next.handle.tasks.view(otherTask.reference,observationConversation).selection.taskId,selected);
    assert.equal(next.adapter.requests.length,0);
    const report={at:new Date().toISOString(),projectVersion:'0.16.0',schemaVersion:4,samples:'fictional-scenes-and-plugins',serverAccess:false,realModel:false,
      unifiedTaskInternalView:true,sceneContextsRemainSeparate:true,parallelSlotsPreserved:true,lateResultArchivedWithoutOverwrite:true,
      sourceDeletionLocallyInvalidates:true,unrelatedSceneProgressPreserved:true,restorationDoesNotReactivate:true,
      restartPreservesSelection:true,pendingWorkInterrupted:true,modelCallsDuringDemo:0,externalDeliveries:0};
    await writeFile(resolve(root,'result.json'),JSON.stringify(report,null,2)+'\n');
    await writeFile(resolve('docs/agent-memory-phase-c-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }finally{await next.close();}
}finally{if(!closed)await h.close();}
