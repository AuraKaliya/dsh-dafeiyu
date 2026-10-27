import type { DatabaseSync } from 'node:sqlite';
import type { TaskMemoryProvider } from '#dafeiyu/contracts';
import type { MemoryRetrieval } from './retrieval.js';
import type { MemoryStore } from './store.js';
import { TaskWorkspace } from './task-workspace.js';
export declare function migrateTaskMemory(db: DatabaseSync): void;
/** Durable task-internal authority. The original memory boundaries are never rewritten. */
export declare class TaskMemory {
    private readonly db;
    private readonly transaction;
    private readonly memory;
    private readonly tasks;
    private readonly retrieval;
    constructor(db: DatabaseSync, transaction: <T>(work: () => T) => T, memory: MemoryStore, tasks: TaskWorkspace, retrieval: MemoryRetrieval | null);
    private audit;
    private request;
    private uniqueSources;
    policy(agentId: string, input: Parameters<TaskMemoryProvider['policy']>[1]): {
        id: string;
        version: number;
    };
    private policyState;
    private allowed;
    grant(agentId: string, taskId: string, input: Parameters<TaskMemoryProvider['grant']>[2]): string;
    private active;
    check(agent: string, task: string, grant: string): void;
    revoke(agentId: string, taskId: string, input: Parameters<TaskMemoryProvider['revoke']>[2]): {
        id: string;
        version: number;
    };
    private proof;
    recall(agentId: string, taskId: string, grantId: string, input: Parameters<TaskMemoryProvider['recall']>[3], signal: AbortSignal, outerGuard: () => void): Promise<{
        status: string;
        usage: string;
        taskId: string;
        grantId: string;
        profile: string;
        items: {
            hitId: `${string}-${string}-${string}-${string}-${string}`;
            sourceRoute: string;
            authorization: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            };
            usage: string;
            expiresAt: string;
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
        scenes: {
            route: string;
            strategyUsed: string;
            degraded: boolean;
            cacheHits: number;
            vectorsComputed: number;
        }[];
        selectionRequired: boolean;
        rankKind: string;
    }>;
    private hit;
    open(agentId: string, taskId: string, grantId: string, input: Parameters<TaskMemoryProvider['open']>[3]): {
        status: string;
        usage: string;
        text: string;
        offset: number;
        nextOffset: number | null;
        proof: {
            kind: "memory";
            route: string;
            id: string;
            revision: number;
            version: number;
            contentHash: string;
            ancestors: {
                id: string;
                revision: number;
                version: number;
                contentHash: string;
            }[];
            fences: {
                ref: string;
                contentHash: string;
                fence: string;
            }[];
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        };
        sourceRoute: string;
    };
    select(agentId: string, taskId: string, grantId: string, input: Parameters<TaskMemoryProvider['select']>[3]): {
        taskId: string;
        version: number;
        links: string[];
    };
}
