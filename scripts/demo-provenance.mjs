import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { API_VERSION } from '@dafeiyu/contracts';
import { readProvenance } from '@dafeiyu/core';
import { provenanceFixture } from '../build-tests/provenance-fixture.js';
import { checkpointProof } from '../build-tests/summary-proof.js';

const root=resolve('.runtime/demos',`provenance-${randomUUID()}`);await mkdir(root,{recursive:true});
const h=await provenanceFixture(root,5000);
const expiry=new Date(Date.now()+600000).toISOString();
const plugin=h.core.registerExtension({id:'fictional-independent',version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',contexts:[{
  id:'progress',kind:'operational-fact',prepare:async()=>[{id:'progress',version:'1',text:'SECOND_PLUGIN_STAYS',expiresAt:expiry,sources:[{ref:'fictional:progress',version:'1',hash:'test'}]}],validate:()=>true,
}]});
const checkpoints=()=>h.session().deriveMessages().flatMap(message=>message.role==='user'&&(message.source.kind==='compact-checkpoint'||message.source.kind==='dafeiyu-summary-view')
  ?[{id:message.id,message,data:checkpointProof(h.session(),message)}]:[]);
try{
  const b=await h.remember('虚构B资料：纸船存放于蓝色抽屉。');await h.select([b.memory],0);
  for(let i=0;i<5;i++)await h.run(`B阶段${i}：`+'虚构蓝色纸船仍待检验，不能声明成功。'.repeat(500));
  const independent=checkpoints();assert.ok(independent.length);
  const a=await h.remember('虚构A资料：项目临时代号为青羽842。');await h.select([a.memory],1);
  for(let i=0;i<5;i++)await h.run(`A阶段${i}：`+'虚构后续检查尚未确认结果。'.repeat(500));
  const dependent=checkpoints().filter(c=>c.data.dependencies.some(d=>d.kind==='memory'&&d.id===a.memory.id||d.hash===a.memory.sources[0].contentHash));assert.ok(dependent.length);
  await h.run('独立用户输入 B_LATER_USER_KEEP','A_DERIVED_ANSWER_REMOVE');
  h.mutate(a,'delete',1);await h.run('继续仍有效的部分');
  assert.ok(independent.every(old=>checkpoints().some(c=>c.id===old.id&&JSON.stringify(c.message)===JSON.stringify(old.message))));
  assert.ok(dependent.every(old=>!checkpoints().some(c=>c.id===old.id)));
  assert.match(h.visible(),/B_LATER_USER_KEEP/);assert.match(h.visible(),/SECOND_PLUGIN_STAYS/);assert.ok(!h.visible().includes('A_DERIVED_ANSWER_REMOVE'));
  h.mutate(a,'restore',2);await h.run('恢复后继续');assert.ok(dependent.every(old=>!checkpoints().some(c=>c.id===old.id)));
  await h.run('另一个隔离会话','独立回复','other');assert.ok(!h.visible().includes('青羽842'));
  const records=readProvenance(h.session());
  const result={at:new Date().toISOString(),projectVersion:'0.11.0',dsh:'0.2.1-rc.2',model:'scripted',samples:'fictional-Chinese',serverAccess:false,
    independentCheckpointsPreserved:independent.length,dependentCheckpointViewsReplaced:dependent.length,independentBytesAndIdsUnchanged:true,
    independentUserInputPreserved:true,dependentAnswerWithdrawn:true,restoreDidNotReactivateOldViews:true,otherPluginRegionPreserved:true,crossConversationIsolated:true,
    sourceRecords:records.filter(e=>e.type==='plugin:dafeiyu/source-record').length,requestExposureRecords:records.filter(e=>e.type==='plugin:dafeiyu/request-sources').length,
    sourceRetirementEvents:h.core.journal.events(a.scope.route).filter(e=>e.type==='context.sources.retired').length,
    originalArchiveRetained:JSON.stringify(h.session().snapshotEvents()).includes('A_DERIVED_ANSWER_REMOVE'),
    scope:'Source tracking compatibility under C2 fragment views; multi-generation merge is not enabled'};
  await writeFile(resolve(root,'result.json'),JSON.stringify(result,null,2)+'\n');await writeFile(resolve('docs/memory-phase-5c1-results.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}finally{plugin.dispose();await h.close();}
