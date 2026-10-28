import type { Context } from '@deepseek-ai/cordis';
import type { PersonaAccess, ExecutionContextV3, ExecutionScope, Conversation, ContextRequest, ContextItem, ExecutionView } from '#dafeiyu/contracts';
import type { MemoryStore } from './store.js';
import type { TaskWorkspace } from './task-workspace.js';
export declare class RecentStateService {
    private readonly ctx;
    private readonly tasks;
    private readonly agentId;
    private readonly ready;
    private readonly store;
    constructor(ctx: Context, memory: MemoryStore, tasks: TaskWorkspace, agentId: string, ready: () => boolean);
    private enabled;
    save(context: ExecutionContextV3, access: PersonaAccess, input: unknown): {
        id: string;
        version: number;
        status: "active" | "withdrawn" | "dormant";
        scope: string;
        personalityAdopted: boolean;
    };
    status(access: PersonaAccess): {
        enabled: boolean;
        states: {
            schemaVersion: 1;
            id: string;
            version: number;
            scope: {
                kind: "conversation";
                agentId: string;
                route: string;
            } | {
                kind: "task";
                agentId: string;
                taskId: string;
                scopeKey: string;
            };
            runId: string;
            operationId: string;
            text: string;
            topics: string[];
            motivation: "unknown" | "mixed" | "delegated" | "self-directed";
            originMotivation: string;
            status: "active" | "withdrawn" | "dormant";
            expiresAt: string;
            createdAt: string;
            updatedAt: string;
            sources: ({
                kind: "capability";
                ref: {
                    kind: "memory";
                    revision: number;
                    id: string;
                    agentId: string;
                    scopeKey: string;
                    version: number;
                    contentHash: string;
                    authorization?: {
                        taskId: string;
                        taskEpoch: number;
                        grantId: string;
                        grantVersion: number;
                        policyId: string;
                        policyVersion: number;
                    } | undefined;
                    selectionId?: string | undefined;
                    range?: {
                        start: number;
                        end: number;
                    } | undefined;
                } | {
                    kind: "execution-source";
                    id: string;
                    agentId: string;
                    scopeKey: string;
                    version: number;
                    contentHash: string;
                };
                agentId: string;
                route: string;
            } | {
                kind: "execution-source";
                ref: {
                    kind: "memory";
                    revision: number;
                    id: string;
                    agentId: string;
                    scopeKey: string;
                    version: number;
                    contentHash: string;
                    authorization?: {
                        taskId: string;
                        taskEpoch: number;
                        grantId: string;
                        grantVersion: number;
                        policyId: string;
                        policyVersion: number;
                    } | undefined;
                    selectionId?: string | undefined;
                    range?: {
                        start: number;
                        end: number;
                    } | undefined;
                } | {
                    kind: "execution-source";
                    id: string;
                    agentId: string;
                    scopeKey: string;
                    version: number;
                    contentHash: string;
                };
                agentId: string;
                route: string;
            } | {
                kind: "execution-input";
                runId: string;
                hash: string;
                agentId: string;
                route: string;
            } | {
                kind: "execution-operation";
                runId: string;
                operationId: string;
                hash: string;
                inputHash: string;
                agentId: string;
                route: string;
            } | {
                kind: "memory";
                id: string;
                revision: number;
                version: number;
                hash: string;
                agentId: string;
                route: string;
            } | {
                kind: "inbound";
                id: string;
                hash: string;
                fence: string;
                agentId: string;
                route: string;
            } | {
                kind: "timeline";
                ref: string;
                hash: string;
                fence: string;
                agentId: string;
                route: string;
            } | {
                kind: "working";
                id: string;
                taskId: string;
                revision: number;
                hash: string;
                agentId: string;
                route: string;
            } | {
                kind: "feedback";
                id: string;
                version: number;
                hash: string;
                agentId: string;
                route: string;
            } | {
                kind: "context";
                owner: string;
                region: string;
                id: string;
                version: string;
                hash: string;
                agentId: string;
                route: string;
            } | {
                kind: "legacy";
                epoch: string;
                agentId: string;
                route: string;
            } | {
                kind: "ephemeral";
                traceId: string;
                agentId: string;
                route: string;
            } | {
                kind: "unavailable";
                reason: string;
                agentId: string;
                route: string;
            })[];
            claimType: "self_report";
        }[];
        sharedViews: {
            publication: string;
            id: string;
            version: number;
            view: string;
            expiresAt: string;
            claimType: "self_report";
        }[];
        sharedPolicy: string | null;
    };
    unpublish(access: PersonaAccess, input: unknown): {
        publication: string;
        withdrawn: boolean;
        originRecordChanged: boolean;
    };
    prepareScope(scope: ExecutionScope, query?: string): ContextItem[];
    prepareConversation(scene: Conversation, query?: string): {
        id: string;
        version: string;
        text: string;
        sources: {
            ref: string;
            version: string;
            hash: string;
        }[];
        expiresAt: string;
    }[];
    prepare(request: ContextRequest): {
        id: string;
        version: string;
        text: string;
        sources: {
            ref: string;
            version: string;
            hash: string;
        }[];
        expiresAt: string;
    }[];
    validate(request: ContextRequest, item: ContextItem): boolean;
    taskContext(view: ExecutionView): {
        id: string;
        version: string;
        text: string;
        sources: {
            ref: string;
            version: string;
            hash: string;
        }[];
        expiresAt: string;
    }[];
    publish(access: PersonaAccess, raw: unknown): Promise<{
        id: string;
        version: number;
        publication: string;
        scope: string;
        rawSourcesShared: boolean;
    }>;
}
