import type { TimelineScope, MemoryAccessPurpose } from '#dafeiyu/contracts';
import { MemoryStore } from './store.js';
import type { MemoryView } from './store.js';
import { loadProfile } from './retrieval-profile.js';
import type { RetrievalConfig, RetrievalDependencies } from './retrieval-profile.js';
interface RetrievalView {
    purpose: MemoryAccessPurpose;
    cacheScope: TimelineScope;
    accepts: (memory: MemoryView) => boolean;
}
/** Index membership is derived from authorized live memory, never from vector cache membership. */
export declare class MemoryRetrieval {
    private readonly memory;
    readonly profile: ReturnType<typeof loadProfile>;
    private readonly index;
    private readonly config;
    private readonly dependencies;
    private readonly stop;
    private closed;
    constructor(memory: MemoryStore, dataDir: string, raw: RetrievalConfig, dependencies?: RetrievalDependencies);
    private validateChunks;
    private live;
    private reconcile;
    recall(scope: TimelineScope, raw: unknown, signal: AbortSignal, authorize: () => void): Promise<{
        items: {
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
                        kind: "local" | "private" | "group";
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
                        kind: "local" | "private" | "group";
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
    /** Trusted task executor only; model-facing recall cannot choose purpose or namespace. */
    recallInternal(scope: TimelineScope, partition: string, accepts: RetrievalView['accepts'], raw: unknown, signal: AbortSignal, authorize: () => void): Promise<{
        items: {
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
                        kind: "local" | "private" | "group";
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
                        kind: "local" | "private" | "group";
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
    private run;
    close(): void;
}
export {};
