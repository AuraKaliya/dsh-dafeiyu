import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { API_VERSION } from '@dafeiyu/contracts';
import { activeFragments,expandedFragmentProof } from '@dafeiyu/core';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { fragmentFixture } from '../build-tests/fragment-fixture.js';

const root=resolve('.runtime/demos',`fragments-${randomUUID()}`);await mkdir(root,{recursive:true});
const h=await fragmentFixture(root),expiry=new Date(Date.now()+600000).toISOString();
const extension=h.core.registerExtension({id:'fictional-secondary',version:'1',protocolVersion:4,agentId:'dafeiyu',contexts:[{
  id:'status',kind:'operational-fact',prepare:async()=>[{id:'status',version:'1',text:'SECOND_PLUGIN_STAYS',expiresAt:expiry,sources:[{ref:'fictional:secondary',version:'1',hash:'test'}]}],validate:()=>true,
}]});
try{
  await h.run('其他插件区域已装配');const before=h.view(),proof=expandedFragmentProof(before),inline=JSON.stringify(proof);
  const compactBytes=Buffer.byteLength(before.text),inlineProofBytes=Buffer.byteLength(inline),proofBytes=Buffer.byteLength(JSON.stringify(before.manifest));
  const meter=h.ctx.get('tokenMeter'),compactTokens=meter.estimateMessage(before.checkpoint.data),inlineTokens=meter.estimateMessage(createUserMessage({source:{kind:'user'},content:[{type:'text',text:inline}]}));
  assert.ok(compactBytes<inlineProofBytes);assert.ok(compactTokens<inlineTokens);
  const kept=JSON.parse(before.text).fragments.filter(f=>f.text.startsWith('B_')),calls=h.modelCalls().length;
  h.mutate(h.a,'delete',1);await h.run('删除A后继续B');const after=h.view();
  assert.equal(after.manifestSeq,before.manifestSeq);assert.deepEqual(JSON.parse(after.text).fragments.filter(f=>f.text.startsWith('B_')),kept);
  assert.ok(!after.text.includes('A_FACT_ONLY'));assert.equal(h.modelCalls().length,calls);assert.match(h.visible(),/SECOND_PLUGIN_STAYS/);
  const fragment=activeFragments(after).find(f=>f.text.startsWith('B_FACT_KEEP'));
  const opened=await h.probe('a',c=>h.timeline.open(c,{ref:`${h.ref}.${fragment.id}`,limit:2000}));assert.equal(opened.status,'ok');
  assert.equal((await h.probe('other',c=>h.timeline.open(c,{ref:h.ref}))).status,'not_found');
  h.mutate(h.a,'restore',2);await h.run('恢复后不复活旧片段');assert.ok(!h.view().text.includes('A_FACT_ONLY'));
  const result={at:new Date().toISOString(),projectVersion:'0.11.0',model:'scripted',samples:'fictional-Chinese',serverAccess:false,
    originalFragments:before.view.active.length,remainingFragments:after.view.active.length,retiredFragments:before.view.active.length-after.view.active.length,
    sameCheckpoint:true,survivingFragmentRefsAndTextUnchanged:true,retirementModelCalls:0,restoreDidNotReactivate:true,otherPluginRegionPreserved:true,
    shortReferenceLookupPassed:true,crossConversationDenied:true,
    compactCheckpointBytes:compactBytes,equivalentInlineProofBytes:inlineProofBytes,privateManifestBytes:proofBytes,
    modelVisibleByteReductionPercent:Number(((1-compactBytes/inlineProofBytes)*100).toFixed(1)),compactDshEstimatedTokens:compactTokens,inlineDshEstimatedTokens:inlineTokens,
    measurement:'Same fragment text; compare compact checkpoint against C1-style inline proof. DSH estimates are not provider billing; not whole-conversation savings.',
    originalArchivesRetained:JSON.stringify(h.session().snapshotEvents()).includes('A_FACT_ONLY')};
  await writeFile(resolve(root,'result.json'),JSON.stringify(result,null,2)+'\n');await writeFile(resolve('docs/memory-phase-5c2-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{extension.dispose();await h.close();}
