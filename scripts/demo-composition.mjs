import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { API_VERSION } from '@dafeiyu/contracts';
import { activeFragments,fragmentDependencies,resolveFragmentView,resolveFragmentProof,summarySelectionState } from '@dafeiyu/core';
import { summaryReference } from '../packages/core/lib/summary-fragments.js';
import { provenanceFixture } from '../build-tests/provenance-fixture.js';
import { seedCheckpoint,compose } from '../build-tests/composition-fixture.js';

const root=resolve('.runtime/demos',`composition-${randomUUID()}`);await mkdir(root,{recursive:true});
const h=await provenanceFixture(root);let closed=false;
try{
  await h.run('虚构固定前缀');
  const condition={kind:'constraint',text:'仅在虚构测试群试运行；需要主人确认后发送，目前尚未验收。'};
  const a=await seedCheckpoint(h,'虚构A原始资料',[condition,condition,{kind:'uncertainty',text:'A_ONLY：未知结果，不代表成功。'}]);
  const b=await seedCheckpoint(h,'虚构B原始资料',[condition,{kind:'fact',text:'B_ONLY：独立资料保留。'}]);
  const calls=h.adapter.requests.length,first=compose(h,[a.view,b.view]),second=compose(h,[first]),third=compose(h,[second]);
  const ref=summaryReference(third.manifestSeq,third.manifest),bBefore=activeFragments(third).filter(f=>f.text.includes('B_ONLY'));
  assert.equal(activeFragments(first).filter(f=>f.text===condition.text).length,2);
  assert.deepEqual(fragmentDependencies(first),fragmentDependencies(third));assert.equal(h.adapter.requests.length,calls);
  assert.equal(summarySelectionState(h.session(),a.ref,a.memory.scope),'superseded');assert.ok(resolveFragmentProof(h.session(),a.ref,a.memory.scope));
  const extension=h.core.registerExtension({id:'fictional-c3-extension',version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',contexts:[{
    id:'status',kind:'operational-fact',prepare:async()=>[{id:'status',version:'1',text:'SECOND_PLUGIN_KEEP',expiresAt:new Date(Date.now()+600000).toISOString(),sources:[{ref:'fictional:status',version:'1',hash:'test'}]}],validate:()=>true,
  }]});
  h.mutate(a.memory,'delete',1);await h.run('退出A，继续B');const partial=resolveFragmentView(h.session(),ref,a.memory.scope);assert.ok(partial);
  assert.deepEqual(activeFragments(partial).filter(f=>f.text.includes('B_ONLY')),bBefore);assert.ok(!partial.text.includes('A_ONLY'));assert.match(h.visible(),/SECOND_PLUGIN_KEEP/);
  assert.equal((await h.probe('other',c=>h.timeline.open(c,{ref}))).status,'not_found');
  extension.dispose();await h.ctx.sessions.flush(h.session());await h.close();closed=true;
  const next=await provenanceFixture(root);
  try{
    await next.run('重启后继续');assert.match(next.visible(),/B_ONLY/);assert.ok(!next.visible().includes('A_ONLY'));
    next.mutate(a.memory,'restore',2);await next.run('恢复来源');assert.ok(!next.visible().includes('A_ONLY'));
    const result={at:new Date().toISOString(),projectVersion:'0.12.0',coreVersion:'0.9.0',samples:'fictional-Chinese',model:'scripted',serverAccess:false,
      generations:3,compositionModelCalls:0,inputFragments:a.view.view.active.length+b.view.view.active.length,combinedFragments:first.view.active.length,
      sameOriginDuplicatesRemoved:1,identicalTextFromDifferentOriginsPreserved:true,originalClosurePreserved:true,
      supersededParentProofReadable:true,supersededParentNotSelected:true,remainingAfterDeletion:partial.view.active.length,
      survivingFragmentIdsAndTextUnchanged:true,otherPluginRegionPreserved:true,crossConversationDenied:true,restartPassed:true,restoreDidNotReactivate:true,
      originalArchivesRetained:JSON.stringify(next.session().snapshotEvents()).includes('A_ONLY'),
      parentDisplayBytes:Buffer.byteLength(a.view.text)+Buffer.byteLength(b.view.text),combinedDisplayBytes:Buffer.byteLength(first.text),
      measurement:'Scripted roots on real DSH sessions. Three generations explicitly exercise the lineage API; automatic runtime scheduling additionally requires positive savings. Display bytes exclude private proofs and are not whole-session token or memory measurements.'};
    await writeFile(resolve(root,'result.json'),JSON.stringify(result,null,2)+'\n');await writeFile(resolve('docs/memory-phase-5c3a-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
  }finally{await next.close();}
}finally{if(!closed)await h.close();}
