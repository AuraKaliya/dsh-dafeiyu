import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import type { PersonaAccess,PersonaSourceRef,PersonaSourceNature,PersonaTrialAdmissionInput,PersonaTrialCompletionInput } from '@dafeiyu/contracts';
import { PersonaCandidateRevisionSchema } from '@dafeiyu/contracts';
import { experienceFixture } from './memory-experience-fixture.js';
import { personaDigest,personaScope } from '../packages/memory/lib/persona-digest.js';

const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const applicability='仅适用于虚构蓝灯雨天样本';

/** Store-level fixture explicitly simulates trusted callbacks; full core authority is tested separately. */
async function fixture(kind:'view'|'interest'='view'){
  const h=await experienceFixture();let nature:PersonaSourceNature='synthetic';
  const resolve=(access:PersonaAccess,ref:PersonaSourceRef)=>{const value=h.values.get(ref.id);
    if(!value||ref.agentId!==access.view.scope.agentId||ref.scopeKey!==personaScope(h.access.view.scope)||ref.version!==1||hash(value.text)!==ref.contentHash)return null;
    return {...value,dependencies:[],evidence:{source:ref,nature,coverage:['虚构样本原文'],completeness:'complete' as const,roots:value.rootSources.map(key=>({key,nature}))}};};
  const persona=h.memory.personaStore(resolve),proposal=persona.propose(h.access,{requestId:'propose',kind,contentRef:h.body,supports:[h.a],counters:[h.b],applicability,reason:'保持限定认识'});
  const trial=persona.review(h.access,{requestId:'trial',id:proposal.id,expectedVersion:1,state:'trial',reason:'进入实际试行前准备'}),candidate={id:trial.id,version:trial.version};
  persona.selectTrial(h.access,{requestId:'select',expectedSelectionVersion:0,entries:[{candidate,applicability,exitConditions:['来源撤回即停止']}]});
  const useAccess:PersonaAccess={...h.access,view:{...h.access.view,runId:randomUUID()}},reviewAccess:PersonaAccess={...h.access,view:{...h.access.view,runId:randomUUID()}};
  const entry=persona.prepare(useAccess).trialEntries![0]!,admission:PersonaTrialAdmissionInput={schemaVersion:1,agentId:h.access.view.scope.agentId,scope:h.access.view.scope,runId:useAccess.view.runId,
    manifestHash:hash('scripted manifest'),trialSelectionVersion:1,admittedAt:new Date().toISOString(),entries:[{candidate,selection:entry.trialSelection,contentRef:entry.contentRef,dependencies:[...entry.dependencies],projectionHash:personaDigest(entry.item),sourceEvidence:[...entry.sourceEvidence]}]};
  const completion=():PersonaTrialCompletionInput=>({schemaVersion:1,agentId:h.access.view.scope.agentId,scope:h.access.view.scope,runId:useAccess.view.runId,
    terminal:{state:'completed',result:{sessionId:'scripted-use',messageSeq:2,turnEndSeq:3,textHash:hash('这次据雨天条件调整了虚构选择，仍需比较晴天。')}},closedAt:new Date().toISOString(),closedEventId:randomUUID(),operations:[],sources:[],sourceEvidence:[],gaps:[]});
  const use=()=>{persona.admitTrial(useAccess,admission);return persona.completeTrial(useAccess,completion());};
  const review=(requestId='adoption-review',targetMaturity:'tentative'|'established'='tentative')=>persona.reviewAdoption(reviewAccess,{requestId,candidate,trialOutcomes:persona.status(reviewAccess).trialOutcomes.map(outcome=>outcome.ref),supports:[],counters:[],counterCheck:{status:'found',reason:'保留同源反例和适用限制'},conclusionScope:applicability,targetMaturity,limitations:['虚构样本，不能视为真实长期行为'],reason:'根据实际闭合试行保留限定认识'});
  const counts=()=>Object.fromEntries(['persona_candidate_revisions','persona_adoption_decisions','persona_profile_revisions','growth_revisions','persona_trial_selection_revisions'].map(table=>[table,Number(h.db.prepare(`SELECT count(*) n FROM ${table}`).get()?.n)]));
  return {...h,persona,candidate,useAccess,reviewAccess,entry,admission,use,review,counts,setNature:(value:PersonaSourceNature)=>{nature=value;}};
}

test('legacy propose-review-publish cannot adopt without an actual trial outcome and adoption review',async()=>{
  const h=await fixture();try{const before=h.counts();
    assert.throws(()=>h.persona.publish(h.access,{requestId:'shortcut',expectedStageVersion:0,entries:[h.candidate]}),/PERSONA_ADOPTION_REVIEW_REQUIRED/);
    assert.throws(()=>h.review());assert.deepEqual(h.counts(),before);assert.equal(h.persona.status(h.access).candidates[0]?.state,'trial');
    assert.equal(h.db.prepare('SELECT count(*) n FROM persona_adoption_reviews').get()?.n,0);
  }finally{h.close();}
});

test('an allowed review is rechecked at publication and receives a new immutable Decision with atomic selection changes',async()=>{
  const h=await fixture();try{h.use();const review=h.review();assert.equal(review.eligibility,'allowed');assert.equal(review.published,false);
    const input={requestId:'publish',expectedStageVersion:0,entries:[{...h.candidate,review:review.review}]},result=h.persona.publish(h.reviewAccess,input);
    assert.deepEqual(h.persona.publish(h.reviewAccess,input),result);assert.equal(result.stageRevision,1);assert.equal(result.selectionVersion,1);
    const raw=JSON.parse(String(h.db.prepare('SELECT body FROM persona_candidate_revisions WHERE id=? ORDER BY version DESC LIMIT 1').get(h.candidate.id)?.body));
    const candidate=PersonaCandidateRevisionSchema.parse(raw);assert.equal(candidate.schemaVersion,2);if(candidate.schemaVersion!==2)throw new Error('Expected v2');
    assert.equal(candidate.state,'adopted');assert.equal(candidate.maturity,'tentative');assert.equal(candidate.applicability,applicability);assert.equal(candidate.motivation.kind,'explicit-task');
    assert.notEqual(candidate.adoption?.decision.id,review.decision.id);assert.deepEqual(candidate.counters,[h.b]);
    const decision=JSON.parse(String(h.db.prepare('SELECT body FROM persona_adoption_decisions WHERE id=?').get(candidate.adoption!.decision.id)?.body));
    assert.equal(decision.stageRevision,0);assert.equal(decision.selectionVersion,0);assert.equal(decision.trialSelectionVersion,1);
    assert.equal(h.persona.status(h.reviewAccess).trialSelectionVersion,2);assert.equal(h.persona.prepare(h.reviewAccess).trialEntries?.length,0);assert.equal(h.persona.prepare(h.reviewAccess).entries.length,1);
    assert.equal(h.db.prepare('SELECT count(*) n FROM persona_adoption_decisions').get()?.n,2);
  }finally{h.close();}
});

test('explicit tasks cannot adopt personal interests and synthetic evidence cannot establish maturity',async()=>{
  for(const kind of ['interest','view'] as const){const h=await fixture(kind);try{h.use();const review=h.review('review',kind==='view'?'established':'tentative');assert.equal(review.eligibility,'held');
    assert.ok(review.reasons.includes(kind==='view'?'maturity-unsupported':'motivation-mismatch'));const before=h.counts();
    assert.throws(()=>h.persona.publish(h.reviewAccess,{requestId:'publish',expectedStageVersion:0,entries:[{...h.candidate,review:review.review}]}),/PERSONA_ADOPTION_HELD/);
    assert.deepEqual(h.counts(),before);assert.equal(h.persona.stage(h.access.view.scope.agentId).revision,0);
  }finally{h.close();}}
});

test('source withdrawal and descriptor changes invalidate a previously allowed review before any write',async()=>{
  for(const change of ['withdraw','nature'] as const){const h=await fixture();try{h.use();const review=h.review();assert.equal(review.eligibility,'allowed');const before=h.counts();
    if(change==='withdraw')h.values.delete(h.a.id);else h.setNature('observed');
    assert.throws(()=>h.persona.publish(h.reviewAccess,{requestId:'publish',expectedStageVersion:0,entries:[{...h.candidate,review:review.review}]}),change==='withdraw'?/SOURCE_STALE/:/SOURCE_STATE_CONFLICT/);
    assert.deepEqual(h.counts(),before);
  }finally{h.close();}}
});

test('a publication failure rolls back its Decision, candidate, stage and both selections, then retries once',async()=>{
  const h=await fixture();try{h.use();const review=h.review(),input={requestId:'publish',expectedStageVersion:0,entries:[{...h.candidate,review:review.review}]},before=h.counts();
    h.db.exec("CREATE TRIGGER fixture_reject_publication BEFORE INSERT ON persona_outbox WHEN json_extract(NEW.body,'$.type')='persona.published' BEGIN SELECT RAISE(ABORT,'fixture-publication');END;");
    assert.throws(()=>h.persona.publish(h.reviewAccess,input),/fixture-publication/);assert.deepEqual(h.counts(),before);assert.equal(h.persona.prepare(h.reviewAccess).trialEntries?.length,1);
    h.db.exec('DROP TRIGGER fixture_reject_publication');const result=h.persona.publish(h.reviewAccess,input);assert.deepEqual(h.persona.publish(h.reviewAccess,input),result);
    assert.equal(h.db.prepare('SELECT count(*) n FROM persona_adoption_decisions').get()?.n,2);
  }finally{h.close();}
});

test('mixed batches cannot partially adopt and a current candidate cannot reuse another candidate review',async()=>{
  const h=await fixture();try{h.use();const review=h.review(),other=h.persona.propose(h.reviewAccess,{requestId:'other',kind:'view',contentRef:h.body,supports:[h.a],applicability,reason:'另一候选'});
    const trial=h.persona.review(h.reviewAccess,{requestId:'other-trial',id:other.id,expectedVersion:1,state:'trial',reason:'准备'}),before=h.counts();
    assert.throws(()=>h.persona.publish(h.reviewAccess,{requestId:'batch',expectedStageVersion:0,entries:[{...h.candidate,review:review.review},{id:trial.id,version:trial.version,review:review.review}]}),/VERSION_CONFLICT/);
    assert.deepEqual(h.counts(),before);assert.equal(h.persona.status(h.access).candidates.every(candidate=>candidate.state==='trial'),true);
  }finally{h.close();}
});

test('only the actually admitted Run retains its old trial projection through promotion; withdrawal invalidates it',async()=>{
  const h=await fixture();try{h.use();const review=h.review();h.persona.publish(h.reviewAccess,{requestId:'publish',expectedStageVersion:0,entries:[{...h.candidate,review:review.review}]});
    const old=h.persona.prepare(h.useAccess).trialEntries;assert.equal(old?.length,1);assert.deepEqual(old?.[0]?.item,h.entry.item);
    assert.equal(h.persona.prepare(h.reviewAccess).trialEntries?.length,0);assert.equal(h.persona.validate(h.useAccess,h.entry),true);
    h.persona.withdraw(h.reviewAccess,{requestId:'withdraw',id:h.candidate.id,expectedVersion:3,reason:'撤回暂定认识'});assert.equal(h.persona.validate(h.useAccess,h.entry),false);
    assert.equal(h.persona.prepare(h.reviewAccess).entries.length,0);assert.equal(h.db.prepare('SELECT count(*) n FROM persona_trial_outcomes').get()?.n,1);
  }finally{h.close();}
});
