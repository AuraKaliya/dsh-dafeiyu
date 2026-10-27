import type { TimelineScope } from './history.js';
import { z } from 'zod';
import type { ContextItem } from './context.js';
import type { SemanticRequest, SemanticResult } from './semantic.js';
/** Immutable input dependencies, supplied by trusted producers rather than model citations. */
export declare const SourceDependencySchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"capability">;
    ref: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "kind">;
    agentId: z.ZodString;
    route: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"execution-source">;
    ref: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "kind">;
    agentId: z.ZodString;
    route: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"execution-input">;
    runId: z.ZodUUID;
    hash: z.ZodString;
    agentId: z.ZodString;
    route: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"execution-operation">;
    runId: z.ZodUUID;
    operationId: z.ZodUUID;
    hash: z.ZodString;
    inputHash: z.ZodString;
    agentId: z.ZodString;
    route: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"memory">;
    id: z.ZodString;
    revision: z.ZodNumber;
    version: z.ZodNumber;
    hash: z.ZodString;
    agentId: z.ZodString;
    route: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"inbound">;
    id: z.ZodString;
    hash: z.ZodString;
    fence: z.ZodString;
    agentId: z.ZodString;
    route: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"timeline">;
    ref: z.ZodString;
    hash: z.ZodString;
    fence: z.ZodString;
    agentId: z.ZodString;
    route: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"working">;
    id: z.ZodString;
    taskId: z.ZodString;
    revision: z.ZodNumber;
    hash: z.ZodString;
    agentId: z.ZodString;
    route: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"feedback">;
    id: z.ZodString;
    version: z.ZodNumber;
    hash: z.ZodString;
    agentId: z.ZodString;
    route: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"context">;
    owner: z.ZodString;
    region: z.ZodString;
    id: z.ZodString;
    version: z.ZodString;
    hash: z.ZodString;
    agentId: z.ZodString;
    route: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"legacy">;
    epoch: z.ZodString;
    agentId: z.ZodString;
    route: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"ephemeral">;
    traceId: z.ZodString;
    agentId: z.ZodString;
    route: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"unavailable">;
    reason: z.ZodString;
    agentId: z.ZodString;
    route: z.ZodString;
}, z.core.$strict>], "kind">;
export type SourceDependency = z.infer<typeof SourceDependencySchema>;
export interface SourcePolicy {
    inbound(scope: CompactionScope, messageId: string): readonly SourceDependency[];
    context(scope: CompactionScope, region: string, item: ContextItem): readonly SourceDependency[];
    tool(scope: CompactionScope, name: string, text: string, meta: unknown): readonly SourceDependency[];
    validate(scope: CompactionScope, dependency: SourceDependency): boolean;
}
/** Trusted extension seam. Routes are supplied by the core, never by model arguments. */
export interface CompactionScope extends TimelineScope {
    readonly traceId: string;
}
export interface CompactionBasis {
    /** Monotonic scope state fingerprint; restoring data must produce a new fingerprint. */
    readonly epoch: string;
    readonly taskId: string | null;
    /** Native tasks keep their current input outside compression while completed earlier Runs may compact. */
    readonly protectedRunId?: string;
    readonly versions: Readonly<Record<string, number>>;
}
export interface CompactionPolicy {
    readonly enabled?: boolean;
    readonly inputTokens: number;
    readonly thresholdRatio: number;
    readonly targetRatio: number;
    readonly minGrowthTokens: number;
    readonly minSavingsTokens: number;
    readonly cooldownMs: number;
    readonly retainTurns: number;
    readonly maxSourceBytes: number;
    readonly maxSummaryChars: number;
    readonly maxFragmentGroups?: number;
    readonly maxFragments?: number;
    /** Initial work batches may be smaller than the total active composition capacity. */
    readonly initialMaxGroups?: number;
    readonly initialMaxFragments?: number;
    readonly semanticEnabled?: boolean;
    readonly semanticMaxConsecutive?: number;
    readonly semanticMaxOutputTokens?: number;
}
export declare const SummaryFragmentSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        fact: "fact";
        decision: "decision";
        constraint: "constraint";
        correction: "correction";
        pending: "pending";
        uncertainty: "uncertainty";
        result: "result";
        note: "note";
    }>;
    text: z.ZodString;
}, z.core.$strict>;
export type SummaryFragment = z.infer<typeof SummaryFragmentSchema>;
export interface CompactionSource {
    readonly seq: number;
    readonly role: 'user' | 'assistant';
    readonly text: string;
    readonly hash: string;
}
export interface CompactionProvider {
    readonly policy: CompactionPolicy;
    basis(scope: CompactionScope): CompactionBasis;
    readonly sources?: SourcePolicy;
    summarize(scope: CompactionScope, sources: readonly CompactionSource[], signal: AbortSignal, checkSources?: () => void): Promise<string>;
    summarizeFragments?(scope: CompactionScope, sources: readonly CompactionSource[], signal: AbortSignal, checkSources: () => void, maxChars: number, maxFragments?: number, targetChars?: number): Promise<readonly SummaryFragment[]>;
    rewrite?(scope: CompactionScope, request: SemanticRequest, signal: AbortSignal, checkSources: () => void): Promise<SemanticResult>;
}
