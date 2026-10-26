import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import type { PersonaAccess,PersonaTrialAdmissionInput,PersonaTrialCompletionInput } from '@dafeiyu/contracts';
import { personaDigest } from '../packages/memory/lib/persona-digest.js';
import { experienceFixture } from './memory-experience-fixture.js';

test('personality adoption remains pinned to current experience content while historical inputs survive correction',async()=>{
  const h=await experienceFixture();try{
    const persona=h.memory.personaStore((_access,ref)=>{const value=h.values.get(ref.id);return value?{...value,dependencies:[]}:null;});
    const id=h.store.request(h.access,{requestId:'first',sources:[h.a],reason:'测试经验'});h.store.begin(h.access,id);
    const result=h.store.commit(h.access,id,[h.draft],[]) as {experienceIds:string[];experienceBasis:{id:string;sourceId:string;taskEpoch:number}[]};
    const proposed=persona.propose(h.access,{requestId:'persona',kind:'view',contentRef:h.body,supports:[h.a],counters:[h.b],applicability:'仅虚构场景',reason:'明确选择',experienceBasis:result.experienceBasis});
    const trial=persona.review(h.access,{requestId:'trial',id:proposed.id,expectedVersion:1,state:'trial',reason:'试行'});
    const candidate={id:trial.id,version:trial.version},selected=persona.selectTrial(h.access,{requestId:'select-trial',expectedSelectionVersion:0,
      entries:[{candidate,applicability:'仅虚构场景',exitConditions:['经验更正或来源撤下时退出']}]});
    // Memory-only contract fixture: these records model a separate closed Run; real DSH issuance is tested independently.
    const trialAccess:PersonaAccess={...h.access,view:{...h.access.view,runId:randomUUID()},operationId:randomUUID(),startedEventId:randomUUID()};
    const entry=persona.prepare(trialAccess).trialEntries?.[0];assert.ok(entry);
    const admission:PersonaTrialAdmissionInput={schemaVersion:1,agentId:trialAccess.view.scope.agentId,scope:trialAccess.view.scope,runId:trialAccess.view.runId,
      manifestHash:personaDigest({fixture:'memory-only-trial-manifest',candidate}),trialSelectionVersion:selected.selection.version,admittedAt:new Date().toISOString(),
      entries:[{candidate,selection:entry.trialSelection,contentRef:entry.contentRef,dependencies:[...entry.dependencies],projectionHash:personaDigest(entry.item),sourceEvidence:[...entry.sourceEvidence]}]};
    assert.equal(persona.admitTrial(trialAccess,admission).length,1);
    const completion:PersonaTrialCompletionInput={schemaVersion:1,agentId:trialAccess.view.scope.agentId,scope:trialAccess.view.scope,runId:trialAccess.view.runId,
      terminal:{state:'completed',result:{sessionId:'memory-unit-trial-fixture',messageSeq:1,turnEndSeq:2,textHash:createHash('sha256').update('模拟闭合试行：核对虚构雨天条件后作出有限选择。').digest('hex')}},
      closedAt:new Date().toISOString(),closedEventId:randomUUID(),operations:[],sources:[h.a,h.b],sourceEvidence:[...entry.sourceEvidence],gaps:['仅脚本夹具的闭合记录，不代表真实平台效果']};
    const outcomes=persona.completeTrial(trialAccess,completion);assert.equal(outcomes.length,1);
    const reviewAccess:PersonaAccess={...h.access,view:{...h.access.view,runId:randomUUID()},operationId:randomUUID(),startedEventId:randomUUID()};
    const reviewed=persona.reviewAdoption(reviewAccess,{requestId:'adoption-review',candidate,trialOutcomes:outcomes,supports:[h.a],counters:[h.b],
      counterCheck:{status:'found',reason:'保留原反证引用和虚构条件，未视为已完全解决'},conclusionScope:'仅虚构场景',targetMaturity:'tentative',
      limitations:['仅虚构经验与脚本试行，未验证晴天或真实平台效果'],reason:'按有限证据采用仍暂定的认识，不扩大原适用范围'});
    assert.equal(reviewed.eligibility,'allowed');
    persona.publish(reviewAccess,{requestId:'publish',expectedStageVersion:0,entries:[{...candidate,review:reviewed.review}]});assert.equal(persona.prepare(h.access).entries.length,1);
    const experienceId=result.experienceIds[0]!;h.store.review(h.access,{requestId:'review',id:experienceId,expectedVersion:1,state:'accepted',reason:'有条件采用'});
    assert.equal(persona.prepare(h.access).entries.length,1); // Review did not change the underlying inference.
    const newSource=h.ref('新的虚构反证',['new-root']),newBody=h.ref('修订后的有条件推断',['shared-root','new-root']);
    const access={...h.access,admittedSources:[h.a,h.b,newSource]};
    const second=h.store.request(access,{requestId:'second',sources:[newSource],targets:[{id:experienceId,version:2}],reason:'新证据修订'});h.store.begin(access,second);
    h.store.commit(access,second,[{...h.draft,contentRef:newBody,target:{id:experienceId,version:2},supports:[newSource],counters:[h.a]}],[]);
    assert.equal(h.store.read(access,experienceId).version,3);assert.equal(h.store.sourceCurrent(access,h.body),true);
    assert.equal(persona.prepare(access).entries.length,0);assert.equal(persona.status(access).candidates[0]?.available,false);
    assert.throws(()=>persona.propose(access,{requestId:'stale-proposal',kind:'view',contentRef:h.body,supports:[h.a],counters:[],applicability:'旧意见',reason:'试图复活旧建议',experienceBasis:result.experienceBasis}),/SOURCE_STALE/);
    h.store.review(access,{requestId:'withdraw',id:experienceId,expectedVersion:3,state:'withdrawn',reason:'撤下'});
    assert.equal(h.store.sourceCurrent(access,h.body),false);assert.equal(h.store.sourceCurrent(access,newBody),false);
  }finally{h.close();}
});
