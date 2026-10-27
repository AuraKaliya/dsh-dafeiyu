import type { Context } from '@deepseek-ai/cordis';
import type { AgentOptions } from '@deepseek-ai/dsh-agent';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { ActionCapability, Json, PendingMessage, PersonaSnapshot, SourceRef } from '#dafeiyu/contracts';
import type { ContextCoordinator } from './context.js';
import type { FeedbackValidator } from './feedback-runtime.js';
import type { FeedbackMeta } from '#dafeiyu/contracts';
import type { CompactionBinding, CompactionAudit } from './compaction-runtime.js';
import { NativeRuntime } from './native-runtime.js';
import type { TaskExecutionFrame, NativeAction, ConversationExecutionFrame } from './execution-frame.js';
export interface RuntimeDelivery {
    id: string;
    guard: () => void;
    finalize: (result: RunResult, guard: () => void) => Promise<void>;
}
export interface ActionResult {
    value: Json;
    feedback: FeedbackMeta | null;
}
export interface BoundAction {
    readonly definition: ActionCapability;
    execute(args: unknown, signal: AbortSignal): Promise<ActionResult>;
}
export interface RunResult {
    readonly text: string;
    readonly sources: SourceRef[];
    readonly resultRef?: import('./runtime-store.js').RunResultRef;
}
/** Safe evidence identifiers from a failed turn; no raw provider exception or reasoning text. */
export declare class DshRunError extends Error {
    readonly sources: SourceRef[];
    constructor(sources: SourceRef[]);
}
/** Uses DSH's real agent loop, scoped tools, persistence and event vocabulary. No private LLM loop. */
export declare class DshRuntime {
    private readonly ctx;
    private readonly model;
    private readonly cwd;
    private readonly coordinator;
    private readonly validateFeedback;
    private readonly agentId;
    private readonly compactionBinding;
    private readonly compactionAudit;
    private readonly handles;
    private readonly native;
    private meterLoading;
    constructor(ctx: Context, model: AgentOptions, cwd: string, coordinator: ContextCoordinator, validateFeedback: FeedbackValidator, agentId: string, compactionBinding: () => CompactionBinding | undefined, compactionAudit: CompactionAudit, managedProjection?: boolean);
    run(item: PendingMessage, persona: PersonaSnapshot, actions: readonly BoundAction[], signal: AbortSignal, channelDescription?: string, delivery?: RuntimeDelivery, nativeActions?: readonly NativeAction[], allowEmpty?: () => boolean): Promise<RunResult>;
    runFrame(frame: TaskExecutionFrame): ReturnType<NativeRuntime['run']>;
    runFrame(frame: ConversationExecutionFrame): Promise<RunResult>;
    private runConversation;
    close(): Promise<void>;
    runExecution(frame: TaskExecutionFrame): Promise<{
        text: string;
        resultRef: {
            sessionId: string;
            messageSeq: import("@deepseek-ai/dsh-session").SessionSeq;
            turnEndSeq: import("@deepseek-ai/dsh-session").SessionSeq;
            textHash: string;
        };
    }>;
    assessExecution(frame: TaskExecutionFrame, draft: Awaited<ReturnType<DshRuntime['runExecution']>>, facts: Json): Promise<{
        assessment: {
            goalStatus: "met" | "partial" | "unmet" | "uncertain";
            summary: string;
            evidenceIds: string[];
            limitations: string[];
            unfinished: string[];
            requiredCapabilities: string[];
            retainExperience: boolean;
            next: "deliver" | "continue" | "wait" | "capability-change";
        };
        resultRef: {
            sessionId: string;
            messageSeq: import("@deepseek-ai/dsh-session").SessionSeq;
            turnEndSeq: import("@deepseek-ai/dsh-session").SessionSeq;
            textHash: string;
        };
    }>;
    readResult(ref: import('./runtime-store.js').RunResultRef): Promise<string>;
    summaryCommitted(sessionId: string, id: string, text: string): boolean;
    summarySourcesCurrent(sessionId: string, dependencies: readonly import('#dafeiyu/contracts').SourceDependency[]): boolean;
    exposedDependencies(sessionId: string): readonly import('#dafeiyu/contracts').SourceDependency[] | null;
    sourceCurrent(sessionId: string, seq: number): boolean;
    fragmentViewCurrent(sessionId: string, id: string, text: string): boolean;
    readSummaryReference(sessionId: string, ref: string): {
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
        sessionId: SessionId;
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
                        kind: "pending" | "decision" | "result" | "fact" | "constraint" | "correction" | "uncertainty" | "note";
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
                kind: "pending" | "decision" | "result" | "fact" | "constraint" | "correction" | "uncertainty" | "note";
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
}
