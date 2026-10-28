import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type { ActionContext, Json } from '#dafeiyu/contracts';
import { z } from 'zod';
import { MemoryError } from './types.js';
import { RetrievalError } from './retrieval-profile.js';
import type { RetrievalDependencies } from './retrieval-profile.js';
import { AnalysisError } from './analysis-types.js';
import { GrowthService } from './persona-service.js';
export { GrowthService } from './persona-service.js';
import { MaintenanceService } from './maintenance-service.js';
export type { MemoryView } from './store.js';
export { initializeMemoryStorage } from './storage-initialization.js';
export type { Evidence, MutationReceipt, Revision } from './types.js';
export declare const name = "dafeiyu-memory";
export declare const inject: string[];
declare const configSchema: z.ZodObject<{
    agentId: z.ZodString;
    dataDir: z.ZodString;
    lifecycleMode: z.ZodDefault<z.ZodEnum<{
        legacy: "legacy";
        managed: "managed";
    }>>;
    retrieval: z.ZodOptional<z.ZodObject<{
        endpoint: z.ZodURL;
        python: z.ZodString;
        modelDir: z.ZodString;
        serviceFile: z.ZodString;
        pythonPackages: z.ZodOptional<z.ZodString>;
        profileFile: z.ZodOptional<z.ZodString>;
        timeoutMs: z.ZodDefault<z.ZodNumber>;
        maxDocuments: z.ZodDefault<z.ZodNumber>;
        maxChunks: z.ZodDefault<z.ZodNumber>;
        maxCacheEntries: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    analysis: z.ZodOptional<z.ZodObject<{
        timeoutMs: z.ZodDefault<z.ZodNumber>;
        maxPending: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    context: z.ZodOptional<z.ZodObject<{}, z.core.$strict>>;
    feedback: z.ZodOptional<z.ZodObject<{
        maxArchiveBytes: z.ZodDefault<z.ZodNumber>;
        maxBriefBytes: z.ZodDefault<z.ZodNumber>;
        maxPageChars: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    compaction: z.ZodOptional<z.ZodPipe<z.ZodObject<{
        inputTokens: z.ZodNumber;
        thresholdRatio: z.ZodDefault<z.ZodNumber>;
        targetRatio: z.ZodDefault<z.ZodNumber>;
        minGrowthTokens: z.ZodDefault<z.ZodNumber>;
        minSavingsTokens: z.ZodDefault<z.ZodNumber>;
        cooldownMs: z.ZodDefault<z.ZodNumber>;
        retainTurns: z.ZodDefault<z.ZodNumber>;
        maxSourceBytes: z.ZodDefault<z.ZodNumber>;
        maxSummaryChars: z.ZodDefault<z.ZodNumber>;
        summaryMaxOutputTokens: z.ZodDefault<z.ZodNumber>;
        maxFragmentGroups: z.ZodDefault<z.ZodNumber>;
        maxFragments: z.ZodDefault<z.ZodNumber>;
        initialMaxGroups: z.ZodOptional<z.ZodNumber>;
        initialMaxFragments: z.ZodOptional<z.ZodNumber>;
        semanticEnabled: z.ZodDefault<z.ZodBoolean>;
        semanticMaxConsecutive: z.ZodDefault<z.ZodNumber>;
        semanticMaxOutputTokens: z.ZodDefault<z.ZodNumber>;
        timeoutMs: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>, z.ZodTransform<{
        initialMaxGroups: number;
        initialMaxFragments: number;
        inputTokens: number;
        thresholdRatio: number;
        targetRatio: number;
        minGrowthTokens: number;
        minSavingsTokens: number;
        cooldownMs: number;
        retainTurns: number;
        maxSourceBytes: number;
        maxSummaryChars: number;
        summaryMaxOutputTokens: number;
        maxFragmentGroups: number;
        maxFragments: number;
        semanticEnabled: boolean;
        semanticMaxConsecutive: number;
        semanticMaxOutputTokens: number;
        timeoutMs: number;
    }, {
        inputTokens: number;
        thresholdRatio: number;
        targetRatio: number;
        minGrowthTokens: number;
        minSavingsTokens: number;
        cooldownMs: number;
        retainTurns: number;
        maxSourceBytes: number;
        maxSummaryChars: number;
        summaryMaxOutputTokens: number;
        maxFragmentGroups: number;
        maxFragments: number;
        semanticEnabled: boolean;
        semanticMaxConsecutive: number;
        semanticMaxOutputTokens: number;
        timeoutMs: number;
        initialMaxGroups?: number | undefined;
        initialMaxFragments?: number | undefined;
    }>>>;
    sourceTracking: z.ZodDefault<z.ZodBoolean>;
    maintenance: z.ZodOptional<z.ZodObject<{
        timeoutMs: z.ZodDefault<z.ZodNumber>;
        maxInputBytes: z.ZodDefault<z.ZodNumber>;
        maxOutputBytes: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const MemoryPluginConfigSchema: z.ZodObject<{
    analysis: z.ZodOptional<z.ZodObject<{
        timeoutMs: z.ZodDefault<z.ZodNumber>;
        maxPending: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    maintenance: z.ZodOptional<z.ZodObject<{
        timeoutMs: z.ZodDefault<z.ZodNumber>;
        maxInputBytes: z.ZodDefault<z.ZodNumber>;
        maxOutputBytes: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    feedback: z.ZodOptional<z.ZodObject<{
        maxArchiveBytes: z.ZodDefault<z.ZodNumber>;
        maxBriefBytes: z.ZodDefault<z.ZodNumber>;
        maxPageChars: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    context: z.ZodOptional<z.ZodObject<{}, z.core.$strict>>;
    compaction: z.ZodOptional<z.ZodPipe<z.ZodObject<{
        inputTokens: z.ZodNumber;
        thresholdRatio: z.ZodDefault<z.ZodNumber>;
        targetRatio: z.ZodDefault<z.ZodNumber>;
        minGrowthTokens: z.ZodDefault<z.ZodNumber>;
        minSavingsTokens: z.ZodDefault<z.ZodNumber>;
        cooldownMs: z.ZodDefault<z.ZodNumber>;
        retainTurns: z.ZodDefault<z.ZodNumber>;
        maxSourceBytes: z.ZodDefault<z.ZodNumber>;
        maxSummaryChars: z.ZodDefault<z.ZodNumber>;
        summaryMaxOutputTokens: z.ZodDefault<z.ZodNumber>;
        maxFragmentGroups: z.ZodDefault<z.ZodNumber>;
        maxFragments: z.ZodDefault<z.ZodNumber>;
        initialMaxGroups: z.ZodOptional<z.ZodNumber>;
        initialMaxFragments: z.ZodOptional<z.ZodNumber>;
        semanticEnabled: z.ZodDefault<z.ZodBoolean>;
        semanticMaxConsecutive: z.ZodDefault<z.ZodNumber>;
        semanticMaxOutputTokens: z.ZodDefault<z.ZodNumber>;
        timeoutMs: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>, z.ZodTransform<{
        initialMaxGroups: number;
        initialMaxFragments: number;
        inputTokens: number;
        thresholdRatio: number;
        targetRatio: number;
        minGrowthTokens: number;
        minSavingsTokens: number;
        cooldownMs: number;
        retainTurns: number;
        maxSourceBytes: number;
        maxSummaryChars: number;
        summaryMaxOutputTokens: number;
        maxFragmentGroups: number;
        maxFragments: number;
        semanticEnabled: boolean;
        semanticMaxConsecutive: number;
        semanticMaxOutputTokens: number;
        timeoutMs: number;
    }, {
        inputTokens: number;
        thresholdRatio: number;
        targetRatio: number;
        minGrowthTokens: number;
        minSavingsTokens: number;
        cooldownMs: number;
        retainTurns: number;
        maxSourceBytes: number;
        maxSummaryChars: number;
        summaryMaxOutputTokens: number;
        maxFragmentGroups: number;
        maxFragments: number;
        semanticEnabled: boolean;
        semanticMaxConsecutive: number;
        semanticMaxOutputTokens: number;
        timeoutMs: number;
        initialMaxGroups?: number | undefined;
        initialMaxFragments?: number | undefined;
    }>>>;
    retrieval: z.ZodOptional<z.ZodObject<{
        endpoint: z.ZodURL;
        python: z.ZodString;
        modelDir: z.ZodString;
        serviceFile: z.ZodString;
        pythonPackages: z.ZodOptional<z.ZodString>;
        profileFile: z.ZodOptional<z.ZodString>;
        timeoutMs: z.ZodDefault<z.ZodNumber>;
        maxDocuments: z.ZodDefault<z.ZodNumber>;
        maxChunks: z.ZodDefault<z.ZodNumber>;
        maxCacheEntries: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    sourceTracking: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
export type Config = z.input<typeof configSchema>;
type Failure = {
    status: 'invalid_input' | MemoryError['code'] | RetrievalError['code'] | AnalysisError['code'];
};
declare module '@deepseek-ai/cordis' {
    interface Context {
        dafeiyuMemory: MemoryService;
    }
}
/** Scope-bound memory operations with opt-in independent analysis through the official DSH loop. */
export declare class MemoryService extends Service {
    private readonly config;
    private readonly store;
    private readonly handle;
    private readonly retrieval;
    private readonly analysis;
    private readonly working;
    private readonly automaticRecall;
    private nativeRecall;
    private readonly assembly;
    private readonly feedbackArchive;
    private readonly tasks;
    private readonly expression;
    private closed;
    private readonly gate;
    private closing;
    private unbindRepository;
    private unbindNativeExpression;
    private nativeExpression;
    readonly growth: GrowthService | undefined;
    /** @deprecated Same instance; retained for existing internal callers. */
    get persona(): GrowthService | undefined;
    readonly maintenance: MaintenanceService | undefined;
    private readonly emptyMaintenanceCounts;
    private readonly capabilityService;
    constructor(ctx: Context, config: Config, dependencies?: RetrievalDependencies);
    get lifecycleState(): import("#dafeiyu/contracts").ServicePhase;
    runtimeHealth(): {
        context: {
            mode: "legacy" | "unified";
            automaticRecall: boolean;
            recallStrategy: "lexical" | "hybrid";
            recentState: boolean;
            sharedRecentState: boolean;
        };
        lifecycle: import("#dafeiyu/contracts").ServicePhase;
        analysis: {
            state: "failed" | "paused" | "stopped" | "ready";
            active: boolean;
        } | {
            state: "not-configured";
            active: false;
        };
        maintenance: {
            state: "paused" | "closed" | "ready";
            active: number;
            requests: Record<string, number>;
            scheduler: "connected" | "not-configured";
        } | {
            state: "not-configured";
            active: number;
            requests: Record<string, number>;
            scheduler: "not-configured";
        };
        retrieval: "not-configured" | "configured";
        compaction: "not-configured" | "configured";
        sourceTracking: "not-configured" | "configured";
    };
    recover(): void;
    activate(): void;
    quiesce(): void;
    stopBackground(): void;
    cancelRunning(): void;
    whenIdle(): Promise<void>;
    close(): Promise<void>;
    private scope;
    private assertTasks;
    private failure;
    private flush;
    private audit;
    private evidence;
    private value;
    private commit;
    create(context: ActionContext, raw: unknown): Promise<Failure | {
        auditPending: boolean;
        visibleNow: boolean;
        deletionScope: "memory-item-and-revisions";
        sourceArchivesUnchanged: boolean;
        evidenceVerification: "access-and-hash-only";
        id: string;
        version: number;
        revision: number;
        eventId: string;
        generation?: number | undefined;
        duplicate: boolean;
        status: "ok";
    }>;
    revise(context: ActionContext, raw: unknown): Promise<Failure | {
        auditPending: boolean;
        visibleNow: boolean;
        deletionScope: "memory-item-and-revisions";
        sourceArchivesUnchanged: boolean;
        evidenceVerification: "access-and-hash-only";
        id: string;
        version: number;
        revision: number;
        eventId: string;
        generation?: number | undefined;
        duplicate: boolean;
        status: "ok";
    }>;
    private change;
    delete(context: ActionContext, raw: unknown): Failure | {
        auditPending: boolean;
        visibleNow: boolean;
        deletionScope: "memory-item-and-revisions";
        sourceArchivesUnchanged: boolean;
        evidenceVerification: "access-and-hash-only";
        id: string;
        version: number;
        revision: number;
        eventId: string;
        generation?: number | undefined;
        duplicate: boolean;
        status: "ok";
    };
    restore(context: ActionContext, raw: unknown): Failure | {
        auditPending: boolean;
        visibleNow: boolean;
        deletionScope: "memory-item-and-revisions";
        sourceArchivesUnchanged: boolean;
        evidenceVerification: "access-and-hash-only";
        id: string;
        version: number;
        revision: number;
        eventId: string;
        generation?: number | undefined;
        duplicate: boolean;
        status: "ok";
    };
    private find;
    search(context: ActionContext, raw: unknown): Failure | {
        items: {
            sourceFences?: {
                ref: string;
                contentHash: string;
                fence: string;
            }[];
            boundary: import("#dafeiyu/contracts").MemoryBoundary;
            effectiveAccess: Pick<import("#dafeiyu/contracts").MemoryBoundary, "internalUse" | "externalExpression">;
            observation?: unknown;
            sourceVersions: readonly {
                id: string;
                revision: number;
                version: number;
                contentHash: string;
            }[];
            ref: string;
            version: number;
            latestRevision: number;
            validity: "active" | "superseded";
            deleted: boolean;
            effectivelyDeleted: boolean;
            basisStatus: "current" | "changed" | "deleted";
            deletionReason: string | null;
            untrustedEvidence: true;
            useRestriction: "evidence_only" | "historical_evidence_only" | "deleted_lookup_only";
            id: string;
            revision: number;
            kind: "experience" | "knowledge" | "preference" | "procedure";
            claimType: "observation" | "self_report" | "reported_claim" | "inference";
            content: string;
            contentHash: string;
            sources: ({
                kind: "capability";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "execution";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "observation";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "timeline";
                ref: string;
                contentHash: string;
            } | {
                kind: "memory";
                id: string;
                revision: number;
                contentHash: string;
            })[];
            createdAt: string;
            analysisStatus: "not_analyzed" | "evidence_checked";
            analysis?: {
                jobId: string;
                candidateId: string;
                policyVersion: "literal-evidence-v1";
            } | undefined;
        }[];
        generation: number;
        nextCursor: string | null;
        status: "ok";
        mode: "deleted" | "normal";
        untrustedEvidence: boolean;
    };
    searchDeleted(context: ActionContext, raw: unknown): Failure | {
        items: {
            sourceFences?: {
                ref: string;
                contentHash: string;
                fence: string;
            }[];
            boundary: import("#dafeiyu/contracts").MemoryBoundary;
            effectiveAccess: Pick<import("#dafeiyu/contracts").MemoryBoundary, "internalUse" | "externalExpression">;
            observation?: unknown;
            sourceVersions: readonly {
                id: string;
                revision: number;
                version: number;
                contentHash: string;
            }[];
            ref: string;
            version: number;
            latestRevision: number;
            validity: "active" | "superseded";
            deleted: boolean;
            effectivelyDeleted: boolean;
            basisStatus: "current" | "changed" | "deleted";
            deletionReason: string | null;
            untrustedEvidence: true;
            useRestriction: "evidence_only" | "historical_evidence_only" | "deleted_lookup_only";
            id: string;
            revision: number;
            kind: "experience" | "knowledge" | "preference" | "procedure";
            claimType: "observation" | "self_report" | "reported_claim" | "inference";
            content: string;
            contentHash: string;
            sources: ({
                kind: "capability";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "execution";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "observation";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "timeline";
                ref: string;
                contentHash: string;
            } | {
                kind: "memory";
                id: string;
                revision: number;
                contentHash: string;
            })[];
            createdAt: string;
            analysisStatus: "not_analyzed" | "evidence_checked";
            analysis?: {
                jobId: string;
                candidateId: string;
                policyVersion: "literal-evidence-v1";
            } | undefined;
        }[];
        generation: number;
        nextCursor: string | null;
        status: "ok";
        mode: "deleted" | "normal";
        untrustedEvidence: boolean;
    };
    private open;
    read(context: ActionContext, raw: unknown): Failure | {
        status: "ok";
        item: {
            sourceFences?: {
                ref: string;
                contentHash: string;
                fence: string;
            }[];
            boundary: import("#dafeiyu/contracts").MemoryBoundary;
            effectiveAccess: Pick<import("#dafeiyu/contracts").MemoryBoundary, "internalUse" | "externalExpression">;
            observation?: unknown;
            sourceVersions: readonly {
                id: string;
                revision: number;
                version: number;
                contentHash: string;
            }[];
            ref: string;
            version: number;
            latestRevision: number;
            validity: "active" | "superseded";
            deleted: boolean;
            effectivelyDeleted: boolean;
            basisStatus: "current" | "changed" | "deleted";
            deletionReason: string | null;
            untrustedEvidence: true;
            useRestriction: "evidence_only" | "historical_evidence_only" | "deleted_lookup_only";
            id: string;
            revision: number;
            kind: "experience" | "knowledge" | "preference" | "procedure";
            claimType: "observation" | "self_report" | "reported_claim" | "inference";
            content: string;
            contentHash: string;
            sources: ({
                kind: "capability";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "execution";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "observation";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "timeline";
                ref: string;
                contentHash: string;
            } | {
                kind: "memory";
                id: string;
                revision: number;
                contentHash: string;
            })[];
            createdAt: string;
            analysisStatus: "not_analyzed" | "evidence_checked";
            analysis?: {
                jobId: string;
                candidateId: string;
                policyVersion: "literal-evidence-v1";
            } | undefined;
        };
    };
    readDeleted(context: ActionContext, raw: unknown): Failure | {
        status: "ok";
        item: {
            sourceFences?: {
                ref: string;
                contentHash: string;
                fence: string;
            }[];
            boundary: import("#dafeiyu/contracts").MemoryBoundary;
            effectiveAccess: Pick<import("#dafeiyu/contracts").MemoryBoundary, "internalUse" | "externalExpression">;
            observation?: unknown;
            sourceVersions: readonly {
                id: string;
                revision: number;
                version: number;
                contentHash: string;
            }[];
            ref: string;
            version: number;
            latestRevision: number;
            validity: "active" | "superseded";
            deleted: boolean;
            effectivelyDeleted: boolean;
            basisStatus: "current" | "changed" | "deleted";
            deletionReason: string | null;
            untrustedEvidence: true;
            useRestriction: "evidence_only" | "historical_evidence_only" | "deleted_lookup_only";
            id: string;
            revision: number;
            kind: "experience" | "knowledge" | "preference" | "procedure";
            claimType: "observation" | "self_report" | "reported_claim" | "inference";
            content: string;
            contentHash: string;
            sources: ({
                kind: "capability";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "execution";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "observation";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "timeline";
                ref: string;
                contentHash: string;
            } | {
                kind: "memory";
                id: string;
                revision: number;
                contentHash: string;
            })[];
            createdAt: string;
            analysisStatus: "not_analyzed" | "evidence_checked";
            analysis?: {
                jobId: string;
                candidateId: string;
                policyVersion: "literal-evidence-v1";
            } | undefined;
        };
    };
    recall(context: ActionContext, raw: unknown): Promise<Failure | {
        status: "not_configured";
    } | {
        items: {
            sourceFences: {
                ref: string;
                contentHash: string;
                fence: string;
            }[];
            id: string;
            ref: string;
            revision: number;
            version: number;
            contentHash: string;
            sources: ({
                kind: "capability";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "execution";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "observation";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "timeline";
                ref: string;
                contentHash: string;
            } | {
                kind: "memory";
                id: string;
                revision: number;
                contentHash: string;
            })[];
            sourceVersions: readonly {
                id: string;
                revision: number;
                version: number;
                contentHash: string;
            }[];
            boundary: {
                schemaVersion: 1;
                policyVersion: 1;
                owner: {
                    kind: "agent";
                    agentId: string;
                };
                sourceScene: {
                    kind: "conversation";
                    route: string;
                    conversation: {
                        channel: string;
                        account: string;
                        kind: "private" | "group" | "local";
                        id: string;
                    };
                    ingressPluginId: string | null;
                } | {
                    kind: "legacy-route";
                    route: string;
                };
                task: {
                    kind: "unassigned";
                } | {
                    kind: "conversation-task";
                    route: string;
                    id: string;
                } | {
                    kind: "agent-task";
                    id: string;
                };
                internalUse: {
                    kind: "conversation";
                    route: string;
                } | {
                    kind: "none";
                };
                externalExpression: {
                    kind: "conversation";
                    route: string;
                } | {
                    kind: "none";
                };
                assignment: "legacy-migration" | "conservative-create";
            } | {
                schemaVersion: 2;
                policyVersion: 1;
                owner: {
                    kind: "agent";
                    agentId: string;
                };
                sourceScene: {
                    kind: "execution-task";
                    route: string;
                    taskId: string;
                };
                task: {
                    kind: "agent-task";
                    id: string;
                };
                internalUse: {
                    kind: "task";
                    route: string;
                    taskId: string;
                } | {
                    kind: "none";
                };
                externalExpression: {
                    kind: "none";
                };
                assignment: "execution-create";
            };
            effectiveAccess: Pick<{
                schemaVersion: 1;
                policyVersion: 1;
                owner: {
                    kind: "agent";
                    agentId: string;
                };
                sourceScene: {
                    kind: "conversation";
                    route: string;
                    conversation: {
                        channel: string;
                        account: string;
                        kind: "private" | "group" | "local";
                        id: string;
                    };
                    ingressPluginId: string | null;
                } | {
                    kind: "legacy-route";
                    route: string;
                };
                task: {
                    kind: "unassigned";
                } | {
                    kind: "conversation-task";
                    route: string;
                    id: string;
                } | {
                    kind: "agent-task";
                    id: string;
                };
                internalUse: {
                    kind: "conversation";
                    route: string;
                } | {
                    kind: "none";
                };
                externalExpression: {
                    kind: "conversation";
                    route: string;
                } | {
                    kind: "none";
                };
                assignment: "legacy-migration" | "conservative-create";
            } | {
                schemaVersion: 2;
                policyVersion: 1;
                owner: {
                    kind: "agent";
                    agentId: string;
                };
                sourceScene: {
                    kind: "execution-task";
                    route: string;
                    taskId: string;
                };
                task: {
                    kind: "agent-task";
                    id: string;
                };
                internalUse: {
                    kind: "task";
                    route: string;
                    taskId: string;
                } | {
                    kind: "none";
                };
                externalExpression: {
                    kind: "none";
                };
                assignment: "execution-create";
            }, "internalUse" | "externalExpression">;
            score: number;
            chunk: {
                key: string;
                start: number;
                end: number;
                tokens: number;
                offsetUnit: "unicode-codepoint";
                text: string;
                truncated: boolean;
                previewEnd: number;
            };
        }[];
        cacheHits: number;
        vectorsComputed: number;
        status: "ok";
        untrustedEvidence: boolean;
        profile: string;
        generation: number;
        strategyRequested: "lexical" | "semantic" | "hybrid";
        strategyUsed: "lexical" | "semantic" | "hybrid";
        scoreKind: string;
        degraded: boolean;
        degradationReason: string | null;
        indexedChunks: number;
    }>;
    analyze(context: ActionContext, raw: unknown): Promise<{
        duplicate: boolean;
        status: "ok";
        jobId: string;
        state: "completed" | "failed" | "running" | "queued" | "committing" | "cancelled";
        attempts: number;
        counts: {
            candidates: number;
            committed: number;
            review: number;
        };
        error: string | null;
        contextInjected: boolean;
    } | {
        status: string;
    }>;
    analysisStatus(context: ActionContext, id: unknown): Failure | {
        status: "ok";
        jobId: string;
        state: "completed" | "failed" | "running" | "queued" | "committing" | "cancelled";
        attempts: number;
        counts: {
            candidates: number;
            committed: number;
            review: number;
        };
        error: string | null;
        contextInjected: boolean;
    } | {
        status: "not_configured";
    };
    analysisInspect(context: ActionContext, id: unknown): Promise<Failure | {
        untrustedEvidence: boolean;
        useRestriction: string;
        result: {
            schemaVersion: 1;
            overview: string;
            gaps: string[];
            claims: {
                action: "add" | "revise" | "none";
                kind: "experience" | "knowledge" | "preference" | "procedure";
                claimType: "observation" | "self_report" | "reported_claim" | "inference";
                subject: string;
                content: string;
                support: {
                    sourceId: string;
                    quote: string;
                }[];
                opposition: {
                    sourceId: string;
                    quote: string;
                }[];
                uncertainties: string[];
                explicit: boolean;
                temporal: "durable" | "temporary" | "uncertain";
                targetId: string | null;
            }[];
        } | null;
        model: import("./analysis-types.js").ModelRoute;
        policyVersion: string;
        inputGeneration: number;
        sources: {
            sourceId: string;
            evidence: {
                kind: "capability";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "execution";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "observation";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "timeline";
                ref: string;
                contentHash: string;
            } | {
                kind: "memory";
                id: string;
                revision: number;
                contentHash: string;
            };
            origin: "user" | "tool" | "memory" | "event";
            authorId?: string | undefined;
            version?: number | undefined;
        }[];
        targets: {
            id: string;
            version: number;
            revision: number;
        }[];
        candidates: {
            id: string;
            claim: import("./analysis-types.js").Claim;
            status: "needs_review" | "ready" | "committed" | "duplicate" | "stale";
            reason: string;
            receipt?: import("./types.js").MutationReceipt | undefined;
        }[];
        status: "ok";
        jobId: string;
        state: "completed" | "failed" | "running" | "queued" | "committing" | "cancelled";
        attempts: number;
        counts: {
            candidates: number;
            committed: number;
            review: number;
        };
        error: string | null;
        contextInjected: boolean;
    } | {
        status: "not_configured";
    }>;
    analysisCancel(context: ActionContext, id: unknown): Failure | {
        status: "ok";
        jobId: string;
        state: "completed" | "failed" | "running" | "queued" | "committing" | "cancelled";
        attempts: number;
        counts: {
            candidates: number;
            committed: number;
            review: number;
        };
        error: string | null;
        contextInjected: boolean;
    } | {
        status: "not_configured";
    };
    whenAnalysisIdle(): Promise<void>;
    updateWorking(context: ActionContext, raw: unknown): Promise<Failure | {
        admission: string;
        duplicate: boolean;
        kind: "evidence" | "working";
        version: number;
        eventId: string;
        status: "ok";
    } | {
        status: "not_configured";
    }>;
    selectContext(context: ActionContext, raw: unknown): Failure | {
        selected: number;
        admission: string;
        duplicate: boolean;
        kind: "evidence" | "working";
        version: number;
        eventId: string;
        status: "ok";
    } | {
        status: "not_configured";
    };
    retrieveContext(context: ActionContext, raw: unknown): Promise<Failure | {
        status: "not_configured";
    } | {
        strategy: "lexical" | "semantic" | "hybrid";
        degraded: boolean;
        selected: number;
        admission: string;
        duplicate: boolean;
        kind: "evidence" | "working";
        version: number;
        eventId: string;
        status: "ok";
    }>;
    clearContext(context: ActionContext, raw: unknown): Failure | {
        duplicate: boolean;
        kind: "evidence" | "working";
        version: number;
        eventId: string;
        status: "ok";
    } | {
        status: "not_configured";
    };
    contextStatus(context: ActionContext, raw?: unknown): {
        automaticRecall: {
            mode: "lexical" | "hybrid";
            degraded: boolean;
            partial: boolean;
            candidates: number;
            selected: number;
            queryHash: string;
        } | null;
        status: "ok";
        areas: {
            kind: "evidence" | "working";
            version: number;
            taskId: string | null;
            expiresAt: string | null;
            storedCount: number;
            expired: boolean;
        }[];
        current: Json;
    } | {
        automaticRecall: {
            mode: "lexical" | "hybrid";
            degraded: boolean;
            partial: boolean;
            candidates: number;
            selected: number;
            queryHash: string;
        } | null;
        status: "not_configured";
        current: Json;
    };
    feedbackOpen(context: ActionContext, raw: unknown, deleted?: boolean): string | number | boolean | Json[] | {
        [key: string]: Json;
    } | Failure;
    feedbackList(context: ActionContext, raw: unknown): string | number | boolean | Json[] | {
        [key: string]: Json;
    } | Failure;
    feedbackDelete(context: ActionContext, raw: unknown): string | number | boolean | Json[] | {
        [key: string]: Json;
    } | Failure;
    feedbackRestore(context: ActionContext, raw: unknown): string | number | boolean | Json[] | {
        [key: string]: Json;
    } | Failure;
    private actions;
}
export declare function apply(ctx: Context, config: Config): void;
