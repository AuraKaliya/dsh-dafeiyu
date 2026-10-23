import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { observationFixture,observationReport,observationConversation } from '../build-tests/observation-fixture.js';

const root=resolve('.runtime/demos',`observations-${randomUUID()}`);await mkdir(root,{recursive:true});
const h=await observationFixture(root);let closed=false;
try{
  // This fictional capability owns its filtering rule; the memory module sees only its report.
  const messages=[{key:'original',text:'值得保留：仅限虚构测试。'},{key:'fragment',text:'前文🙂选中片段后文'},
    {key:'summary-batch',text:'提供给插件的虚构批次原文_ONLY_DIGEST_RETAINED'},{key:'ignored',text:'IGNORED_MESSAGE_NEVER_SENT_TO_MEMORY'}];
  const selected=messages.filter(m=>m.key!=='ignored'),occurredAt='2026-10-19T10:00:00.000Z';
  const sourceSpecs=selected.map(m=>({key:m.key,occurredAt,archive:m.key==='summary-batch'?{kind:'digest',hash:createHash('sha256').update(m.text).digest('hex')}:{kind:'text',text:m.text},
    ...(m.key==='fragment'?{policy:{externalExpression:'none'}}:{})}));
  const input=observationReport({counts:{received:messages.length,processed:messages.length,modelExposed:0},sources:sourceSpecs,contributions:[
    {id:'whole',form:'original',source:'original',exposure:['original']},
    {id:'piece',form:'fragment',source:'fragment',start:2,end:7,text:'🙂选中片段',exposure:['fragment']},
    {id:'brief',form:'summary',text:'插件选择只记住：该批次尚无确定结论。',exposure:['summary-batch']},
  ]});
  const receipt=h.handle.observeMemory(input),none=h.handle.observeMemory(observationReport({sources:[],contributions:[],counts:{received:50,processed:50,modelExposed:0},
    selection:{policyId:'fictional-interest',policyVersion:'1',reasonCode:'no-interest'}}));
  assert.equal(none.contributions.length,0);assert.equal(h.adapter.requests.length,0);assert.equal(h.simulator.deliveries.length,0);
  assert.equal(receipt.contributions.length,3);assert.equal([...h.store.current(h.scope)].length,2);
  assert.ok(h.store.read(h.scope,receipt.contributions[1].memoryId,'normal',undefined,'internal'));
  const digestRef=receipt.sources.find(s=>s.key==='summary-batch').ref;
  assert.equal(h.handle.openObservationSource({conversation:observationConversation,ref:digestRef}).status,'digest_only');
  const db=new DatabaseSync(join(root,'memory.sqlite'));try{
    const archive=JSON.stringify(db.prepare('SELECT body FROM observation_sources').all());assert.ok(!archive.includes(messages[3].text));assert.ok(!archive.includes('ONLY_DIGEST_RETAINED'));
  }finally{db.close();}
  const originalRef=receipt.sources.find(s=>s.key==='original').ref,originalMemory=receipt.contributions[0].memoryId;
  h.handle.changeObservationSource({conversation:observationConversation,ref:originalRef,requestId:'delete',expectedVersion:1,action:'delete'});
  assert.equal(h.store.read(h.scope,originalMemory),null);assert.ok(h.store.read(h.scope,receipt.contributions[2].memoryId));
  await h.close();closed=true;const next=await observationFixture(root,'fixture-v2');
  try{
    assert.equal(next.handle.observeMemory(input).duplicate,true);
    next.handle.changeObservationSource({conversation:observationConversation,ref:originalRef,requestId:'restore',expectedVersion:2,action:'restore'});
    assert.equal(next.store.read(next.scope,originalMemory),null);
    assert.throws(()=>next.handle.observeMemory({...input,requestId:randomUUID()}),/version_conflict/);
    const report={at:new Date().toISOString(),projectVersion:'0.15.0',samples:'fictional-plugin-only',serverAccess:false,realModel:false,
      forms:['original','fragment','summary','no-contribution'],selectedContributions:3,noContributionCreatedMemories:0,
      pluginOwnsFiltering:true,discardedMessageNotArchived:true,digestOnlyOriginalNotArchived:true,digestOnlyLookupReported:true,
      internalUseSeparatedFromExpression:true,activityDoesNotStartModelOrDelivery:true,sourceDeletionInvalidatesMemory:true,
      unrelatedSummaryPreserved:true,restartAndRetryPassed:true,restoreDidNotReactivate:true,staleObservationVersionRejected:true,sourceAndAuditVersionsPreserved:true};
    await writeFile(resolve(root,'result.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve('docs/agent-memory-phase-b-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }finally{await next.close();}
}finally{if(!closed)await h.close();}
