import { z } from 'zod';
import type { PersonaAccess, PersonaSourceRef, ContinuityCheckpoint } from './persona.js';
import type { ExecutionSourceRef } from './execution.js';
import type { ContextItem } from './context.js';
import type { CompactionProvider, SourceDependency } from './compaction.js';
export declare const ExecutionObservationSchema: z.ZodObject<{
    requestId: z.ZodString;
    occurredAt: z.ZodISODateTime;
    text: z.ZodString;
    kind: z.ZodEnum<{
        digest: "digest";
        primary: "primary";
    }>;
    completeness: z.ZodEnum<{
        unknown: "unknown";
        complete: "complete";
        partial: "partial";
    }>;
    resource: z.ZodString;
    coverage: z.ZodArray<z.ZodString>;
    dependencies: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>>;
    nature: z.ZodOptional<z.ZodEnum<{
        unknown: "unknown";
        observed: "observed";
        synthetic: "synthetic";
        hypothetical: "hypothetical";
        "self-report": "self-report";
        derived: "derived";
    }>>;
}, z.core.$strict>;
export declare const ExecutionContributionSchema: z.ZodObject<{
    requestId: z.ZodString;
    source: z.ZodUUID;
    version: z.ZodNumber;
    mode: z.ZodEnum<{
        original: "original";
        summary: "summary";
        excerpt: "excerpt";
    }>;
    start: z.ZodOptional<z.ZodNumber>;
    end: z.ZodOptional<z.ZodNumber>;
    text: z.ZodOptional<z.ZodString>;
    reason: z.ZodString;
}, z.core.$strict>;
export interface ExecutionMemoryPort {
    ready(): boolean;
    /** Optional durable consumer; core acknowledges its event only after this returns. */
    recordLifecycle?(event: import('./memory-maintenance.js').MaintenanceLifecycle): void;
    recordAssessment?(access: PersonaAccess, assessment: import('./task-assessment.js').TaskAssessment): PersonaSourceRef;
    resourceEpoch?(access: PersonaAccess): string;
    validate(access: PersonaAccess, ref: PersonaSourceRef): boolean;
    operationSources(access: PersonaAccess, operationId: string): readonly PersonaSourceRef[];
    outcomeSources(access: PersonaAccess, refs: readonly ExecutionSourceRef[]): readonly PersonaSourceRef[];
    prepareContext(access: PersonaAccess): readonly ContextItem[];
    validateContext(access: PersonaAccess, item: ContextItem): boolean;
    captureContinuity(access: PersonaAccess, checkpoint: ContinuityCheckpoint): {
        id: string;
        hash: string;
    };
    checkpoint(access: PersonaAccess, id: string, historical?: boolean): ContinuityCheckpoint | null;
    bindResult(taskId: string, runId: string, epoch: number, body: unknown): void;
    generation(access: PersonaAccess): number;
    acceptIntent(access: PersonaAccess): void;
    intent(access: PersonaAccess): {
        motivation: PersonaAccess['motivation'];
        blocking: boolean;
        events: readonly import('./persona.js').TaskIntentEvent[];
    };
    resolveIntent(access: PersonaAccess, input: unknown): unknown;
    readonly compactionPolicy?: CompactionProvider['policy'];
    summarize: CompactionProvider['summarize'];
    summarizeFragments?: CompactionProvider['summarizeFragments'];
    /** Optional checked semantic rewrite; native tasks retain the same provenance guard. */
    rewrite?: CompactionProvider['rewrite'];
}
export declare const ExecutionToolReceiptSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    runId: z.ZodUUID;
    operationId: z.ZodUUID;
    callId: z.ZodString;
    outcomeHash: z.ZodString;
    inputHash: z.ZodString;
    sources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
}, z.core.$strict>;
export type ExecutionToolReceipt = z.infer<typeof ExecutionToolReceiptSchema>;
export declare const TaskObjectionSchema: z.ZodObject<{
    requestId: z.ZodString;
    category: z.ZodEnum<{
        scope: "scope";
        preference: "preference";
        method: "method";
        premise: "premise";
        "missing-information": "missing-information";
    }>;
    blocking: z.ZodBoolean;
    actions: z.ZodDefault<z.ZodArray<z.ZodString>>;
    reason: z.ZodString;
    evidence: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>>;
}, z.core.$strict>;
export declare const TaskResolutionSchema: z.ZodObject<{
    requestId: z.ZodString;
    objectionId: z.ZodUUID;
    reason: z.ZodString;
}, z.core.$strict>;
export declare const ExecutionMotivationSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        "explicit-task": "explicit-task";
        "self-exploration": "self-exploration";
        unknown: "unknown";
        "conversation-invitation": "conversation-invitation";
        maintenance: "maintenance";
        mixed: "mixed";
    }>;
    basis: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export interface ExecutionSourceAdmission {
    readonly dependencies: readonly SourceDependency[];
    readonly sources: readonly PersonaSourceRef[];
}
