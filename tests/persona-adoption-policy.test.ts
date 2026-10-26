import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  ExecutionScopeSchema, MotivationSchema, PersonaAdoptionReviewSchema, PersonaCandidateRevisionV2Schema,
  PersonaSourceEvidenceSchema, PersonaSourceRefSchema, PersonaTrialAdmissionSchema, PersonaTrialOutcomeSchema, taskScopeKey,
} from '@dafeiyu/contracts';
import type { PersonaAdoptionReview, PersonaCandidate, PersonaSourceEvidence, PersonaTrialAdmission, PersonaTrialOutcome } from '@dafeiyu/contracts';
import { evaluatePersonaAdoption, PERSONA_ADOPTION_POLICY_VERSION } from '../packages/memory/lib/persona-adoption-policy.js';
import type { PersonaAdoptionPolicyInput, PersonaAdoptionPolicyResult } from '../packages/memory/lib/persona-adoption-policy.js';
import { personaDigest } from '../packages/memory/lib/persona-digest.js';

const textHash=(text:string)=>createHash('sha256').update(text).digest('hex');
const createdAt='2026-10-26T00:00:00.000Z',admittedAt='2026-10-26T00:00:01.000Z',closedAt='2026-10-26T00:00:02.000Z',reviewedAt='2026-10-26T00:00:03.000Z';
interface FixtureOptions {
  kind?:PersonaCandidate['kind'];nature?:PersonaSourceEvidence['nature'];completeness?:PersonaSourceEvidence['completeness'];
  motivation?:PersonaCandidate['motivation']['kind'];maturity?:PersonaAdoptionReview['targetMaturity'];
  counter?:PersonaAdoptionReview['counterCheck']['status'];limitations?:string[];
}
function fixture(options:FixtureOptions={}):PersonaAdoptionPolicyInput {
  const agentId='fictional-fish',taskId=randomUUID(),runId=randomUUID(),scopeKey=taskScopeKey(agentId,taskId);
  const scope=ExecutionScopeSchema.parse({kind:'task',agentId,taskId,scopeKey});
  const source=(text:string)=>PersonaSourceRefSchema.parse({kind:'execution-source',id:randomUUID(),agentId,scopeKey,version:1,contentHash:textHash(text)});
  const content=source('A tentative bounded way of responding.'),support=source('Fictional source supporting only this bounded scenario.'),counter=source('A bounded counter-check record.');
  const nature=options.nature??'synthetic',completeness=options.completeness??'partial';
  const supportEvidence=PersonaSourceEvidenceSchema.parse({source:support,nature,completeness,coverage:['bounded fictional scope'],roots:[{key:'single-original-root',nature}]});
  const counterEvidence=PersonaSourceEvidenceSchema.parse({...supportEvidence,source:counter});
  const contentEvidence=PersonaSourceEvidenceSchema.parse({...supportEvidence,source:content,nature:'self-report',completeness:'unknown',coverage:['current-statement']});
  const motivation=MotivationSchema.parse({kind:options.motivation??'explicit-task',basis:['trusted-original-task']});
  const counterStatus=options.counter??'unknown';
  const candidate=PersonaCandidateRevisionV2Schema.parse({schemaVersion:2,id:randomUUID(),agentId,version:2,state:'trial',kind:options.kind??'value-application',
    contentRef:content,supports:[support],counters:counterStatus==='found'?[counter]:[],dependencies:[content,support,counter],rootSources:['single-original-root'],scope,
    motivation,applicability:'Only this bounded fictional situation.',reason:'A limited proposition to try.',runId:randomUUID(),producer:'fixture',createdAt,
    policyVersion:PERSONA_ADOPTION_POLICY_VERSION,maturity:'tentative',adoption:null});
  const entry={id:candidate.id,version:candidate.version};
  const selection={agentId,scopeKey,version:1,hash:textHash('trial-selection')};
  const trialPolicy=textHash('separate-trial-protocol');
  const admission=PersonaTrialAdmissionSchema.parse({schemaVersion:1,id:randomUUID(),agentId,scope,runId,manifestHash:textHash('actual-run-manifest'),
    trialSelectionVersion:1,admittedAt,candidate:entry,selection,contentRef:content,dependencies:candidate.dependencies,
    projectionHash:textHash('actual-tentative-projection'),sourceEvidence:[contentEvidence,supportEvidence],policyVersion:trialPolicy});
  const outcome=PersonaTrialOutcomeSchema.parse({schemaVersion:1,id:randomUUID(),agentId,scope,runId,admission:{id:admission.id,hash:personaDigest(admission)},candidate:entry,selection,
    terminal:{state:'completed',result:{sessionId:'actual-closed-session',messageSeq:10,turnEndSeq:12,textHash:textHash('A real visible response applying a bounded choice.')}},
    closedAt,closedEventId:randomUUID(),operations:[],sources:[],sourceEvidence:[],gaps:[],policyVersion:trialPolicy});
  const counterCheck=counterStatus==='checked-none'?{status:counterStatus,checkedSources:[counter],reason:'Checked the available source within its stated coverage.'}
    :{status:counterStatus,reason:counterStatus==='found'?'The counter-source remains included in this limited interpretation.':'Counter-evidence remains unknown.'};
  const review=PersonaAdoptionReviewSchema.parse({schemaVersion:1,id:randomUUID(),agentId,scope,runId:randomUUID(),producer:'fixture',createdAt:reviewedAt,
    policyVersion:PERSONA_ADOPTION_POLICY_VERSION,motivation,candidate:entry,trialOutcomes:[{id:outcome.id,hash:personaDigest(outcome)}],supports:[support],
    counters:counterStatus==='found'?[counter]:[],counterCheck,conclusionScope:candidate.applicability,targetMaturity:options.maturity??'tentative',
    limitations:options.limitations??['Only the stated coverage is known; unobserved effects and counter-evidence remain unknown.'],reason:'Review the recorded choice without inventing broader experience.',
    dependencies:[content,support,counter],sourceEvidence:[contentEvidence,supportEvidence,counterEvidence]});
  return {candidate,review,trials:[{admission,outcome}],sourceEvidence:[contentEvidence,supportEvidence,counterEvidence],originalMotivation:motivation,scope};
}
function replaceTrial(input:PersonaAdoptionPolicyInput,outcome:PersonaTrialOutcome,admission?:PersonaTrialAdmission):PersonaAdoptionPolicyInput {
  const original=input.trials[0];assert.ok(original);
  return {...input,trials:[{admission:admission??original.admission,outcome}],review:{...input.review,trialOutcomes:[{id:outcome.id,hash:personaDigest(outcome)}]}};
}
function firstTrial(input:PersonaAdoptionPolicyInput){const trial=input.trials[0];assert.ok(trial);return trial;}
function held(result:PersonaAdoptionPolicyResult,reason:PersonaAdoptionPolicyResult['reasons'][number]){assert.equal(result.eligibility,'held');assert.ok(result.reasons.includes(reason));}
const mature=():PersonaAdoptionPolicyInput=>fixture({nature:'observed',completeness:'complete',maturity:'established',counter:'checked-none',limitations:[]});

test('one bounded source and a genuine closed conversation qualify for tentative value application without an external write',()=>{
  const input=fixture();assert.equal(firstTrial(input).outcome.operations.length,0);
  assert.deepEqual(evaluatePersonaAdoption(input),{eligibility:'allowed',reasons:[]});
  assert.notEqual(firstTrial(input).outcome.policyVersion,PERSONA_ADOPTION_POLICY_VERSION);
});

test('calling a persona status tool does not disqualify a separate real visible conversation result',()=>{
  const input=fixture(),{outcome}=firstTrial(input);
  const changed=PersonaTrialOutcomeSchema.parse({...outcome,operations:[{id:randomUUID(),action:'dafeiyu_persona_status',status:'succeeded',effects:'none',completeness:'complete',outcomeHash:textHash('status receipt')} ]});
  assert.equal(evaluatePersonaAdoption(replaceTrial(input,changed)).eligibility,'allowed');
});

test('missing requested evidence cannot be supplied by an unrelated extra trial',()=>{
  const input=fixture();held(evaluatePersonaAdoption({...input,trials:[]}), 'trial-evidence-missing');
  held(evaluatePersonaAdoption({...input,trials:fixture().trials}), 'trial-evidence-missing');
});

test('closed failures remain facts but do not invent a completed visible trial',()=>{
  const input=fixture(),{outcome}=firstTrial(input);
  for(const state of ['failed','cancelled','interrupted'] as const){
    const changed=PersonaTrialOutcomeSchema.parse({...outcome,terminal:{state,result:null}});
    held(evaluatePersonaAdoption(replaceTrial(input,changed)),'trial-not-closed');
  }
});

test('trial admission and closure must precede review without imposing a minimum elapsed duration',()=>{
  const input=fixture(),{admission,outcome}=firstTrial(input);
  held(evaluatePersonaAdoption({...input,review:{...input.review,createdAt:admittedAt}}),'trial-not-closed');
  const lateAdmission=PersonaTrialAdmissionSchema.parse({...admission,admittedAt:reviewedAt});
  held(evaluatePersonaAdoption(replaceTrial(input,{...outcome,admission:{id:lateAdmission.id,hash:personaDigest(lateAdmission)}},lateAdmission)),'trial-not-used');
  const immediate=PersonaTrialAdmissionSchema.parse({...admission,admittedAt:closedAt});
  const sameTime=replaceTrial(input,{...outcome,admission:{id:immediate.id,hash:personaDigest(immediate)}},immediate);
  assert.equal(evaluatePersonaAdoption({...sameTime,review:{...sameTime.review,createdAt:closedAt}}).eligibility,'allowed');
});

test('an admission from a different run or selection cannot prove this trial',()=>{
  const input=fixture(),{outcome}=firstTrial(input);
  held(evaluatePersonaAdoption(replaceTrial(input,{...outcome,runId:randomUUID()})),'trial-not-used');
  held(evaluatePersonaAdoption(replaceTrial(input,{...outcome,selection:{...outcome.selection,version:2}})),'trial-not-used');
});

test('empty output, original self-report replay and management receipts do not prove actual use',()=>{
  const input=fixture(),{outcome}=firstTrial(input);assert.equal(outcome.terminal.state,'completed');
  if(outcome.terminal.state!=='completed')throw new Error('fixture must be completed');
  for(const resultHash of [textHash(''),input.candidate.contentRef.contentHash]){
    const changed=PersonaTrialOutcomeSchema.parse({...outcome,terminal:{state:'completed',result:{...outcome.terminal.result,textHash:resultHash}}});
    held(evaluatePersonaAdoption(replaceTrial(input,changed)),'trial-not-used');
  }
  const receipt=textHash('persona publish receipt');
  const receiptOnly=PersonaTrialOutcomeSchema.parse({...outcome,terminal:{state:'completed',result:{...outcome.terminal.result,textHash:receipt}},
    operations:[{id:randomUUID(),action:'dafeiyu_persona_publish',status:'succeeded',effects:'confirmed',completeness:'complete',outcomeHash:receipt}]});
  held(evaluatePersonaAdoption(replaceTrial(input,receiptOnly)),'trial-not-used');
});

test('review cannot replace the exact applicability or adopt another candidate version',()=>{
  const input=fixture();
  held(evaluatePersonaAdoption({...input,review:{...input.review,conclusionScope:input.candidate.applicability+' Broader contexts too.'}}),'scope-mismatch');
  held(evaluatePersonaAdoption({...input,review:{...input.review,candidate:{...input.review.candidate,version:3}}}),'candidate-stale');
  held(evaluatePersonaAdoption({...input,scope:{kind:'conversation',agentId:input.scope.agentId,route:'another-scope'}}),'scope-mismatch');
});

test('interest, preference and habit use the same original motivation rule as maintenance',()=>{
  for(const kind of ['interest','preference','habit'] as const){
    for(const motivation of ['explicit-task','mixed','maintenance','unknown'] as const)
      held(evaluatePersonaAdoption(fixture({kind,motivation})),'motivation-mismatch');
    for(const motivation of ['self-exploration','conversation-invitation'] as const)
      assert.equal(evaluatePersonaAdoption(fixture({kind,motivation})).eligibility,'allowed');
  }
  const input=fixture();held(evaluatePersonaAdoption({...input,review:{...input.review,motivation:{kind:'self-exploration',basis:['model renamed the task']}}}),'motivation-mismatch');
});

test('synthetic, partial or unknown evidence needs explicit limitations even for tentative adoption',()=>{
  for(const nature of ['synthetic','hypothetical','self-report','derived','unknown'] as const){
    held(evaluatePersonaAdoption(fixture({nature,limitations:[]})),'coverage-insufficient');
    assert.equal(evaluatePersonaAdoption(fixture({nature})).eligibility,'allowed');
  }
});

test('missing or conflicting metadata is never treated as verified complete evidence',()=>{
  const input=fixture(),support=input.candidate.supports[0];assert.ok(support);
  held(evaluatePersonaAdoption({...input,sourceEvidence:input.sourceEvidence.filter(value=>value.source.id!==support.id)}),'coverage-insufficient');
  const descriptor=input.sourceEvidence.find(value=>value.source.id===support.id);assert.ok(descriptor);
  held(evaluatePersonaAdoption({...input,sourceEvidence:[...input.sourceEvidence,{...descriptor,nature:'observed'}]}),'coverage-insufficient');
  const counter=input.sourceEvidence[2];assert.ok(counter);
  held(evaluatePersonaAdoption({...input,sourceEvidence:[...input.sourceEvidence.slice(0,2),{...counter,roots:[{key:'single-original-root',nature:'unknown'}]}]}),'coverage-insufficient');
});

test('known counter-evidence cannot disappear from the adoption review',()=>{
  const input=fixture({counter:'found'});
  held(evaluatePersonaAdoption({...input,review:{...input.review,counters:[],counterCheck:{status:'unknown',reason:'dropped an existing counter'}}}),'counter-evidence-unresolved');
});

test('not-obtained and unknown counters may support limited tentative views but cannot establish maturity',()=>{
  for(const counter of ['not-obtained','unknown'] as const){
    assert.equal(evaluatePersonaAdoption(fixture({counter})).eligibility,'allowed');
    held(evaluatePersonaAdoption(fixture({counter,nature:'observed',completeness:'complete',maturity:'established'})),'counter-evidence-unresolved');
  }
});

test('a single observed root can support established bounded value application with found or checked-none evidence',()=>{
  for(const counter of ['found','checked-none'] as const){
    const input=fixture({counter,nature:'observed',completeness:'complete',maturity:'established',limitations:[]});
    assert.equal(new Set(input.sourceEvidence.flatMap(value=>value.roots.map(root=>root.key))).size,1);
    assert.deepEqual(evaluatePersonaAdoption(input),{eligibility:'allowed',reasons:[]});
    assert.deepEqual(evaluatePersonaAdoption({...input,sourceEvidence:[...input.sourceEvidence,...input.sourceEvidence]}),evaluatePersonaAdoption(input));
  }
});

test('checked-none cannot establish maturity with missing, self-reported or incomplete checking evidence',()=>{
  const input=mature();assert.equal(input.review.counterCheck.status,'checked-none');
  if(input.review.counterCheck.status!=='checked-none')throw new Error('fixture requires checked-none');
  const checked=input.review.counterCheck.checkedSources[0];assert.ok(checked);
  held(evaluatePersonaAdoption({...input,review:{...input.review,counterCheck:{...input.review.counterCheck,checkedSources:[]}}}),'counter-evidence-unresolved');
  for(const replacement of [{nature:'self-report' as const},{completeness:'partial' as const}]){
    const changed={...input,sourceEvidence:input.sourceEvidence.map(value=>value.source.id===checked.id?{...value,...replacement}:value)};
    held(evaluatePersonaAdoption(changed),'counter-evidence-unresolved');
  }
});

test('synthetic evidence and unknown result effects cannot be upgraded to established experience',()=>{
  held(evaluatePersonaAdoption(fixture({counter:'checked-none',maturity:'established'})),'maturity-unsupported');
  const input=mature(),{outcome}=firstTrial(input);
  const uncertain=PersonaTrialOutcomeSchema.parse({...outcome,operations:[{id:randomUUID(),action:'fixture_observe',status:'unknown',effects:'unknown',completeness:'unknown',outcomeHash:textHash('unknown result')}]});
  held(evaluatePersonaAdoption(replaceTrial(input,uncertain)),'coverage-insufficient');
  held(evaluatePersonaAdoption(replaceTrial(input,{...outcome,gaps:['unobserved result']})),'coverage-insufficient');
});

test('established habit and relationship require observed evidence linked to the trial outcome, not merely a prior statement',()=>{
  for(const kind of ['habit','relationship'] as const){
    const input=fixture({kind,motivation:'self-exploration',nature:'observed',completeness:'complete',maturity:'established',counter:'checked-none',limitations:[]});
    held(evaluatePersonaAdoption(input),'maturity-unsupported');
    const support=input.candidate.supports[0];assert.ok(support);
    const {outcome}=firstTrial(input);
    const linked=PersonaTrialOutcomeSchema.parse({...outcome,sources:[support]});
    assert.equal(evaluatePersonaAdoption(replaceTrial(input,linked)).eligibility,'allowed');
    assert.equal(linked.operations.length,0); // A legitimate observation need not be an external write.
  }
});

test('a retained failed trial does not erase a valid tentative choice or become established success',()=>{
  const input=fixture({nature:'observed',completeness:'complete',counter:'checked-none',limitations:['One other trial failed and remains unresolved.']}),first=firstTrial(input);
  const runId=randomUUID(),admission=PersonaTrialAdmissionSchema.parse({...first.admission,id:randomUUID(),runId});
  const outcome=PersonaTrialOutcomeSchema.parse({...first.outcome,id:randomUUID(),runId,admission:{id:admission.id,hash:personaDigest(admission)},terminal:{state:'failed',result:null}});
  const combined:PersonaAdoptionPolicyInput={...input,trials:[first,{admission,outcome}],review:{...input.review,trialOutcomes:[...input.review.trialOutcomes,{id:outcome.id,hash:personaDigest(outcome)}]}};
  assert.equal(evaluatePersonaAdoption(combined).eligibility,'allowed');
  held(evaluatePersonaAdoption({...combined,review:{...combined.review,targetMaturity:'established'}}),'coverage-insufficient');
  assert.equal(combined.trials[1]?.outcome.terminal.state,'failed');
});

test('policy evaluation is deterministic and leaves all caller records unchanged',()=>{
  const input=fixture(),before=personaDigest(input);
  function freeze(value:unknown):void {if(value!==null&&typeof value==='object'){const children:readonly unknown[]=Object.values(value);for(const child of children)freeze(child);Object.freeze(value);}}
  freeze(input);const first=evaluatePersonaAdoption(input),second=evaluatePersonaAdoption(input);
  assert.deepEqual(first,second);assert.equal(personaDigest(input),before);assert.equal(Object.isFrozen(first),true);assert.equal(Object.isFrozen(first.reasons),true);
  assert.match(PERSONA_ADOPTION_POLICY_VERSION,/^[a-f0-9]{64}$/);
});
