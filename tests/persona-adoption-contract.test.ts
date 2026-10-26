import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  PersonaAdoptionClassificationSchema, PersonaAdoptionDecisionSchema, PersonaAdoptionReviewInputSchema,
  PersonaCandidateRevisionSchema, PersonaCandidateRevisionV1Schema, PersonaCandidateRevisionV2Schema, PersonaCounterCheckInputSchema, PersonaCounterCheckSchema,
  PersonaManifestSchema, PersonaManifestV1Schema, PersonaPublishInputSchema, PersonaSourceEvidenceSchema,
  PersonaSourceRefSchema, PersonaTrialAdmissionInputSchema, PersonaTrialCompletionInputSchema,
  PersonaTrialSelectInputSchema, taskScopeKey,
} from '@dafeiyu/contracts';

const hash = 'a'.repeat(64), at = '2026-10-26T12:00:00.000Z';
const agentId = 'fixture', taskId = randomUUID(), runId = randomUUID();
const scope = {kind:'task' as const, agentId, taskId, scopeKey:taskScopeKey(agentId,taskId)};
const source = PersonaSourceRefSchema.parse({kind:'execution-source',id:randomUUID(),agentId,scopeKey:scope.scopeKey,version:1,contentHash:hash});
const candidate = {id:randomUUID(),version:2};
const ref = {id:randomUUID(),hash};
const selection = {agentId,scopeKey:scope.scopeKey,version:1,hash};
const evidence = PersonaSourceEvidenceSchema.parse({source,nature:'synthetic',coverage:['fictional-text-only'],completeness:'partial',roots:[{key:'fixture-root',nature:'synthetic'}]});
const legacy = PersonaCandidateRevisionV1Schema.parse({schemaVersion:1,id:candidate.id,agentId,version:2,state:'adopted',kind:'value-application',
  contentRef:source,supports:[source],counters:[],dependencies:[source],rootSources:['fixture-root'],scope,
  motivation:{kind:'explicit-task',basis:['fixture']},applicability:'fictional case only',reason:'legacy evidence retained',runId,producer:'fixture',createdAt:at,policyVersion:hash});

test('legacy candidate and manifest reads do not add adoption evidence or maturity defaults',()=>{
  const raw=JSON.stringify(legacy), parsed=PersonaCandidateRevisionSchema.parse(JSON.parse(raw));
  assert.deepEqual(parsed,legacy);assert.equal('maturity' in parsed,false);assert.equal('adoption' in parsed,false);
  const manifest=PersonaManifestV1Schema.parse({schemaVersion:1,agentId,runId,foundationHash:hash,foundationIdentity:hash,stageRevision:1,
    selectionVersion:1,stageStatus:'selected',entries:[{candidate,contentRef:source,dependencies:[source]}],continuityCheckpointId:null,
    policyVersion:hash,modelRouteHash:hash,assemblyVersion:'1'});
  assert.deepEqual(PersonaManifestSchema.parse(manifest),manifest);assert.equal('trialEntries' in PersonaManifestSchema.parse(manifest),false);
  assert.deepEqual(PersonaAdoptionClassificationSchema.parse({basis:'legacy-unclassified',maturity:'legacy-unclassified'}),
    {basis:'legacy-unclassified',maturity:'legacy-unclassified'});
});

test('new candidate revisions separate adoption evidence from tentative or established maturity',()=>{
  const base={...legacy,schemaVersion:2,maturity:'tentative',adoption:null};
  assert.equal(PersonaCandidateRevisionV2Schema.safeParse(base).success,false);
  assert.equal(PersonaCandidateRevisionV2Schema.safeParse({...base,state:'trial'}).success,true);
  assert.equal(PersonaCandidateRevisionV2Schema.safeParse({...base,state:'trial',maturity:'established'}).success,false);
  assert.equal(PersonaCandidateRevisionV2Schema.safeParse({...base,adoption:{review:ref,decision:{...ref,id:randomUUID()}}}).success,true);
  assert.equal(PersonaCandidateRevisionV2Schema.safeParse({...base,maturity:'legacy-unclassified',adoption:{review:ref,decision:ref}}).success,false);
  assert.equal(PersonaCandidateRevisionV2Schema.safeParse({...base,state:'withdrawn',maturity:'established'}).success,false);
});

test('model command schemas reject caller-supplied identity, outcomes and scores',()=>{
  const trial={requestId:'trial',expectedSelectionVersion:0,entries:[{candidate,applicability:'fictional case',exitConditions:['withdraw when contradicted']}]};
  assert.equal(PersonaTrialSelectInputSchema.safeParse(trial).success,true);
  for(const extra of [{agentId:'forged'},{scope},{runId},{maturity:'established'},{quality:1},{outcome:{effects:'confirmed'}}])
    assert.equal(PersonaTrialSelectInputSchema.safeParse({...trial,...extra}).success,false);
  const review={requestId:'review',candidate,trialOutcomes:[ref],supports:[`execution-source:${source.id}`],counters:[],
    counterCheck:{status:'unknown',reason:'no counter-observation available'},conclusionScope:'fictional scenario only',targetMaturity:'tentative',limitations:['text only'],reason:'evaluate the visible choice'};
  assert.equal(PersonaAdoptionReviewInputSchema.safeParse(review).success,true);
  for(const extra of [{producer:'core'},{motivation:{kind:'self-exploration',basis:[]}},{actualResult:'succeeded'},{score:99},{sourceEvidence:[evidence]}])
    assert.equal(PersonaAdoptionReviewInputSchema.safeParse({...review,...extra}).success,false);
  assert.equal(PersonaAdoptionReviewInputSchema.safeParse({...review,counterCheck:{status:'found',reason:'found a counterexample'}}).success,false);
});

test('source metadata preserves synthetic coverage and disallows duplicate roots',()=>{
  assert.equal(evidence.nature,'synthetic');assert.equal(evidence.completeness,'partial');
  assert.equal(PersonaSourceEvidenceSchema.safeParse({...evidence,roots:[evidence.roots[0],evidence.roots[0]]}).success,false);
  assert.equal(PersonaSourceEvidenceSchema.safeParse({...evidence,confidence:0.99}).success,false);
});

test('checked-none counter checks separate model source keys from stored exact evidence',()=>{
  const input={status:'checked-none',checkedSources:[`execution-source:${source.id}`],reason:'The examined source contains no counterexample within its coverage'};
  assert.equal(PersonaCounterCheckInputSchema.safeParse(input).success,true);
  assert.equal(PersonaCounterCheckSchema.safeParse(input).success,false);
  const stored={...input,checkedSources:[source]};
  assert.equal(PersonaCounterCheckSchema.safeParse(stored).success,true);
  assert.equal(PersonaCounterCheckInputSchema.safeParse(stored).success,false);
  assert.equal(PersonaCounterCheckInputSchema.safeParse({...input,checkedSources:[]}).success,false);
  assert.equal(PersonaCounterCheckSchema.safeParse({...stored,checkedSources:[]}).success,false);
  assert.equal(PersonaCounterCheckSchema.safeParse({status:'unknown',checkedSources:[source],reason:'not yet checked'}).success,false);
});

test('trusted lifecycle payload shapes require admitted metadata and an ended visible result',()=>{
  const entry={candidate,selection,contentRef:source,dependencies:[source],projectionHash:hash,sourceEvidence:[evidence]};
  const admission={schemaVersion:1,agentId,scope,runId,manifestHash:hash,trialSelectionVersion:1,admittedAt:at,entries:[entry]};
  assert.equal(PersonaTrialAdmissionInputSchema.safeParse(admission).success,true);
  assert.equal(PersonaTrialAdmissionInputSchema.safeParse({...admission,entries:[{candidate,selection,contentRef:source,dependencies:[source],projectionHash:hash}]}).success,false);
  assert.equal(PersonaTrialAdmissionInputSchema.safeParse({...admission,entries:[entry,entry]}).success,false);
  const completion={schemaVersion:1,agentId,scope,runId,closedAt:at,closedEventId:randomUUID(),operations:[],sources:[],sourceEvidence:[],gaps:[],
    terminal:{state:'completed',result:{sessionId:'visible-session',messageSeq:8,turnEndSeq:10,textHash:hash}}};
  assert.equal(PersonaTrialCompletionInputSchema.safeParse(completion).success,true);
  assert.equal(PersonaTrialCompletionInputSchema.safeParse({...completion,terminal:{state:'running',result:null}}).success,false);
  assert.equal(PersonaTrialCompletionInputSchema.safeParse({...completion,terminal:{state:'completed',result:null}}).success,false);
  assert.equal(PersonaTrialCompletionInputSchema.safeParse({...completion,terminal:{state:'cancelled',result:null}}).success,true);
  assert.equal(PersonaTrialCompletionInputSchema.safeParse({...completion,terminal:{state:'completed',result:{...completion.terminal.result,turnEndSeq:7}}}).success,false);
  // Parsing is not authorization; core identity and fingerprint checks belong to lifecycle integration tests.
});

test('v2 manifests keep trial entries out of adopted entries and mark them tentative',()=>{
  const value={schemaVersion:2,agentId,runId,foundationHash:hash,foundationIdentity:hash,stageRevision:0,selectionVersion:0,stageStatus:'selected',
    entries:[],continuityCheckpointId:null,policyVersion:hash,modelRouteHash:hash,assemblyVersion:'2',trialSelectionVersion:1,omittedTrials:0,
    trialEntries:[{projection:'trial',maturity:'tentative',candidate,contentRef:source,dependencies:[source],trialSelection:selection,projectionHash:hash}]};
  const parsed=PersonaManifestSchema.parse(value);assert.equal(parsed.schemaVersion,2);assert.equal(parsed.entries.length,0);
  assert.equal(PersonaManifestSchema.safeParse({...value,trialEntries:[{...value.trialEntries[0],maturity:'established'}]}).success,false);
  assert.equal(PersonaManifestSchema.safeParse({...value,entries:[{candidate,contentRef:source,dependencies:[source]}]}).success,false);
});

test('legacy publish shapes remain parsable without granting a new adoption and held decisions need reasons',()=>{
  const oldCommand=PersonaPublishInputSchema.parse({requestId:'legacy',expectedStageVersion:0,entries:[candidate]});
  assert.equal(oldCommand.entries[0]?.review,undefined); // Store must return PERSONA_ADOPTION_REVIEW_REQUIRED for a new write.
  const decision={schemaVersion:1,id:randomUUID(),review:ref,candidate,agentId,scope,policyVersion:hash,checkedAt:at,eligibility:'held',reasons:[],
    dependencyHash:hash,stageRevision:0,selectionVersion:0,trialSelectionVersion:1,targetMaturity:'tentative'};
  assert.equal(PersonaAdoptionDecisionSchema.safeParse(decision).success,false);
  assert.equal(PersonaAdoptionDecisionSchema.safeParse({...decision,reasons:['trial-evidence-missing']}).success,true);
  assert.equal(PersonaAdoptionDecisionSchema.safeParse({...decision,reasons:['quality-score-too-low']}).success,false);
});
