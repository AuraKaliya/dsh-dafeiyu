import { Context, Service } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type { ActionContext, OperationScope, Extension, ExtensionHandle, Json, Reply } from '#dafeiyu/contracts';
import { Journal } from '#dafeiyu/journal';
import type { ContextRequest } from '#dafeiyu/contracts';
import type { Conversation } from '#dafeiyu/contracts';
import type { MessageTaskBinding } from '#dafeiyu/contracts';
import type { NativeExpressionPort } from '#dafeiyu/contracts';
import type { MediaPort, MediaAccess, MediaSourceProvider, MediaAssetRef, MediaReplyAccess } from '#dafeiyu/contracts';
import type { ExtensionV3, ExtensionHandleV3 } from '#dafeiyu/contracts';
import type { ExecutionOptions } from './execution-coordinator.js';
import type { PersonaTrialCompletionStatus } from './persona-runtime.js';
export type { PersonaTrialCompletionStatus } from './persona-runtime.js';
export { readFoundation } from './foundation.js';
export { initializeCoreStorage } from './storage-initialization.js';
import type { TaskRepositoryPort, ExecutionContextV3, WakeAuthorityProvider, MemoryGrowthProvider, PersonaProvider, ExecutionMemoryPort } from '#dafeiyu/contracts';
import type { CapabilityObservationPort, PersonaAccess, PersonaSourceRef, SourceDependency, TimelineScope } from '#dafeiyu/contracts';
export type { ExecutionOptions } from './execution-coordinator.js';
export { EXECUTION_MESSAGE_SOURCE } from './native-runtime.js';
export type { CompactionBinding } from './compaction-runtime.js';
export { readCompactionEvents } from './compaction-runtime.js';
export { readProvenance } from './provenance.js';
export { readSummaryArtifacts, resolveFragmentView, resolveFragmentProof, summarySelectionState, expandedFragmentProof, activeFragments, fragmentDependencies } from './summary-fragments.js';
export declare const name = "dafeiyu-core";
export declare const inject: string[];
declare const ConfigSchema: z.ZodObject<{
    agentId: z.ZodString;
    dataDir: z.ZodString;
    personaFile: z.ZodString;
    provider: z.ZodString;
    model: z.ZodString;
    reasoningEffort: z.ZodOptional<z.ZodString>;
    lifecycleMode: z.ZodDefault<z.ZodEnum<{
        legacy: "legacy";
        managed: "managed";
    }>>;
    turnTimeoutMs: z.ZodDefault<z.ZodNumber>;
    deliveryTimeoutMs: z.ZodDefault<z.ZodNumber>;
    phaseTimeouts: z.ZodPrefault<z.ZodObject<{
        assessment: z.ZodDefault<z.ZodNumber>;
        render: z.ZodDefault<z.ZodNumber>;
        verification: z.ZodDefault<z.ZodNumber>;
        feedback: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    context: z.ZodPrefault<z.ZodObject<{
        maxBytes: z.ZodDefault<z.ZodNumber>;
        requestMaxBytes: z.ZodDefault<z.ZodNumber>;
        outputReserveBytes: z.ZodDefault<z.ZodNumber>;
        prepareTimeoutMs: z.ZodDefault<z.ZodNumber>;
        regions: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
            maxBytes: z.ZodDefault<z.ZodNumber>;
            priority: z.ZodDefault<z.ZodNumber>;
            required: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strict>>>;
        assembly: z.ZodPrefault<z.ZodObject<{
            mode: z.ZodDefault<z.ZodEnum<{
                legacy: "legacy";
                unified: "unified";
            }>>;
            deadlineMs: z.ZodDefault<z.ZodNumber>;
            recall: z.ZodPrefault<z.ZodObject<{
                enabled: z.ZodDefault<z.ZodBoolean>;
                strategy: z.ZodDefault<z.ZodEnum<{
                    lexical: "lexical";
                    hybrid: "hybrid";
                }>>;
                candidates: z.ZodDefault<z.ZodNumber>;
                limit: z.ZodDefault<z.ZodNumber>;
                maxBytes: z.ZodDefault<z.ZodNumber>;
                timeoutMs: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strict>>;
            background: z.ZodPrefault<z.ZodObject<{
                enabled: z.ZodDefault<z.ZodBoolean>;
                windowMs: z.ZodDefault<z.ZodNumber>;
                limit: z.ZodDefault<z.ZodNumber>;
                maxBytes: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strict>>;
            recentState: z.ZodPrefault<z.ZodObject<{
                enabled: z.ZodDefault<z.ZodBoolean>;
                shared: z.ZodDefault<z.ZodBoolean>;
                maxBytes: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type Config = z.input<typeof ConfigSchema>;
declare module '@deepseek-ai/cordis' {
    interface Context {
        dafeiyu: DafeiyuService;
    }
}
/** Owns a logical persona and its independent conversations; extensions own platform-specific work. */
export declare class DafeiyuService extends Service {
    private expressionPreferences;
    private nativeTaskDelivery;
    /** Program-only provenance checks for Growth views; these methods return no source body. */
    captureRecentStateSources(context: ExecutionContextV3, owner: string): readonly SourceDependency[];
    recentStateSourcesCurrent(runId: string, sources: readonly SourceDependency[]): boolean;
    phaseTimeouts(): {
        assessment: number;
        render: number;
        verification: number;
        feedback: number;
    };
    registerHarnessSection(name: string): () => void;
    originRecallScope(view: import('#dafeiyu/contracts').ExecutionView, owner: string): {
        conversation: Conversation;
        query: string;
        stamp: string;
    } | null;
    originRecallCurrent(runId: string, scene: Conversation, stamp: string): boolean;
    contextBudget(): {
        maxBytes: number;
        requestMaxBytes: number;
        outputReserveBytes: number;
        prepareTimeoutMs: number;
        regions: Record<string, {
            maxBytes: number;
            priority: number;
            required: boolean;
        }>;
        assembly: {
            mode: "legacy" | "unified";
            deadlineMs: number;
            recall: {
                enabled: boolean;
                strategy: "lexical" | "hybrid";
                candidates: number;
                limit: number;
                maxBytes: number;
                timeoutMs: number;
            };
            background: {
                enabled: boolean;
                windowMs: number;
                limit: number;
                maxBytes: number;
            };
            recentState: {
                enabled: boolean;
                shared: boolean;
                maxBytes: number;
            };
        };
    };
    inspectContextRequest(options: import('@deepseek-ai/dsh-llm').GenerateOptions, maximum: number, reserve: number, known?: import('@deepseek-ai/dsh-llm').LlmResolvedModelInfo): Promise<{
        messageBreakdown: {
            system: number;
            currentInput: number;
            history: number;
            toolResults: number;
            runtimeContext: number;
            mediaBlocks: number;
        };
        estimatedInputTokens: number;
        tokenMeasurement: string;
        modelContextWindow: number | null;
        reservedOutputTokens: number | null;
        estimateOnly: boolean;
        modelLimitsKnown: boolean;
        bytes: number;
        reserveBytes: number;
        maximumBytes: number;
        categories: {
            messages: number;
            tools: number;
            toolHistory: number;
        };
        withinBudget: boolean;
        measurement: "utf8-serialized-bytes";
    }>;
    contextAssembly(): {
        mode: "legacy" | "unified";
        deadlineMs: number;
        recall: {
            enabled: boolean;
            strategy: "lexical" | "hybrid";
            candidates: number;
            limit: number;
            maxBytes: number;
            timeoutMs: number;
        };
        background: {
            enabled: boolean;
            windowMs: number;
            limit: number;
            maxBytes: number;
        };
        recentState: {
            enabled: boolean;
            shared: boolean;
            maxBytes: number;
        };
    };
    contextStatus(context: ActionContext, offset?: number, limit?: number): Json;
    private closedNativeDelivery;
    deliverMessageTaskResult(runId: string): Promise<{
        deliveryId: string;
        runId: string;
        taskId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
        version: number;
        receiptId: string | null;
        error: string | null;
    } | null>;
    messageTaskDeliveryStatus(runId: string): {
        deliveryId: string;
        runId: string;
        taskId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
        version: number;
        receiptId: string | null;
        error: string | null;
    } | null;
    taskDeliveryBusy(): boolean;
    reconcileCapabilityChange(raw: unknown): {
        accepted: boolean;
        resumedRunId: string;
    } | {
        accepted: boolean;
        resumedRunId: null;
    };
    private nativeExpressionPort;
    private mediaPort;
    private readonly mediaReplyAccesses;
    bindNativeExpression(port: NativeExpressionPort): () => void;
    bindMedia(port: MediaPort): () => void;
    registerMediaProvider(provider: MediaSourceProvider): () => void;
    mediaAccess(context: ExecutionContextV3, owner: string, raw: unknown): MediaAccess;
    acquireMedia(context: ExecutionContextV3, owner: string, input: unknown): Promise<{
        schemaVersion: 1;
        id: string;
        version: number;
        kind: "image" | "audio" | "video" | "document";
        sha256: string;
        bytes: number;
        mime: string;
    }>;
    inspectMedia(context: ExecutionContextV3, owner: string, ref: MediaAssetRef): unknown;
    readMedia(context: ExecutionContextV3, owner: string, input: unknown): Promise<unknown>;
    originalImage(context: ExecutionContextV3, owner: string, exposureId: string): Promise<{
        data: Uint8Array;
        mime: string;
        source: import("#dafeiyu/contracts").MediaSourceDescription;
    }>;
    prepareReplyMedia(context: ExecutionContextV3, owner: string, input: unknown): Promise<unknown>;
    mediaVoiceEvidence(context: ExecutionContextV3, owner: string, exposureId: string): {
        text: string;
        evidence: import("#dafeiyu/contracts").MediaVoiceEvidence;
    };
    mediaVoiceCurrent(evidence: import('#dafeiyu/contracts').MediaVoiceEvidence): boolean;
    captureMediaReplyAuthority(context: ExecutionContextV3, owner: string, payloadHash: string): {
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
    prepareMediaReplyAccess(authority: unknown, reply: Reply, signal: AbortSignal): Promise<MediaReplyAccess>;
    validateMediaReplyAccess(access: MediaReplyAccess): void;
    ownsMediaReplyAccess(access: MediaReplyAccess): boolean;
    private targetPersona;
    private prepareNativeMediaReplyAccess;
    validateNativeMediaReplyAuthority(authority: unknown, access: import('#dafeiyu/contracts').NativeExpressionAccess): string;
    nativeMediaObservedMaterial(access: PersonaAccess, source: PersonaSourceRef, target: Conversation, view: string): {
        kind: "reported" | "inference";
        stamp: string;
    } | null;
    nativeMediaTargetMaterial(access: import('#dafeiyu/contracts').NativeExpressionAccess): {
        draftId: string;
        draftVersion: number;
        sourceStamp: string;
        parts: ({
            kind: "asset";
            delivery: "image" | "record" | "file";
            asset: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "image" | "audio" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
            name: string | null;
        } | {
            kind: "final-voice";
        })[];
    } | null;
    prepareMessageTaskExpression(runId: string): Promise<{
        id: string;
        version: number;
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
        question: string;
        evidence: {
            id: string;
            kind: "reported" | "inference";
            text: string;
        }[];
        sourceStamp: string;
        resultIncluded: boolean;
        media?: {
            draftId: string;
            draftVersion: number;
            sourceStamp: string;
            parts: ({
                kind: "asset";
                delivery: "image" | "record" | "file";
                asset: {
                    schemaVersion: 1;
                    id: string;
                    version: number;
                    kind: "image" | "audio" | "video" | "document";
                    sha256: string;
                    bytes: number;
                    mime: string;
                };
                name: string | null;
            } | {
                kind: "final-voice";
            })[];
        } | undefined;
    }>;
    openMessageTaskExpression(runId: string, packetId: string): Promise<{
        id: string;
        version: number;
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
        question: string;
        evidence: {
            id: string;
            kind: "reported" | "inference";
            text: string;
        }[];
        sourceStamp: string;
        resultIncluded: boolean;
        media?: {
            draftId: string;
            draftVersion: number;
            sourceStamp: string;
            parts: ({
                kind: "asset";
                delivery: "image" | "record" | "file";
                asset: {
                    schemaVersion: 1;
                    id: string;
                    version: number;
                    kind: "image" | "audio" | "video" | "document";
                    sha256: string;
                    bytes: number;
                    mime: string;
                };
                name: string | null;
            } | {
                kind: "final-voice";
            })[];
        } | undefined;
    }>;
    withdrawMessageTaskExpression(runId: string, packetId: string, version: number): Promise<void>;
    readonly journal: Journal;
    private readonly config;
    private readonly runtime;
    private readonly harness;
    bindHarnessCatalog(provider: Pick<import('#dafeiyu/contracts').DshToolsPort, 'catalog'>): () => void;
    private readonly contexts;
    private readonly personas;
    private readonly taskCoordinator;
    private readonly taskDelivery;
    private readonly extensions;
    private readonly queues;
    private readonly scheduled;
    private readonly actionScopes;
    private readonly controller;
    private fatal;
    private closing;
    private closed;
    private readonly gate;
    private admissionHeld;
    private readonly readyListeners;
    private readonly registryV3;
    private repositoryPort;
    private executionMemoryPort;
    private capabilityObservationPort;
    private executions;
    private runStore;
    private scheduler;
    private executionRecovered;
    private conversationRuns;
    constructor(ctx: Context, config: Config);
    recover(): void;
    activate(options?: {
        deferWork?: boolean;
        resumeMessages?: boolean;
        resumeExecutions?: boolean;
    }): void;
    private releaseAdmission;
    onReady(listener: () => void): () => void;
    quiesce(): void;
    cancelRunning(): void;
    get lifecycleState(): import("#dafeiyu/contracts").ServicePhase;
    private features;
    bindMessageTasks(binding: MessageTaskBinding): () => void;
    submitMessageTask(context: ExecutionContextV3, pluginId: string, input: unknown): {
        taskId: string;
        runId: string;
        state: "accepted" | "interrupted" | "waiting" | "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
        motivation: "explicit-task" | "self-exploration";
        sourceInboundId: string;
    };
    messageTaskStatus(context: ExecutionContextV3, pluginId: string, input: unknown): {
        delivery: {
            deliveryId: string;
            runId: string;
            taskId: string;
            state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
            version: number;
            receiptId: string | null;
            error: string | null;
        } | null;
        taskId: string;
        runId: string;
        state: "accepted" | "interrupted" | "waiting" | "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
        version: number;
        taskVersion: number;
        intentVersion: number;
        taskState: "completed" | "active" | "paused";
        title: string;
        goal: string;
        motivation: "unknown" | "explicit-task" | "self-exploration" | "maintenance" | "conversation-invitation" | "mixed";
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
            goalStatus: "partial" | "uncertain" | "met" | "unmet";
            next: "continue" | "deliver" | "wait" | "capability-change";
            at: string;
        } | null;
        blocking: boolean;
        objections: {
            id: string;
            category: "scope" | "none" | "preference" | "method" | "premise" | "missing-information";
            blocking: boolean;
            resolved: boolean;
        }[];
    };
    controlMessageTask(context: ExecutionContextV3, pluginId: string, input: unknown): z.core.util.JSONType;
    capabilityManifest(): {
        features: string[];
        actions: {
            id: string;
            owner: string;
            pluginVersion: string;
            version: string;
            effects: "read" | "local-write" | "external-write";
            requiresTask: boolean;
        }[];
    };
    private configuredCapabilities;
    get accepting(): boolean;
    private dependenciesReady;
    private assertAccepting;
    bindTaskRepository(port: TaskRepositoryPort): () => void;
    bindGrowthProvider(provider: MemoryGrowthProvider): () => void;
    /** @deprecated Compatibility alias; both names bind the same single provider. */
    bindPersonaProvider(provider: PersonaProvider): () => void;
    assertPersonaTrialAuthority(authority: unknown, input: unknown): void;
    personaTrialAccess(authority: unknown, input: unknown): PersonaAccess;
    bindExecutionMemory(port: ExecutionMemoryPort): () => void;
    personaAccess(context: ExecutionContextV3, pluginId: string, effect?: 'read' | 'local-write'): PersonaAccess;
    bindCapabilityObservations(port: CapabilityObservationPort): () => void;
    capabilityResources(context: ExecutionContextV3, pluginId: string): readonly Conversation[];
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
    deliverPublicProgress(context: ExecutionContextV3, pluginId: string, raw: unknown): Promise<import('#dafeiyu/contracts').DeliveryResult>;
    authorizeCapabilityResource(context: ExecutionContextV3, pluginId: string, raw: unknown): Conversation;
    capabilityResourceCurrent(raw: unknown): boolean;
    capabilityPublicView(raw: unknown, view: string): boolean;
    capabilityTargetView(raw: unknown, view: string, target: Conversation, scope: unknown): {
        kind: "reported" | "inference";
        stamp: string;
    } | null;
    capabilityResourceEpoch(scope?: TimelineScope): string;
    capabilityResourceEpochWithout(providerId: string, scope?: TimelineScope): string;
    capabilityHistoryCurrent(scope: TimelineScope, deps: readonly SourceDependency[]): boolean;
    capabilityObservationCurrent(scope: TimelineScope, source: PersonaSourceRef, exposedHash?: string): boolean;
    mediaExpressionFence(access: PersonaAccess, target: Conversation, roots: readonly string[]): {
        allowed: boolean;
        stamp: string;
    };
    recordCapabilityObservation(context: ExecutionContextV3, pluginId: string, raw: unknown, options?: {
        readonly inheritExecutionHistory: true;
    }): {
        source: PersonaSourceRef;
        duplicate: boolean;
    };
    selectCapabilityObservation(context: ExecutionContextV3, pluginId: string, sceneInput: unknown, raw: unknown, actualView: string): Record<string, unknown>;
    personaContext(request: ContextRequest): readonly {
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
    configureExecution(raw: ExecutionOptions): void;
    recoverExecutions(): Promise<void>;
    /** Replays only missing completion records after providers are ready; never starts a model or reconstructs admission. */
    recoverPersonaTrials(): readonly PersonaTrialCompletionStatus[];
    executionProducer(id: string, options?: unknown): Readonly<{
        createTask: (raw: unknown) => Readonly<{
            id: string;
        }>;
        taskState: (ref: import("#dafeiyu/contracts").TaskRef) => {
            id: string;
            agentId: string;
            version: number;
            epoch: number;
            status: "completed" | "active" | "paused";
            title: string;
            goal: string;
        };
        submitTask: (raw: unknown, task?: import("#dafeiyu/contracts").TaskRef) => {
            task: Readonly<{
                id: string;
            }>;
            run: Readonly<{
                id: string;
            }>;
            state: "accepted" | "interrupted" | "waiting" | "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
        };
        openTask: (id: string) => Readonly<{
            id: string;
        }>;
        updateTask: (ref: import("#dafeiyu/contracts").TaskRef, input: unknown) => {
            id: string;
            agentId: string;
            version: number;
            epoch: number;
            status: "completed" | "active" | "paused";
            title: string;
            goal: string;
        };
        resolveObjection: (ref: import("#dafeiyu/contracts").TaskRef, input: unknown) => unknown;
        restoreRun: (id: string) => Readonly<{
            id: string;
        }>;
        status: (ref: import("#dafeiyu/contracts").RunRef) => {
            id: string;
            taskId: string | null;
            state: "accepted" | "interrupted" | "waiting" | "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
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
                status: "partial" | "failed" | "cancelled" | "unknown" | "succeeded" | null;
                effects: "unknown" | "none" | "confirmed" | null;
                receipts: {
                    id: string;
                    kind: string;
                }[];
            }[];
        };
        readResult: (ref: import("#dafeiyu/contracts").RunRef) => Promise<string | null>;
        cancel: (ref: import("#dafeiyu/contracts").RunRef, input: unknown) => {
            id: string;
            taskId: string | null;
            state: "accepted" | "interrupted" | "waiting" | "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
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
                status: "partial" | "failed" | "cancelled" | "unknown" | "succeeded" | null;
                effects: "unknown" | "none" | "confirmed" | null;
                receipts: {
                    id: string;
                    kind: string;
                }[];
            }[];
        };
        pause: (ref: import("#dafeiyu/contracts").RunRef, input: unknown) => {
            id: string;
            taskId: string | null;
            state: "accepted" | "interrupted" | "waiting" | "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
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
                status: "partial" | "failed" | "cancelled" | "unknown" | "succeeded" | null;
                effects: "unknown" | "none" | "confirmed" | null;
                receipts: {
                    id: string;
                    kind: string;
                }[];
            }[];
        };
        resume: (ref: import("#dafeiyu/contracts").TaskRef, raw: unknown) => {
            task: Readonly<{
                id: string;
            }>;
            run: Readonly<{
                id: string;
            }>;
            state: "accepted" | "interrupted" | "waiting" | "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
        };
        acceptWake: (raw: unknown, task: import("#dafeiyu/contracts").TaskRef) => {
            task: Readonly<{
                id: string;
            }>;
            run: Readonly<{
                id: string;
            }>;
            state: "accepted" | "interrupted" | "waiting" | "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
        };
    }>;
    bindWakeAuthority(provider: WakeAuthorityProvider): () => void;
    bindExecutionLifecycle(owner: string, receive: (event: import('#dafeiyu/contracts').MaintenanceLifecycle) => void): () => void;
    captureActivityAnchor(context: ExecutionContextV3, pluginId: string): {
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
        kind: "execution" | "maintenance";
        hash: string;
    };
    activityAnchorStatus(anchor: unknown): {
        state: "valid" | "pending" | "stale";
        code: string | null;
    };
    createMaintenanceAnchor(runId: string, taskId: string, epoch: number): {
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
        kind: "execution" | "maintenance";
        hash: string;
    };
    activityPressure(): {
        foregroundRuns: number;
        active: number;
        waiting: number;
        foregroundWaiting: number;
    };
    executionAuthority(context: ExecutionContextV3, pluginId: string): ExecutionContextV3;
    authorizeExternalTask(context: ExecutionContextV3, pluginId: string): import("#dafeiyu/contracts").ExternalTaskAuthority;
    externalTaskSourceCurrent(authorization: unknown, pluginId: string): boolean;
    explicitTaskInstruction(context: ExecutionContextV3, pluginId: string): {
        text: string;
        sourceId: string;
        sourceHash: string;
    } | null;
    executionEvents(context: ExecutionContextV3, pluginId: string): import("#dafeiyu/contracts").ExecutionEvent[];
    registerExtensionV3(extension: ExtensionV3): ExtensionHandleV3;
    private persona;
    private event;
    private assertOpen;
    /** Resolve an active invocation issued by this core. Model arguments cannot select a route or impersonate a context. */
    scopeFor(context: ActionContext): OperationScope;
    scopeForContext(request: ContextRequest): OperationScope;
    /** Trusted coordinator API, deliberately not a model tool. */
    createTaskWorkspace(input: unknown): import("#dafeiyu/contracts").TaskController;
    resumeTaskWorkspace(id: string): import("#dafeiyu/contracts").TaskController;
    setTaskMemoryPolicy(input: unknown): Record<string, unknown>;
    setTaskExpressionPolicy(input: unknown): Record<string, unknown>;
    private feedbackEntry;
    private observationEntry;
    private observationAuthority;
    private compactionBinding;
    /** Read-only source export gate for archived summary checkpoints. */
    compactionViewCurrent(scope: Pick<OperationScope, 'agentId' | 'route' | 'traceId'>, text: string, compactionId: string): boolean;
    summaryReference(context: ActionContext, ref: string): {
        status: "not_found";
        untrustedEvidence?: never;
        memoryUse?: never;
        ref?: never;
        revision?: never;
        sourceSeqs?: never;
        sessionId?: never;
        proof?: never;
    } | {
        status: "invalid_reference";
        untrustedEvidence?: never;
        memoryUse?: never;
        ref?: never;
        revision?: never;
        sourceSeqs?: never;
        sessionId?: never;
        proof?: never;
    } | {
        status: "stale_reference";
        untrustedEvidence?: never;
        memoryUse?: never;
        ref?: never;
        revision?: never;
        sourceSeqs?: never;
        sessionId?: never;
        proof?: never;
    } | {
        status: "not_exported";
        untrustedEvidence?: never;
        memoryUse?: never;
        ref?: never;
        revision?: never;
        sourceSeqs?: never;
        sessionId?: never;
        proof?: never;
    } | {
        status: "ok";
        untrustedEvidence: true;
        memoryUse: "derived-only";
        ref: string;
        revision: number;
        sourceSeqs: number[];
        sessionId: import("@deepseek-ai/dsh-session").SessionId;
        proof: {
            rewrite?: {
                mode: "fusion" | "rebuild";
                generation: number;
                parent: {
                    ref: string;
                    manifestSeq: number;
                    viewSeq: number;
                    checkpointSeq: number;
                    revision: number;
                    hash: string;
                };
                targetGroup: string;
                inputs: {
                    seq: number;
                    role: "user" | "assistant";
                    hash: string;
                }[];
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
                consecutive: number;
                maxChars: number;
                inputHash: string;
                result: {
                    fragment: {
                        kind: "pending" | "result" | "fact" | "decision" | "constraint" | "correction" | "uncertainty" | "note";
                        text: string;
                    };
                    qualifiers: {
                        seq: number;
                        role: "user" | "assistant";
                        start: number;
                        end: number;
                        text: string;
                    }[];
                    verification: {
                        compatible: true;
                        faithful: true;
                        issues: string[];
                    };
                    model: {
                        provider: string;
                        model: string;
                        reasoningEffort?: string | undefined;
                    };
                };
            };
            composition?: {
                lineage: {
                    id: string;
                    parents: string[];
                }[];
                parents: {
                    ref: string;
                    manifestSeq: number;
                    viewSeq: number;
                    checkpointSeq: number;
                    revision: number;
                    hash: string;
                }[];
                mode: "lossless-pack-v1";
                generation: number;
            };
            ref: string;
            revision: number;
            taskId: string | null;
            policy: string;
            model: {
                provider: string;
                model: string;
            };
            fragments: {
                ref: string;
                kind: "pending" | "result" | "fact" | "decision" | "constraint" | "correction" | "uncertainty" | "note";
                text: string;
                version: 1;
                group: string;
            }[];
            groups: {
                id: string;
                taskId: string | null;
                inputs: {
                    seq: number;
                    role: "user" | "assistant";
                    hash: string;
                }[];
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
                semanticDepth?: number | undefined;
            }[];
        };
    };
    historicalSourceCurrent(scope: Pick<OperationScope, 'agentId' | 'route'>, sessionId: string, seq: number): boolean;
    feedbackViewCurrent(scope: Pick<OperationScope, 'agentId' | 'route' | 'traceId'>, raw: unknown, text: string): boolean;
    /** Host-only durable authorization for read/analyze/commit work, never an ActionContext. */
    issueAnalysisGrant(context: ActionContext): string;
    analysisScope(grantId: string): OperationScope;
    revokeAnalysisGrant(grantId: string): void;
    analysisModelRoute(): Readonly<{
        reasoningEffort?: string;
        provider: string;
        model: string;
    }>;
    private recoveryModel;
    registerExtension(extension: Extension): ExtensionHandle;
    private schedule;
    private enqueueTaskDelivery;
    private notifyConversationFailure;
    private pendingReplyFacts;
    private replyStateFacts;
    private decideRepliesBeforeTurn;
    private resolvePendingReply;
    private replyRecoveryActions;
    private actions;
    private parseAction;
    private process;
    private messageProcessingSignal;
    private deliveryChannel;
    private validateRunPersona;
    private processMessage;
    /** Explicit retry only for definitely-not-sent replies; never runs the model or replays tool operations. */
    retryDelivery(id: string): void;
    getStatus(): {
        agentId: string;
        state: string;
        lifecycle: import("#dafeiyu/contracts").ServicePhase;
        error: string | null;
        execution: {
            active: number;
            queued: number;
            error: string | null;
        } | null;
        nativeDelivery: {
            total: number;
            pending: number;
            sent: number;
            partial: number;
            uncertain: number;
            blocked: number;
        } | null;
        extensions: string[];
        queuedRoutes: number;
        messages: {
            id: string;
            state: import("#dafeiyu/contracts").MessageState;
            sessionId: string;
        }[];
    };
    whenIdle(): Promise<void>;
    close(): Promise<void>;
}
/** DSH/Cordis lifecycle entry point. The installed host supplies all injected DSH services. */
export declare function apply(ctx: Context, config: Config): void;
