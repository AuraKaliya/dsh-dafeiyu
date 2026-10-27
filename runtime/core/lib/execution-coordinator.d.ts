import { z } from 'zod';
import type { TaskRepositoryPort, TaskRef, RunRef, ExecutionContextV3, ExecutionInput, WakeAuthorityProvider, HostConfig, Json, PersonaAccess, Conversation } from '#dafeiyu/contracts';
import type { PersonaRuntime } from './persona-runtime.js';
import type { FoundationSnapshot } from './foundation.js';
import type { Journal } from '#dafeiyu/journal';
import { RuntimeStore } from './runtime-store.js';
import type { StoredRun } from './runtime-store.js';
import type { DshRuntime } from './runtime.js';
import type { CapabilityRegistryV3 } from './registry-v3.js';
import type { RunScheduler } from './run-scheduler.js';
import type { NativeAction } from './execution-frame.js';
import type { ExecutionMemoryPort } from '#dafeiyu/contracts';
import type { ActivityAnchor, MaintenanceLifecycle } from '#dafeiyu/contracts';
import type { MessageTaskBinding, NativeExpressionAccess } from '#dafeiyu/contracts';
import type { ExternalTaskAuthority } from '#dafeiyu/contracts';
export declare const ExecutionOptionsSchema: z.ZodObject<{
    profileId: z.ZodString;
    createStore: z.ZodDefault<z.ZodBoolean>;
    policies: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        producers: z.ZodArray<z.ZodString>;
        actions: z.ZodArray<z.ZodString>;
        allowLocalWrite: z.ZodDefault<z.ZodBoolean>;
        externalActions: z.ZodOptional<z.ZodArray<z.ZodObject<{
            extensionId: z.ZodString;
            actionId: z.ZodString;
            actionVersion: z.ZodString;
        }, z.core.$strict>>>;
        sourceRules: z.ZodDefault<z.ZodArray<z.ZodString>>;
        resources: z.ZodDefault<z.ZodArray<z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                private: "private";
                group: "group";
                local: "local";
            }>;
            id: z.ZodString;
        }, z.core.$strict>>>;
    }, z.core.$strict>>>;
    maxPendingRuns: z.ZodDefault<z.ZodNumber>;
    maxConcurrentRuns: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export type ExecutionOptions = z.input<typeof ExecutionOptionsSchema>;
interface Dependencies {
    agentId: string;
    store: RuntimeStore;
    journal: Journal;
    runtime: DshRuntime;
    registry: CapabilityRegistryV3;
    scheduler: RunScheduler;
    options: z.output<typeof ExecutionOptionsSchema>;
    repository: () => TaskRepositoryPort | undefined;
    personas: PersonaRuntime;
    memory: () => ExecutionMemoryPort | undefined;
    accepting: () => boolean;
    assertAccepting: () => void;
    persona: () => FoundationSnapshot;
    model: HostConfig['modelRoutes']['chat'];
    turnTimeoutMs: number;
    context: {
        requestMaxBytes: number;
        outputReserveBytes: number;
        maxBytes: number;
        prepareTimeoutMs: number;
    };
    signal: AbortSignal;
    assessmentTimeoutMs?: number;
    projectConversation?: () => Promise<void>;
    messageSignal?: (inboundId: string) => AbortSignal | undefined;
    settled?: (runId: string) => void;
    progress?: (runId: string) => Promise<Json>;
    media?: () => import('#dafeiyu/contracts').MediaPort | undefined;
}
/** Durable acceptance and authority; DSH remains the sole model loop. */
export declare class ExecutionCoordinator {
    private readonly d;
    private readonly refs;
    private readonly tasks;
    private readonly grants;
    private readonly active;
    private readonly queued;
    private readonly taskQueues;
    private readonly wakes;
    private failure;
    private readonly evidence;
    private readonly messageBindings;
    private readonly lifecycleObservers;
    private anchorDepth;
    private readonly anchorChecking;
    private readonly anchorMemo;
    constructor(d: Dependencies);
    private allowedResource;
    resources(context: ExecutionContextV3, pluginId: string): readonly Conversation[];
    quoteReplySource(context: ExecutionContextV3, pluginId: string): {
        key: string;
        target: {
            channel: string;
            account: string;
            kind: "private" | "group" | "local";
            id: string;
        };
        inboundId: string;
    };
    bindMessageTasks(binding: MessageTaskBinding): () => void;
    private messageBindingHash;
    private messageDirective;
    describeMessageResult(id: string): {
        item: import("#dafeiyu/contracts").PendingMessage;
        autoDeliver: boolean | undefined;
        anchor: {
            kind: "task-result";
            schemaVersion: 1;
            taskId: string;
            runId: string;
            inboundId: string;
            target: {
                channel: string;
                account: string;
                kind: "private" | "group" | "local";
                id: string;
            };
            intentVersion: number;
            authorityVersion: string;
            expiresAt: string;
            outcome?: "waiting" | undefined;
        };
    } | null;
    private validateMessageSource;
    private validateMessageAncestors;
    private messageAuthority;
    submitMessageTask(context: ExecutionContextV3, pluginId: string, raw: unknown): {
        taskId: string;
        runId: string;
        state: "accepted" | "queued" | "running" | "waiting" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
        motivation: "explicit-task" | "self-exploration";
        sourceInboundId: string;
    };
    private findMessageTask;
    private messageIntent;
    nativeResultAccess(id: string): Promise<NativeExpressionAccess>;
    messageTaskStatus(context: ExecutionContextV3, pluginId: string, raw: unknown): {
        taskId: string;
        runId: string;
        state: "accepted" | "queued" | "running" | "waiting" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
        version: number;
        taskVersion: number;
        intentVersion: number;
        taskState: "completed" | "active" | "paused";
        title: string;
        goal: string;
        motivation: "explicit-task" | "self-exploration" | "unknown" | "conversation-invitation" | "maintenance" | "mixed";
        resultCurrent: boolean;
        phase: {
            phase: z.core.util.JSONType | undefined;
            startedAt: string;
            deadlineAt: string | number | boolean | z.core.util.JSONType[] | {
                [key: string]: z.core.util.JSONType;
            } | null;
            elapsedMs: number;
        } | null;
        assessment: {
            goalStatus: "met" | "partial" | "unmet" | "uncertain";
            next: "deliver" | "continue" | "wait" | "capability-change";
            at: string;
        } | null;
        delivery: {
            deliveryId: string;
            runId: string;
            taskId: string;
            state: "accepted" | "interrupted" | "rendering" | "ready" | "sending" | "partial" | "uncertain" | "verifying" | "sent" | "not-sent" | "rejected";
            version: number;
            receiptId: string | null;
            error: string | null;
        } | null;
        blocking: boolean;
        objections: {
            id: string;
            category: "scope" | "none" | "preference" | "method" | "premise" | "missing-information";
            blocking: boolean;
            resolved: boolean;
        }[];
    };
    feedbackSource(runId: string): {
        item: import("#dafeiyu/contracts").PendingMessage;
        taskId: string;
        state: "accepted" | "queued" | "running" | "waiting" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
        error: string | null;
        operations: {
            state: "unknown" | "started" | "finished";
            status: "unknown" | "failed" | "cancelled" | "partial" | "succeeded" | null;
            effects: "unknown" | "none" | "confirmed" | null;
        }[];
    } | null;
    private assessmentStatus;
    reconcileCapabilityChange(raw: unknown): {
        accepted: boolean;
        resumedRunId: null;
    } | {
        accepted: boolean;
        resumedRunId: string;
    };
    controlMessageTask(context: ExecutionContextV3, pluginId: string, raw: unknown): z.core.util.JSONType;
    authorizeResource(context: ExecutionContextV3, pluginId: string, scene: Conversation): void;
    explicitTaskInstruction(context: ExecutionContextV3, pluginId: string): {
        text: string;
        sourceId: string;
        sourceHash: string;
    } | null;
    private motivation;
    private evidenceFor;
    private repository;
    private policy;
    private externalTaskSource;
    /** The same exact qualification controls native visibility, invocation and delegated local writes. */
    private externalActionAllowed;
    private externalAuthorization;
    private externalDescription;
    /** Read-only provenance check; it never creates a TaskRef, live grant, operation or new dispatch. */
    externalTaskSourceCurrent(raw: unknown, expectedOwner: string): boolean;
    authorizeExternalTask(context: ExecutionContextV3, pluginId: string): ExternalTaskAuthority;
    private ref;
    private taskRef;
    private resolve;
    private resolveTask;
    producer(raw: string, options?: unknown): Readonly<{
        createTask: (raw: unknown) => Readonly<{
            id: string;
        }>;
        taskState: (ref: TaskRef) => {
            id: string;
            agentId: string;
            version: number;
            epoch: number;
            status: "completed" | "active" | "paused";
            title: string;
            goal: string;
        };
        submitTask: (raw: unknown, task?: TaskRef) => {
            task: Readonly<{
                id: string;
            }>;
            run: Readonly<{
                id: string;
            }>;
            state: "accepted" | "queued" | "running" | "waiting" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
        };
        openTask: (id: string) => Readonly<{
            id: string;
        }>;
        updateTask: (ref: TaskRef, input: unknown) => {
            id: string;
            agentId: string;
            version: number;
            epoch: number;
            status: "completed" | "active" | "paused";
            title: string;
            goal: string;
        };
        resolveObjection: (ref: TaskRef, input: unknown) => unknown;
        restoreRun: (id: string) => Readonly<{
            id: string;
        }>;
        status: (ref: RunRef) => {
            id: string;
            taskId: string | null;
            state: "accepted" | "queued" | "running" | "waiting" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
            version: number;
            result: {
                sessionId: string;
                messageSeq: number;
                turnEndSeq: number;
                textHash: string;
            } | null;
            error: string | null;
            checkpoints: string[];
            operations: {
                id: string;
                action: string;
                state: "unknown" | "started" | "finished";
                status: "unknown" | "failed" | "cancelled" | "partial" | "succeeded" | null;
                effects: "unknown" | "none" | "confirmed" | null;
                receipts: {
                    id: string;
                    kind: string;
                }[];
            }[];
        };
        readResult: (ref: RunRef) => Promise<string | null>;
        cancel: (ref: RunRef, input: unknown) => {
            id: string;
            taskId: string | null;
            state: "accepted" | "queued" | "running" | "waiting" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
            version: number;
            result: {
                sessionId: string;
                messageSeq: number;
                turnEndSeq: number;
                textHash: string;
            } | null;
            error: string | null;
            checkpoints: string[];
            operations: {
                id: string;
                action: string;
                state: "unknown" | "started" | "finished";
                status: "unknown" | "failed" | "cancelled" | "partial" | "succeeded" | null;
                effects: "unknown" | "none" | "confirmed" | null;
                receipts: {
                    id: string;
                    kind: string;
                }[];
            }[];
        };
        pause: (ref: RunRef, input: unknown) => {
            id: string;
            taskId: string | null;
            state: "accepted" | "queued" | "running" | "waiting" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
            version: number;
            result: {
                sessionId: string;
                messageSeq: number;
                turnEndSeq: number;
                textHash: string;
            } | null;
            error: string | null;
            checkpoints: string[];
            operations: {
                id: string;
                action: string;
                state: "unknown" | "started" | "finished";
                status: "unknown" | "failed" | "cancelled" | "partial" | "succeeded" | null;
                effects: "unknown" | "none" | "confirmed" | null;
                receipts: {
                    id: string;
                    kind: string;
                }[];
            }[];
        };
        resume: (ref: TaskRef, raw: unknown) => {
            task: Readonly<{
                id: string;
            }>;
            run: Readonly<{
                id: string;
            }>;
            state: "accepted" | "queued" | "running" | "waiting" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
        };
        acceptWake: (raw: unknown, task: TaskRef) => {
            task: Readonly<{
                id: string;
            }>;
            run: Readonly<{
                id: string;
            }>;
            state: "accepted" | "queued" | "running" | "waiting" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
        };
    }>;
    bindWake(provider: WakeAuthorityProvider): () => void;
    /** An explicitly planned wake may return to its original QQ conversation; it is a new wake, never a replayed inbound. */
    private messageSourceForWake;
    private wakeOrigins;
    private wakeSources;
    bindLifecycle(owner: string, receive: (event: MaintenanceLifecycle) => void): () => void;
    private validateWakeChain;
    captureActivity(context: ExecutionContextV3, pluginId: string): ActivityAnchor;
    captureMediaReply(context: ExecutionContextV3, pluginId: string, payloadHash: string, access: PersonaAccess): {
        schemaVersion: 1;
        id: string;
        runId: string;
        operationId: string;
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
        intentVersion: number;
        hash: string;
    };
    mediaReplyFacts(raw: unknown): {
        authority: {
            schemaVersion: 1;
            id: string;
            runId: string;
            operationId: string;
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
            intentVersion: number;
            hash: string;
        };
        body: {
            id: string;
            schemaVersion: 1;
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
            intentVersion: number;
            runId: string;
            operationId: string;
            kind: "media-reply-authority";
            payloadHash: string;
            inboundHash: string | null;
            foundationHash: string;
            policy: {
                producer: string;
                id: string;
                hash: string;
            };
            action: {
                owner: string;
                id: string;
                version: string;
                pluginVersion: string;
                hash: string;
            };
            dependencies: ({
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
            sources: ({
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
            })[];
        };
        run: StoredRun;
        execution: PersonaAccess;
        guard: () => void;
    };
    maintenanceAnchor(runId: string, taskId: string, epoch: number): ActivityAnchor;
    activityAnchorStatus(raw: unknown): {
        state: 'valid' | 'pending' | 'stale';
        code: string | null;
    };
    private checkActivityAnchor;
    private submit;
    private accept;
    recover(): void;
    activate(): void;
    private status;
    private control;
    private schedule;
    private process;
    private previousContinuity;
    private captureContinuity;
    private bindAction;
    conversationActions(run: StoredRun, producer: string, signal: AbortSignal, guard: () => void): NativeAction[];
    conversationSnapshot(producer: string): {
        policyId: string;
        authority: {
            id: string;
            producers: string[];
            actions: string[];
            allowLocalWrite: boolean;
            sourceRules: string[];
            resources: {
                channel: string;
                account: string;
                kind: "private" | "group" | "local";
                id: string;
            }[];
            externalActions?: {
                extensionId: string;
                actionId: string;
                actionVersion: string;
            }[] | undefined;
        } | null;
        actions: {
            id: string;
            owner: string;
            version: string;
            input: Record<string, unknown>;
            effects: "read" | "local-write" | "external-write";
        }[];
    };
    authority(context: ExecutionContextV3, pluginId: string, effect?: 'read' | 'local-write'): ExecutionContextV3;
    private inputsFor;
    /** Recovery may use only the same bound inputs, never a later task revision or another origin. */
    trialInputs(run: StoredRun): readonly ExecutionInput[];
    personaAccess(context: ExecutionContextV3, pluginId: string, effect: 'read' | 'local-write'): PersonaAccess;
    flushEvents(): void;
    whenIdle(): Promise<void>;
    get health(): {
        active: number;
        queued: number;
        error: string | null;
    };
    get foregroundPending(): number;
}
export {};
