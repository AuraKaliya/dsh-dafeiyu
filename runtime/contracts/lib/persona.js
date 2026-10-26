import { z } from 'zod';
import { ActionOutcomeSchema, ExecutionScopeSchema } from './execution.js';
import { TaskMemoryAuthorizationSchema } from './task-memory.js';
const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.uuid(), version = z.number().int().positive();
export const PersonaRequestIdSchema = z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/);
export const PersonaRecordRefSchema = z.strictObject({ id, hash });
export const PersonaTrialAdmissionRefSchema = PersonaRecordRefSchema;
export const PersonaTrialOutcomeRefSchema = PersonaRecordRefSchema;
export const PersonaAdoptionReviewRefSchema = PersonaRecordRefSchema;
export const PersonaAdoptionDecisionRefSchema = PersonaRecordRefSchema;
export const PersonaMaturitySchema = z.enum(['tentative', 'established', 'legacy-unclassified']);
export const PersonaNewMaturitySchema = z.enum(['tentative', 'established']);
export const PersonaAdoptionClassificationSchema = z.discriminatedUnion('basis', [
    z.strictObject({ basis: z.literal('legacy-unclassified'), maturity: z.literal('legacy-unclassified') }),
    z.strictObject({ basis: z.literal('reviewed'), maturity: PersonaNewMaturitySchema, review: PersonaAdoptionReviewRefSchema, decision: PersonaAdoptionDecisionRefSchema }),
]);
const source = { id, agentId: z.string().min(1).max(100), scopeKey: z.string().min(1).max(2000), version, contentHash: hash };
export const PersonaSourceRefSchema = z.discriminatedUnion('kind', [
    z.strictObject({ ...source, kind: z.literal('memory'), revision: version, authorization: TaskMemoryAuthorizationSchema.optional(), selectionId: id.optional(),
        range: z.strictObject({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).optional() }),
    z.strictObject({ ...source, kind: z.literal('execution-source') }),
]);
/** Assigned by a trusted source producer/resolver, never inferred from a model's reason text. */
export const PersonaSourceNatureSchema = z.enum(['observed', 'synthetic', 'hypothetical', 'self-report', 'derived', 'unknown']);
export const PersonaSourceEvidenceSchema = z.strictObject({ source: PersonaSourceRefSchema, nature: PersonaSourceNatureSchema,
    coverage: z.array(z.string().min(1).max(300)).max(32), completeness: z.enum(['complete', 'partial', 'unknown']),
    roots: z.array(z.strictObject({ key: z.string().min(1).max(2200), nature: PersonaSourceNatureSchema })).max(64) })
    .refine(value => new Set(value.roots.map(root => root.key)).size === value.roots.length, 'Duplicate source root');
export const MotivationSchema = z.strictObject({ kind: z.enum(['explicit-task', 'self-exploration', 'conversation-invitation', 'maintenance', 'mixed', 'unknown']),
    basis: z.array(z.string().min(1).max(300)).max(16).default([]) });
export const PersonaKindSchema = z.enum(['interest', 'preference', 'view', 'habit', 'relationship', 'value-application']);
export const ExperienceBasisSchema = z.strictObject({ id, sourceId: id, taskEpoch: version });
export const PersonaCandidateStateSchema = z.enum(['proposed', 'held', 'trial', 'adopted', 'rejected', 'withdrawn', 'dormant', 'superseded']);
export const PersonaEntryRefSchema = z.strictObject({ id, version });
export const PersonaProposalSchema = z.strictObject({ requestId: PersonaRequestIdSchema, kind: PersonaKindSchema, contentRef: PersonaSourceRefSchema,
    supports: z.array(PersonaSourceRefSchema).max(32), counters: z.array(PersonaSourceRefSchema).max(32).default([]),
    applicability: z.string().trim().min(1).max(1000), reason: z.string().trim().min(1).max(1000), experienceBasis: z.array(ExperienceBasisSchema).max(8).optional() });
export const PersonaCandidateRevisionV1Schema = z.strictObject({ schemaVersion: z.literal(1), id, agentId: z.string().min(1).max(100), version, state: PersonaCandidateStateSchema,
    kind: PersonaKindSchema, contentRef: PersonaSourceRefSchema, supports: z.array(PersonaSourceRefSchema).max(32), counters: z.array(PersonaSourceRefSchema).max(32),
    dependencies: z.array(PersonaSourceRefSchema).max(64), rootSources: z.array(z.string().min(1).max(2200)).max(64),
    scope: ExecutionScopeSchema, motivation: MotivationSchema, applicability: z.string().min(1).max(1000), reason: z.string().min(1).max(1000),
    runId: id, producer: z.string().min(1).max(100), createdAt: z.iso.datetime(), policyVersion: hash, experienceBasis: z.array(ExperienceBasisSchema).max(8).optional() });
/** New writers use v2; the v1 branch exists only for byte-preserving historical reads. */
export const PersonaCandidateRevisionV2Schema = PersonaCandidateRevisionV1Schema.extend({ schemaVersion: z.literal(2), maturity: PersonaNewMaturitySchema,
    adoption: z.strictObject({ review: PersonaAdoptionReviewRefSchema, decision: PersonaAdoptionDecisionRefSchema }).nullable() })
    .superRefine((value, context) => {
    if (['proposed', 'held', 'trial', 'rejected'].includes(value.state) && (value.maturity !== 'tentative' || value.adoption !== null))
        context.addIssue({ code: 'custom', message: 'Unadopted candidate must remain tentative without an adoption decision' });
    if (['adopted', 'dormant', 'superseded'].includes(value.state) && value.adoption === null)
        context.addIssue({ code: 'custom', message: 'Adopted candidate requires an adoption review and decision' });
    if (value.state === 'withdrawn' && value.adoption === null && value.maturity !== 'tentative')
        context.addIssue({ code: 'custom', message: 'An unadopted withdrawal cannot establish maturity' });
});
export const PersonaCandidateRevisionSchema = z.union([PersonaCandidateRevisionV1Schema, PersonaCandidateRevisionV2Schema]);
export const PersonaStageSchema = z.strictObject({ schemaVersion: z.literal(1), agentId: z.string().min(1).max(100), revision: z.number().int().nonnegative(),
    entries: z.array(PersonaEntryRefSchema).max(128), createdAt: z.iso.datetime(), policyVersion: hash });
export const PersonaManifestV1Schema = z.strictObject({ schemaVersion: z.literal(1), agentId: z.string().min(1).max(100), runId: id,
    foundationHash: hash, foundationIdentity: hash, stageRevision: z.number().int().nonnegative(), selectionVersion: z.number().int().nonnegative(),
    stageStatus: z.enum(['not-configured', 'empty', 'selected', 'degraded']), omittedCandidates: z.number().int().nonnegative().optional(),
    entries: z.array(z.strictObject({ candidate: PersonaEntryRefSchema, contentRef: PersonaSourceRefSchema, dependencies: z.array(PersonaSourceRefSchema).max(64) })).max(64),
    continuityCheckpointId: id.nullable(), policyVersion: hash, modelRouteHash: hash, assemblyVersion: z.literal('1') });
export const PersonaTrialSelectionRefSchema = z.strictObject({ agentId: z.string().min(1).max(100), scopeKey: z.string().min(1).max(2000), version, hash });
export const PersonaTrialSelectionEntrySchema = z.strictObject({ candidate: PersonaEntryRefSchema, applicability: z.string().trim().min(1).max(1000),
    exitConditions: z.array(z.string().trim().min(1).max(1000)).min(1).max(16) });
const trialEntries = z.array(PersonaTrialSelectionEntrySchema).max(32)
    .refine(entries => new Set(entries.map(entry => entry.candidate.id)).size === entries.length, 'Duplicate trial candidate');
export const PersonaTrialSelectInputSchema = z.strictObject({ requestId: PersonaRequestIdSchema, expectedSelectionVersion: z.number().int().nonnegative(), entries: trialEntries });
export const PersonaTrialSelectionSchema = z.strictObject({ schemaVersion: z.literal(1), agentId: z.string().min(1).max(100), scope: ExecutionScopeSchema,
    version, entries: trialEntries, runId: id, producer: z.string().min(1).max(100), createdAt: z.iso.datetime({ offset: true }), policyVersion: hash });
export const PersonaTrialAdmissionEntrySchema = z.strictObject({ candidate: PersonaEntryRefSchema, selection: PersonaTrialSelectionRefSchema,
    contentRef: PersonaSourceRefSchema, dependencies: z.array(PersonaSourceRefSchema).max(64), projectionHash: hash,
    sourceEvidence: z.array(PersonaSourceEvidenceSchema).max(64) });
const trialAdmissionFields = { schemaVersion: z.literal(1), agentId: z.string().min(1).max(100), scope: ExecutionScopeSchema, runId: id,
    manifestHash: hash, trialSelectionVersion: version, admittedAt: z.iso.datetime({ offset: true }) };
/** Plain data alone carries no authority: core must authenticate the callback and input fingerprint. */
export const PersonaTrialAdmissionInputSchema = z.strictObject({ ...trialAdmissionFields, entries: z.array(PersonaTrialAdmissionEntrySchema).min(1).max(32) })
    .refine(value => new Set(value.entries.map(entry => entry.candidate.id)).size === value.entries.length, 'Duplicate admitted candidate');
export const PersonaTrialAdmissionSchema = z.strictObject({ ...trialAdmissionFields, ...PersonaTrialAdmissionEntrySchema.shape, id, policyVersion: hash });
export const PersonaTrialVisibleResultSchema = z.strictObject({ sessionId: z.string().min(1).max(300), messageSeq: z.number().int().nonnegative(),
    turnEndSeq: z.number().int().nonnegative(), textHash: hash }).refine(value => value.turnEndSeq >= value.messageSeq, 'Result must end after its visible message');
export const PersonaTrialTerminalSchema = z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('completed'), result: PersonaTrialVisibleResultSchema }),
    z.strictObject({ state: z.enum(['failed', 'cancelled', 'interrupted']), result: z.null() }),
]);
export const PersonaTrialOperationSchema = ActionOutcomeSchema.pick({ status: true, effects: true, completeness: true }).extend({ id,
    action: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), outcomeHash: hash });
const trialCompletionFields = { schemaVersion: z.literal(1), agentId: z.string().min(1).max(100), scope: ExecutionScopeSchema, runId: id,
    terminal: PersonaTrialTerminalSchema, closedAt: z.iso.datetime({ offset: true }), closedEventId: id,
    operations: z.array(PersonaTrialOperationSchema).max(1000), sources: z.array(PersonaSourceRefSchema).max(64),
    sourceEvidence: z.array(PersonaSourceEvidenceSchema).max(64), gaps: z.array(z.string().min(1).max(1000)).max(32) };
/** A closed Run is an observed result, not proof of business success or permission to adopt. */
export const PersonaTrialCompletionInputSchema = z.strictObject(trialCompletionFields);
export const PersonaTrialOutcomeSchema = z.strictObject({ ...trialCompletionFields, id, admission: PersonaTrialAdmissionRefSchema,
    candidate: PersonaEntryRefSchema, selection: PersonaTrialSelectionRefSchema, policyVersion: hash });
export const PersonaCounterCheckSchema = z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('found'), reason: z.string().trim().min(1).max(1000) }),
    z.strictObject({ status: z.enum(['not-obtained', 'unknown']), reason: z.string().trim().min(1).max(1000) }),
    z.strictObject({ status: z.literal('checked-none'), checkedSources: z.array(PersonaSourceRefSchema).min(1).max(32), reason: z.string().trim().min(1).max(1000) }),
]);
/** Model-facing source keys are resolved to exact references before a counter check is stored. */
export const PersonaCounterCheckInputSchema = z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('found'), reason: z.string().trim().min(1).max(1000) }),
    z.strictObject({ status: z.enum(['not-obtained', 'unknown']), reason: z.string().trim().min(1).max(1000) }),
    z.strictObject({ status: z.literal('checked-none'), checkedSources: z.array(z.string().min(1).max(300)).min(1).max(32), reason: z.string().trim().min(1).max(1000) }),
]);
const adoptionReviewFields = { candidate: PersonaEntryRefSchema, trialOutcomes: z.array(PersonaTrialOutcomeRefSchema).min(1).max(16),
    counterCheck: PersonaCounterCheckSchema, conclusionScope: z.string().trim().min(1).max(1000), targetMaturity: PersonaNewMaturitySchema,
    limitations: z.array(z.string().trim().min(1).max(1000)).max(32), reason: z.string().trim().min(1).max(2000) };
export const PersonaAdoptionReviewInputSchema = z.strictObject({ ...adoptionReviewFields, counterCheck: PersonaCounterCheckInputSchema, requestId: PersonaRequestIdSchema,
    supports: z.array(z.string().min(1).max(300)).max(32), counters: z.array(z.string().min(1).max(300)).max(32) })
    .refine(value => value.counterCheck.status !== 'found' || value.counters.length > 0, 'Found counter-evidence requires references');
export const PersonaAdoptionReviewSchema = z.strictObject({ ...adoptionReviewFields, schemaVersion: z.literal(1), id,
    agentId: z.string().min(1).max(100), scope: ExecutionScopeSchema, runId: id, producer: z.string().min(1).max(100),
    createdAt: z.iso.datetime({ offset: true }), policyVersion: hash, motivation: MotivationSchema,
    supports: z.array(PersonaSourceRefSchema).max(32), counters: z.array(PersonaSourceRefSchema).max(32),
    dependencies: z.array(PersonaSourceRefSchema).max(64), sourceEvidence: z.array(PersonaSourceEvidenceSchema).max(64) })
    .refine(value => value.counterCheck.status !== 'found' || value.counters.length > 0, 'Found counter-evidence requires references');
export const PersonaAdoptionReasonCodeSchema = z.enum(['trial-evidence-missing', 'trial-not-closed', 'trial-not-used', 'source-stale', 'scope-mismatch',
    'candidate-stale', 'counter-evidence-unresolved', 'coverage-insufficient', 'motivation-mismatch', 'maturity-unsupported', 'review-required']);
export const PersonaAdoptionDecisionSchema = z.strictObject({ schemaVersion: z.literal(1), id, review: PersonaAdoptionReviewRefSchema, candidate: PersonaEntryRefSchema,
    agentId: z.string().min(1).max(100), scope: ExecutionScopeSchema, policyVersion: hash, checkedAt: z.iso.datetime({ offset: true }), eligibility: z.enum(['allowed', 'held']),
    reasons: z.array(PersonaAdoptionReasonCodeSchema).max(32), dependencyHash: hash, stageRevision: z.number().int().nonnegative(),
    selectionVersion: z.number().int().nonnegative(), trialSelectionVersion: z.number().int().nonnegative(), targetMaturity: PersonaNewMaturitySchema })
    .refine(value => value.eligibility !== 'held' || value.reasons.length > 0, 'Held adoption requires a reason');
/** Optional review is legacy command compatibility only; a new successful write must require it. */
export const PersonaPublishInputSchema = z.strictObject({ requestId: PersonaRequestIdSchema, expectedStageVersion: z.number().int().nonnegative(),
    entries: z.array(PersonaEntryRefSchema.extend({ review: PersonaAdoptionReviewRefSchema.optional() })).min(1).max(32) })
    .refine(value => new Set(value.entries.map(entry => entry.id)).size === value.entries.length, 'Duplicate published candidate');
export const PersonaManifestV2Schema = PersonaManifestV1Schema.extend({ schemaVersion: z.literal(2), assemblyVersion: z.literal('2'),
    entries: z.array(z.strictObject({ candidate: PersonaEntryRefSchema, contentRef: PersonaSourceRefSchema,
        dependencies: z.array(PersonaSourceRefSchema).max(64), adoption: PersonaAdoptionClassificationSchema })).max(64),
    trialSelectionVersion: z.number().int().nonnegative(), trialEntries: z.array(z.strictObject({ projection: z.literal('trial'), maturity: z.literal('tentative'),
        candidate: PersonaEntryRefSchema, contentRef: PersonaSourceRefSchema, dependencies: z.array(PersonaSourceRefSchema).max(64),
        trialSelection: PersonaTrialSelectionRefSchema, projectionHash: hash })).max(32), omittedTrials: z.number().int().nonnegative() });
export const PersonaManifestSchema = z.discriminatedUnion('schemaVersion', [PersonaManifestV1Schema, PersonaManifestV2Schema]);
export const ContinuityCheckpointSchema = z.strictObject({ schemaVersion: z.literal(1), id, agentId: z.string().min(1).max(100), runId: id, taskId: id, taskEpoch: version,
    scope: ExecutionScopeSchema, foundationHash: hash, stageRevision: z.number().int().nonnegative(), sessionId: z.string().min(1).max(300), throughSeq: z.number().int().nonnegative(),
    dependencies: z.array(PersonaSourceRefSchema).max(64), completedOperations: z.array(id).max(1000), unknownOperations: z.array(id).max(1000),
    historyHash: hash.optional(), intentEvents: z.array(id).max(1000).optional(),
    summary: z.string().max(8000), gaps: z.array(z.string().min(1).max(1000)).max(32), createdAt: z.iso.datetime() })
    .refine(value => value.scope.kind === 'task' && value.scope.agentId === value.agentId && value.scope.taskId === value.taskId, 'Checkpoint scope mismatch');
export const TaskIntentEventSchema = z.strictObject({ schemaVersion: z.literal(1), id, agentId: z.string().min(1).max(100), taskId: id, taskEpoch: version, runId: id,
    requestId: PersonaRequestIdSchema, producer: z.string().min(1).max(100), kind: z.enum(['accepted', 'objection', 'resolved']), motivation: MotivationSchema,
    category: z.enum(['preference', 'method', 'premise', 'missing-information', 'scope', 'none']), blocking: z.boolean(), reason: z.string().min(1).max(1000),
    actions: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(32).optional(),
    historyHash: hash.optional(),
    evidence: z.array(PersonaSourceRefSchema).max(32), resolves: id.nullable(), createdAt: z.iso.datetime() });
