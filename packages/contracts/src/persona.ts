import { z } from 'zod';
import { ActionOutcomeSchema, ExecutionScopeSchema } from './execution.js';
import type { ExecutionView } from './execution.js';
import type { ExecutionInput } from './execution-ports.js';
import type { ContextItem } from './context.js';
import type { SourceDependency } from './compaction.js';
import { TaskMemoryAuthorizationSchema } from './task-memory.js';

const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.uuid(),version=z.number().int().positive();
export const PersonaRequestIdSchema=z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/);
export const PersonaRecordRefSchema=z.strictObject({id,hash});
export type PersonaRecordRef=z.infer<typeof PersonaRecordRefSchema>;
export const PersonaTrialAdmissionRefSchema=PersonaRecordRefSchema;
export type PersonaTrialAdmissionRef=z.infer<typeof PersonaTrialAdmissionRefSchema>;
export const PersonaTrialOutcomeRefSchema=PersonaRecordRefSchema;
export type PersonaTrialOutcomeRef=z.infer<typeof PersonaTrialOutcomeRefSchema>;
export const PersonaAdoptionReviewRefSchema=PersonaRecordRefSchema;
export type PersonaAdoptionReviewRef=z.infer<typeof PersonaAdoptionReviewRefSchema>;
export const PersonaAdoptionDecisionRefSchema=PersonaRecordRefSchema;
export type PersonaAdoptionDecisionRef=z.infer<typeof PersonaAdoptionDecisionRefSchema>;
export const PersonaMaturitySchema=z.enum(['tentative','established','legacy-unclassified']);
export type PersonaMaturity=z.infer<typeof PersonaMaturitySchema>;
export const PersonaNewMaturitySchema=z.enum(['tentative','established']);
export type PersonaNewMaturity=z.infer<typeof PersonaNewMaturitySchema>;
export const PersonaAdoptionClassificationSchema=z.discriminatedUnion('basis',[
  z.strictObject({basis:z.literal('legacy-unclassified'),maturity:z.literal('legacy-unclassified')}),
  z.strictObject({basis:z.literal('reviewed'),maturity:PersonaNewMaturitySchema,review:PersonaAdoptionReviewRefSchema,decision:PersonaAdoptionDecisionRefSchema}),
]);
export type PersonaAdoptionClassification=z.infer<typeof PersonaAdoptionClassificationSchema>;
const source={id,agentId:z.string().min(1).max(100),scopeKey:z.string().min(1).max(2000),version,contentHash:hash};
export const PersonaSourceRefSchema=z.discriminatedUnion('kind',[
  z.strictObject({...source,kind:z.literal('memory'),revision:version,authorization:TaskMemoryAuthorizationSchema.optional(),selectionId:id.optional(),
    range:z.strictObject({start:z.number().int().nonnegative(),end:z.number().int().positive()}).optional()}),
  z.strictObject({...source,kind:z.literal('execution-source')}),
]);
export type PersonaSourceRef=z.infer<typeof PersonaSourceRefSchema>;
/** Assigned by a trusted source producer/resolver, never inferred from a model's reason text. */
export const PersonaSourceNatureSchema=z.enum(['observed','synthetic','hypothetical','self-report','derived','unknown']);
export type PersonaSourceNature=z.infer<typeof PersonaSourceNatureSchema>;
export const PersonaSourceEvidenceSchema=z.strictObject({source:PersonaSourceRefSchema,nature:PersonaSourceNatureSchema,
  coverage:z.array(z.string().min(1).max(300)).max(32),completeness:z.enum(['complete','partial','unknown']),
  roots:z.array(z.strictObject({key:z.string().min(1).max(2200),nature:PersonaSourceNatureSchema})).max(64)})
  .refine(value=>new Set(value.roots.map(root=>root.key)).size===value.roots.length,'Duplicate source root');
export type PersonaSourceEvidence=z.infer<typeof PersonaSourceEvidenceSchema>;
export const MotivationSchema=z.strictObject({kind:z.enum(['explicit-task','self-exploration','conversation-invitation','maintenance','mixed','unknown']),
  basis:z.array(z.string().min(1).max(300)).max(16).default([])});
export type Motivation=z.infer<typeof MotivationSchema>;
export const PersonaKindSchema=z.enum(['interest','preference','view','habit','relationship','value-application']);
export const ExperienceBasisSchema=z.strictObject({id,sourceId:id,taskEpoch:version});
export const PersonaCandidateStateSchema=z.enum(['proposed','held','trial','adopted','rejected','withdrawn','dormant','superseded']);
export const PersonaEntryRefSchema=z.strictObject({id,version});
export type PersonaEntryRef=z.infer<typeof PersonaEntryRefSchema>;
export const PersonaProposalSchema=z.strictObject({requestId:PersonaRequestIdSchema,kind:PersonaKindSchema,contentRef:PersonaSourceRefSchema,
  supports:z.array(PersonaSourceRefSchema).max(32),counters:z.array(PersonaSourceRefSchema).max(32).default([]),
  applicability:z.string().trim().min(1).max(1000),reason:z.string().trim().min(1).max(1000),experienceBasis:z.array(ExperienceBasisSchema).max(8).optional()});
export const PersonaCandidateRevisionV1Schema=z.strictObject({schemaVersion:z.literal(1),id,agentId:z.string().min(1).max(100),version,state:PersonaCandidateStateSchema,
  kind:PersonaKindSchema,contentRef:PersonaSourceRefSchema,supports:z.array(PersonaSourceRefSchema).max(32),counters:z.array(PersonaSourceRefSchema).max(32),
  dependencies:z.array(PersonaSourceRefSchema).max(64),rootSources:z.array(z.string().min(1).max(2200)).max(64),
  scope:ExecutionScopeSchema,motivation:MotivationSchema,applicability:z.string().min(1).max(1000),reason:z.string().min(1).max(1000),
  runId:id,producer:z.string().min(1).max(100),createdAt:z.iso.datetime(),policyVersion:hash,experienceBasis:z.array(ExperienceBasisSchema).max(8).optional()});
/** New writers use v2; the v1 branch exists only for byte-preserving historical reads. */
export const PersonaCandidateRevisionV2Schema=PersonaCandidateRevisionV1Schema.extend({schemaVersion:z.literal(2),maturity:PersonaNewMaturitySchema,
  adoption:z.strictObject({review:PersonaAdoptionReviewRefSchema,decision:PersonaAdoptionDecisionRefSchema}).nullable()})
  .superRefine((value,context)=>{
    if(['proposed','held','trial','rejected'].includes(value.state)&&(value.maturity!=='tentative'||value.adoption!==null))context.addIssue({code:'custom',message:'Unadopted candidate must remain tentative without an adoption decision'});
    if(['adopted','dormant','superseded'].includes(value.state)&&value.adoption===null)context.addIssue({code:'custom',message:'Adopted candidate requires an adoption review and decision'});
    if(value.state==='withdrawn'&&value.adoption===null&&value.maturity!=='tentative')context.addIssue({code:'custom',message:'An unadopted withdrawal cannot establish maturity'});
  });
export const PersonaCandidateRevisionSchema=z.union([PersonaCandidateRevisionV1Schema,PersonaCandidateRevisionV2Schema]);
export type PersonaCandidateV1=z.infer<typeof PersonaCandidateRevisionV1Schema>;
export type PersonaCandidateV2=z.infer<typeof PersonaCandidateRevisionV2Schema>;
export type PersonaCandidate=z.infer<typeof PersonaCandidateRevisionSchema>;
export const PersonaStageSchema=z.strictObject({schemaVersion:z.literal(1),agentId:z.string().min(1).max(100),revision:z.number().int().nonnegative(),
  entries:z.array(PersonaEntryRefSchema).max(128),createdAt:z.iso.datetime(),policyVersion:hash});
export type PersonaStage=z.infer<typeof PersonaStageSchema>;
export const PersonaManifestV1Schema=z.strictObject({schemaVersion:z.literal(1),agentId:z.string().min(1).max(100),runId:id,
  foundationHash:hash,foundationIdentity:hash,stageRevision:z.number().int().nonnegative(),selectionVersion:z.number().int().nonnegative(),
  stageStatus:z.enum(['not-configured','empty','selected','degraded']),omittedCandidates:z.number().int().nonnegative().optional(),
  entries:z.array(z.strictObject({candidate:PersonaEntryRefSchema,contentRef:PersonaSourceRefSchema,dependencies:z.array(PersonaSourceRefSchema).max(64)})).max(64),
  continuityCheckpointId:id.nullable(),policyVersion:hash,modelRouteHash:hash,assemblyVersion:z.literal('1')});

export const PersonaTrialSelectionRefSchema=z.strictObject({agentId:z.string().min(1).max(100),scopeKey:z.string().min(1).max(2000),version,hash});
export type PersonaTrialSelectionRef=z.infer<typeof PersonaTrialSelectionRefSchema>;
export const PersonaTrialSelectionEntrySchema=z.strictObject({candidate:PersonaEntryRefSchema,applicability:z.string().trim().min(1).max(1000),
  exitConditions:z.array(z.string().trim().min(1).max(1000)).min(1).max(16)});
export type PersonaTrialSelectionEntry=z.infer<typeof PersonaTrialSelectionEntrySchema>;
const trialEntries=z.array(PersonaTrialSelectionEntrySchema).max(32)
  .refine(entries=>new Set(entries.map(entry=>entry.candidate.id)).size===entries.length,'Duplicate trial candidate');
export const PersonaTrialSelectInputSchema=z.strictObject({requestId:PersonaRequestIdSchema,expectedSelectionVersion:z.number().int().nonnegative(),entries:trialEntries});
export type PersonaTrialSelectInput=z.infer<typeof PersonaTrialSelectInputSchema>;
export const PersonaTrialSelectionSchema=z.strictObject({schemaVersion:z.literal(1),agentId:z.string().min(1).max(100),scope:ExecutionScopeSchema,
  version,entries:trialEntries,runId:id,producer:z.string().min(1).max(100),createdAt:z.iso.datetime({offset:true}),policyVersion:hash});
export type PersonaTrialSelection=z.infer<typeof PersonaTrialSelectionSchema>;

export const PersonaTrialAdmissionEntrySchema=z.strictObject({candidate:PersonaEntryRefSchema,selection:PersonaTrialSelectionRefSchema,
  contentRef:PersonaSourceRefSchema,dependencies:z.array(PersonaSourceRefSchema).max(64),projectionHash:hash,
  sourceEvidence:z.array(PersonaSourceEvidenceSchema).max(64)});
export type PersonaTrialAdmissionEntry=z.infer<typeof PersonaTrialAdmissionEntrySchema>;
const trialAdmissionFields={schemaVersion:z.literal(1),agentId:z.string().min(1).max(100),scope:ExecutionScopeSchema,runId:id,
  manifestHash:hash,trialSelectionVersion:version,admittedAt:z.iso.datetime({offset:true})};
/** Plain data alone carries no authority: core must authenticate the callback and input fingerprint. */
export const PersonaTrialAdmissionInputSchema=z.strictObject({...trialAdmissionFields,entries:z.array(PersonaTrialAdmissionEntrySchema).min(1).max(32)})
  .refine(value=>new Set(value.entries.map(entry=>entry.candidate.id)).size===value.entries.length,'Duplicate admitted candidate');
export type PersonaTrialAdmissionInput=z.infer<typeof PersonaTrialAdmissionInputSchema>;
export const PersonaTrialAdmissionSchema=z.strictObject({...trialAdmissionFields,...PersonaTrialAdmissionEntrySchema.shape,id,policyVersion:hash});
export type PersonaTrialAdmission=z.infer<typeof PersonaTrialAdmissionSchema>;
export const PersonaTrialVisibleResultSchema=z.strictObject({sessionId:z.string().min(1).max(300),messageSeq:z.number().int().nonnegative(),
  turnEndSeq:z.number().int().nonnegative(),textHash:hash}).refine(value=>value.turnEndSeq>=value.messageSeq,'Result must end after its visible message');
export type PersonaTrialVisibleResult=z.infer<typeof PersonaTrialVisibleResultSchema>;
export const PersonaTrialTerminalSchema=z.discriminatedUnion('state',[
  z.strictObject({state:z.literal('completed'),result:PersonaTrialVisibleResultSchema}),
  z.strictObject({state:z.enum(['failed','cancelled','interrupted']),result:z.null()}),
]);
export type PersonaTrialTerminal=z.infer<typeof PersonaTrialTerminalSchema>;
export const PersonaTrialOperationSchema=ActionOutcomeSchema.pick({status:true,effects:true,completeness:true}).extend({id,
  action:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),outcomeHash:hash});
export type PersonaTrialOperation=z.infer<typeof PersonaTrialOperationSchema>;
const trialCompletionFields={schemaVersion:z.literal(1),agentId:z.string().min(1).max(100),scope:ExecutionScopeSchema,runId:id,
  terminal:PersonaTrialTerminalSchema,closedAt:z.iso.datetime({offset:true}),closedEventId:id,
  operations:z.array(PersonaTrialOperationSchema).max(1000),sources:z.array(PersonaSourceRefSchema).max(64),
  sourceEvidence:z.array(PersonaSourceEvidenceSchema).max(64),gaps:z.array(z.string().min(1).max(1000)).max(32)};
/** A closed Run is an observed result, not proof of business success or permission to adopt. */
export const PersonaTrialCompletionInputSchema=z.strictObject(trialCompletionFields);
export type PersonaTrialCompletionInput=z.infer<typeof PersonaTrialCompletionInputSchema>;
export const PersonaTrialOutcomeSchema=z.strictObject({...trialCompletionFields,id,admission:PersonaTrialAdmissionRefSchema,
  candidate:PersonaEntryRefSchema,selection:PersonaTrialSelectionRefSchema,policyVersion:hash});
export type PersonaTrialOutcome=z.infer<typeof PersonaTrialOutcomeSchema>;

export const PersonaCounterCheckSchema=z.discriminatedUnion('status',[
  z.strictObject({status:z.literal('found'),reason:z.string().trim().min(1).max(1000)}),
  z.strictObject({status:z.enum(['not-obtained','unknown']),reason:z.string().trim().min(1).max(1000)}),
  z.strictObject({status:z.literal('checked-none'),checkedSources:z.array(PersonaSourceRefSchema).min(1).max(32),reason:z.string().trim().min(1).max(1000)}),
]);
export type PersonaCounterCheck=z.infer<typeof PersonaCounterCheckSchema>;
/** Model-facing source keys are resolved to exact references before a counter check is stored. */
export const PersonaCounterCheckInputSchema=z.discriminatedUnion('status',[
  z.strictObject({status:z.literal('found'),reason:z.string().trim().min(1).max(1000)}),
  z.strictObject({status:z.enum(['not-obtained','unknown']),reason:z.string().trim().min(1).max(1000)}),
  z.strictObject({status:z.literal('checked-none'),checkedSources:z.array(z.string().min(1).max(300)).min(1).max(32),reason:z.string().trim().min(1).max(1000)}),
]);
export type PersonaCounterCheckInput=z.infer<typeof PersonaCounterCheckInputSchema>;
const adoptionReviewFields={candidate:PersonaEntryRefSchema,trialOutcomes:z.array(PersonaTrialOutcomeRefSchema).min(1).max(16),
  counterCheck:PersonaCounterCheckSchema,conclusionScope:z.string().trim().min(1).max(1000),targetMaturity:PersonaNewMaturitySchema,
  limitations:z.array(z.string().trim().min(1).max(1000)).max(32),reason:z.string().trim().min(1).max(2000)};
export const PersonaAdoptionReviewInputSchema=z.strictObject({...adoptionReviewFields,counterCheck:PersonaCounterCheckInputSchema,requestId:PersonaRequestIdSchema,
  supports:z.array(z.string().min(1).max(300)).max(32),counters:z.array(z.string().min(1).max(300)).max(32)})
  .refine(value=>value.counterCheck.status!=='found'||value.counters.length>0,'Found counter-evidence requires references');
export type PersonaAdoptionReviewInput=z.infer<typeof PersonaAdoptionReviewInputSchema>;
export const PersonaAdoptionReviewSchema=z.strictObject({...adoptionReviewFields,schemaVersion:z.literal(1),id,
  agentId:z.string().min(1).max(100),scope:ExecutionScopeSchema,runId:id,producer:z.string().min(1).max(100),
  createdAt:z.iso.datetime({offset:true}),policyVersion:hash,motivation:MotivationSchema,
  supports:z.array(PersonaSourceRefSchema).max(32),counters:z.array(PersonaSourceRefSchema).max(32),
  dependencies:z.array(PersonaSourceRefSchema).max(64),sourceEvidence:z.array(PersonaSourceEvidenceSchema).max(64)})
  .refine(value=>value.counterCheck.status!=='found'||value.counters.length>0,'Found counter-evidence requires references');
export type PersonaAdoptionReview=z.infer<typeof PersonaAdoptionReviewSchema>;
export const PersonaAdoptionReasonCodeSchema=z.enum(['trial-evidence-missing','trial-not-closed','trial-not-used','source-stale','scope-mismatch',
  'candidate-stale','counter-evidence-unresolved','coverage-insufficient','motivation-mismatch','maturity-unsupported','review-required']);
export type PersonaAdoptionReasonCode=z.infer<typeof PersonaAdoptionReasonCodeSchema>;
export const PersonaAdoptionDecisionSchema=z.strictObject({schemaVersion:z.literal(1),id,review:PersonaAdoptionReviewRefSchema,candidate:PersonaEntryRefSchema,
  agentId:z.string().min(1).max(100),scope:ExecutionScopeSchema,policyVersion:hash,checkedAt:z.iso.datetime({offset:true}),eligibility:z.enum(['allowed','held']),
  reasons:z.array(PersonaAdoptionReasonCodeSchema).max(32),dependencyHash:hash,stageRevision:z.number().int().nonnegative(),
  selectionVersion:z.number().int().nonnegative(),trialSelectionVersion:z.number().int().nonnegative(),targetMaturity:PersonaNewMaturitySchema})
  .refine(value=>value.eligibility!=='held'||value.reasons.length>0,'Held adoption requires a reason');
export type PersonaAdoptionDecision=z.infer<typeof PersonaAdoptionDecisionSchema>;
/** Optional review is legacy command compatibility only; a new successful write must require it. */
export const PersonaPublishInputSchema=z.strictObject({requestId:PersonaRequestIdSchema,expectedStageVersion:z.number().int().nonnegative(),
  entries:z.array(PersonaEntryRefSchema.extend({review:PersonaAdoptionReviewRefSchema.optional()})).min(1).max(32)})
  .refine(value=>new Set(value.entries.map(entry=>entry.id)).size===value.entries.length,'Duplicate published candidate');
export type PersonaPublishInput=z.infer<typeof PersonaPublishInputSchema>;

export const PersonaManifestV2Schema=PersonaManifestV1Schema.extend({schemaVersion:z.literal(2),assemblyVersion:z.literal('2'),
  entries:z.array(z.strictObject({candidate:PersonaEntryRefSchema,contentRef:PersonaSourceRefSchema,
    dependencies:z.array(PersonaSourceRefSchema).max(64),adoption:PersonaAdoptionClassificationSchema})).max(64),
  trialSelectionVersion:z.number().int().nonnegative(),trialEntries:z.array(z.strictObject({projection:z.literal('trial'),maturity:z.literal('tentative'),
    candidate:PersonaEntryRefSchema,contentRef:PersonaSourceRefSchema,dependencies:z.array(PersonaSourceRefSchema).max(64),
    trialSelection:PersonaTrialSelectionRefSchema,projectionHash:hash})).max(32),omittedTrials:z.number().int().nonnegative()});
export const PersonaManifestSchema=z.discriminatedUnion('schemaVersion',[PersonaManifestV1Schema,PersonaManifestV2Schema]);
export type PersonaManifestV1=z.infer<typeof PersonaManifestV1Schema>;
export type PersonaManifestV2=z.infer<typeof PersonaManifestV2Schema>;
export type PersonaManifest=z.infer<typeof PersonaManifestSchema>;
export const ContinuityCheckpointSchema=z.strictObject({schemaVersion:z.literal(1),id,agentId:z.string().min(1).max(100),runId:id,taskId:id,taskEpoch:version,
  scope:ExecutionScopeSchema,foundationHash:hash,stageRevision:z.number().int().nonnegative(),sessionId:z.string().min(1).max(300),throughSeq:z.number().int().nonnegative(),
  dependencies:z.array(PersonaSourceRefSchema).max(64),completedOperations:z.array(id).max(1000),unknownOperations:z.array(id).max(1000),
  historyHash:hash.optional(),intentEvents:z.array(id).max(1000).optional(),
  summary:z.string().max(8000),gaps:z.array(z.string().min(1).max(1000)).max(32),createdAt:z.iso.datetime()})
  .refine(value=>value.scope.kind==='task'&&value.scope.agentId===value.agentId&&value.scope.taskId===value.taskId,'Checkpoint scope mismatch');
export type ContinuityCheckpoint=z.infer<typeof ContinuityCheckpointSchema>;
export const TaskIntentEventSchema=z.strictObject({schemaVersion:z.literal(1),id,agentId:z.string().min(1).max(100),taskId:id,taskEpoch:version,runId:id,
  requestId:PersonaRequestIdSchema,producer:z.string().min(1).max(100),kind:z.enum(['accepted','objection','resolved']),motivation:MotivationSchema,
  category:z.enum(['preference','method','premise','missing-information','scope','none']),blocking:z.boolean(),reason:z.string().min(1).max(1000),
  actions:z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(32).optional(),
  historyHash:hash.optional(),
  evidence:z.array(PersonaSourceRefSchema).max(32),resolves:id.nullable(),createdAt:z.iso.datetime()});
export type TaskIntentEvent=z.infer<typeof TaskIntentEventSchema>;

/** Native service access is issued by core; serializing this value conveys no authority. */
export interface PersonaAccess {
  readonly view:ExecutionView;readonly producer:string;readonly operationId:string;readonly startedEventId:string|null;
  readonly intentVersion:number;readonly motivation:Motivation;readonly inputs:readonly ExecutionInput[];
  readonly admittedSources:readonly PersonaSourceRef[];readonly guard:()=>void;readonly commitGuard?:()=>void;
  readonly sourceRules?:readonly string[];
  readonly historyDependencies?:readonly SourceDependency[];
  readonly historyTracked?:boolean;
  readonly validateHistory?:(dependencies:readonly SourceDependency[])=>boolean;
  readonly operationFinished?:(id:string)=>boolean;
  readonly verifyMemorySource?:(ref:PersonaSourceRef)=>{text:string;rootSources:readonly string[]}|null;
  readonly resourceAllowed?:(scene:import('./conversation.js').Conversation)=>boolean;
}
export interface PreparedPersonaEntry {
  readonly candidate:z.infer<typeof PersonaEntryRefSchema>;readonly contentRef:PersonaSourceRef;readonly dependencies:readonly PersonaSourceRef[];
  readonly item:ContextItem;
  readonly adoption?:PersonaAdoptionClassification;
}
export interface PreparedPersonaTrialEntry {
  readonly projection:'trial';readonly maturity:'tentative';readonly trialSelection:PersonaTrialSelectionRef;
  readonly candidate:PersonaEntryRef;readonly contentRef:PersonaSourceRef;readonly dependencies:readonly PersonaSourceRef[];
  readonly item:ContextItem;readonly exitConditions:readonly string[];readonly sourceEvidence:readonly PersonaSourceEvidence[];
}
export interface PreparedPersona {readonly stageRevision:number;readonly selectionVersion:number;readonly entries:readonly PreparedPersonaEntry[];readonly omitted:number;
  readonly trialEntries?:readonly PreparedPersonaTrialEntry[];readonly trialSelectionVersion?:number;readonly omittedTrials?:number}
/** Core authenticates this live callback object and the exact plain input before memory may use it. */
export interface PersonaTrialAuthority {readonly guard:()=>void}
/** Memory & Growth owns mutable personality, preferences and relationships.
 * Core consumes scoped projections and reports actual use; it owns no second state store. */
export interface MemoryGrowthProvider {
  ready():boolean;
  /** Durable channel expression preferences, separately scoped from adopted personality traits. */
  expressionPreferences?(conversation:import('./conversation.js').Conversation):readonly import('./context.js').ContextItem[];
  prepare(access:PersonaAccess):PreparedPersona;
  validate(access:PersonaAccess,entry:PreparedPersonaEntry):boolean;
  validateHistoricalTrial?(access:PersonaAccess,dependency:Extract<SourceDependency,{kind:'context'}>):boolean;
  trialAdmitted?(input:PersonaTrialAdmissionInput,authority:PersonaTrialAuthority):readonly PersonaTrialAdmissionRef[];
  completeTrial?(input:PersonaTrialCompletionInput,authority:PersonaTrialAuthority):readonly PersonaTrialOutcomeRef[];
}
/** @deprecated Use MemoryGrowthProvider. Kept for existing extensions. */
export type PersonaProvider = MemoryGrowthProvider;
