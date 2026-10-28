import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import { SessionSeq } from '@deepseek-ai/dsh-session';
import type { GenerateOptions, UserMessage } from '@deepseek-ai/dsh-llm';
import type { CompactionProvider } from '#dafeiyu/contracts';
import { z } from 'zod';
import type { SourceDependency } from '#dafeiyu/contracts';
import type { ContextEvidenceView } from './context-runtime.js';
import type { HistoryFrame } from './history-frame.js';
export interface CompactionBinding {
    owner: string;
    version: string;
    provider: CompactionProvider;
}
export type CompactionAudit = (item: HistoryFrame, data: Record<string, import('#dafeiyu/contracts').Json>, seqs: number[]) => void;
declare const turnSchema: z.ZodObject<{
    traceId: z.ZodString;
    route: z.ZodString;
    owner: z.ZodString;
    version: z.ZodString;
    epoch: z.ZodString;
    taskId: z.ZodNullable<z.ZodString>;
    versions: z.ZodRecord<z.ZodString, z.ZodNumber>;
    seqs: z.ZodArray<z.ZodNumber>;
    complete: z.ZodBoolean;
    ephemeral: z.ZodBoolean;
    precision: z.ZodOptional<z.ZodLiteral<"sources-v1">>;
}, z.core.$strict>;
type Turn = z.infer<typeof turnSchema>;
type Check = {
    status: string;
    pressure: number;
    target: number;
    saved: number;
    at: number;
    policy: string;
};
declare module '@deepseek-ai/dsh-session' {
    interface PluginRecordMap {
        'plugin:dafeiyu/turn-open': {
            traceId: string;
            route: string;
        };
        'plugin:dafeiyu/turn-seal': Turn;
        'plugin:dafeiyu/compaction-check': Check;
    }
}
declare const recordSchema: z.ZodUnion<[z.ZodUnion<[z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"plugin:dafeiyu/turn-open">;
    seq: z.ZodPipe<z.ZodNumber, z.ZodTransform<SessionSeq, number>>;
    data: z.ZodObject<{
        traceId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"plugin:dafeiyu/turn-seal">;
    seq: z.ZodPipe<z.ZodNumber, z.ZodTransform<SessionSeq, number>>;
    data: z.ZodObject<{
        traceId: z.ZodString;
        route: z.ZodString;
        owner: z.ZodString;
        version: z.ZodString;
        epoch: z.ZodString;
        taskId: z.ZodNullable<z.ZodString>;
        versions: z.ZodRecord<z.ZodString, z.ZodNumber>;
        seqs: z.ZodArray<z.ZodNumber>;
        complete: z.ZodBoolean;
        ephemeral: z.ZodBoolean;
        precision: z.ZodOptional<z.ZodLiteral<"sources-v1">>;
    }, z.core.$strict>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"plugin:dafeiyu/compaction-check">;
    seq: z.ZodPipe<z.ZodNumber, z.ZodTransform<SessionSeq, number>>;
    data: z.ZodObject<{
        status: z.ZodString;
        pressure: z.ZodNumber;
        target: z.ZodNumber;
        saved: z.ZodNumber;
        at: z.ZodNumber;
        policy: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strip>], "type">, z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"plugin:dafeiyu/source-record">;
    seq: z.ZodPipe<z.ZodNumber, z.ZodTransform<SessionSeq, number>>;
    data: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        targetSeq: z.ZodNumber;
        hash: z.ZodString;
        parents: z.ZodArray<z.ZodNumber>;
        dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
        }, z.core.$strict>], "kind">>;
        requestSeq: z.ZodOptional<z.ZodNumber>;
        agentId: z.ZodString;
        route: z.ZodString;
        traceId: z.ZodString;
        owner: z.ZodString;
        producerVersion: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"plugin:dafeiyu/request-sources">;
    seq: z.ZodPipe<z.ZodNumber, z.ZodTransform<SessionSeq, number>>;
    data: z.ZodObject<{
        turn: z.ZodNumber;
        step: z.ZodNumber;
        parents: z.ZodArray<z.ZodNumber>;
        dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
        }, z.core.$strict>], "kind">>;
        contexts: z.ZodDefault<z.ZodArray<z.ZodObject<{
            owner: z.ZodString;
            region: z.ZodString;
            id: z.ZodString;
            version: z.ZodString;
            hash: z.ZodString;
            sources: z.ZodArray<z.ZodObject<{
                ref: z.ZodString;
                version: z.ZodString;
                hash: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>>>;
        agentId: z.ZodString;
        route: z.ZodString;
        traceId: z.ZodString;
        owner: z.ZodString;
        producerVersion: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strip>], "type">]>, z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"plugin:dafeiyu/summary-manifest">;
    seq: z.ZodPipe<z.ZodNumber, z.ZodTransform<SessionSeq, number>>;
    data: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        compactionId: z.ZodString;
        sessionId: z.ZodString;
        agentId: z.ZodString;
        route: z.ZodString;
        owner: z.ZodString;
        producerVersion: z.ZodString;
        epoch: z.ZodString;
        taskId: z.ZodNullable<z.ZodString>;
        versions: z.ZodRecord<z.ZodString, z.ZodNumber>;
        policy: z.ZodString;
        policyHash: z.ZodString;
        model: z.ZodObject<{
            provider: z.ZodString;
            model: z.ZodString;
        }, z.core.$strict>;
        createdAt: z.ZodNumber;
        groups: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            taskId: z.ZodNullable<z.ZodString>;
            inputs: z.ZodArray<z.ZodObject<{
                seq: z.ZodNumber;
                role: z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>;
                hash: z.ZodString;
            }, z.core.$strict>>;
            dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
            }, z.core.$strict>], "kind">>;
            semanticDepth: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        fragments: z.ZodArray<z.ZodObject<{
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
            id: z.ZodString;
            version: z.ZodLiteral<1>;
            group: z.ZodString;
        }, z.core.$strict>>;
        composition: z.ZodOptional<z.ZodObject<{
            mode: z.ZodLiteral<"lossless-pack-v1">;
            generation: z.ZodNumber;
            parents: z.ZodArray<z.ZodObject<{
                ref: z.ZodString;
                manifestSeq: z.ZodNumber;
                viewSeq: z.ZodNumber;
                checkpointSeq: z.ZodNumber;
                revision: z.ZodNumber;
                hash: z.ZodString;
            }, z.core.$strict>>;
            lineage: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                parents: z.ZodArray<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        rewrite: z.ZodOptional<z.ZodObject<{
            mode: z.ZodEnum<{
                fusion: "fusion";
                rebuild: "rebuild";
            }>;
            generation: z.ZodNumber;
            parent: z.ZodObject<{
                ref: z.ZodString;
                manifestSeq: z.ZodNumber;
                viewSeq: z.ZodNumber;
                checkpointSeq: z.ZodNumber;
                revision: z.ZodNumber;
                hash: z.ZodString;
            }, z.core.$strict>;
            targetGroup: z.ZodString;
            inputs: z.ZodArray<z.ZodObject<{
                seq: z.ZodNumber;
                role: z.ZodEnum<{
                    user: "user";
                    assistant: "assistant";
                }>;
                hash: z.ZodString;
            }, z.core.$strict>>;
            dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
            }, z.core.$strict>], "kind">>;
            consecutive: z.ZodNumber;
            maxChars: z.ZodNumber;
            inputHash: z.ZodString;
            result: z.ZodObject<{
                fragment: z.ZodObject<{
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
                qualifiers: z.ZodArray<z.ZodObject<{
                    seq: z.ZodNumber;
                    role: z.ZodEnum<{
                        user: "user";
                        assistant: "assistant";
                    }>;
                    start: z.ZodNumber;
                    end: z.ZodNumber;
                    text: z.ZodString;
                }, z.core.$strict>>;
                verification: z.ZodObject<{
                    compatible: z.ZodLiteral<true>;
                    faithful: z.ZodLiteral<true>;
                    issues: z.ZodArray<z.ZodString>;
                }, z.core.$strict>;
                model: z.ZodObject<{
                    provider: z.ZodString;
                    model: z.ZodString;
                    reasoningEffort: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>;
            }, z.core.$strict>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"plugin:dafeiyu/summary-view">;
    seq: z.ZodPipe<z.ZodNumber, z.ZodTransform<SessionSeq, number>>;
    data: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        manifestSeq: z.ZodNumber;
        revision: z.ZodNumber;
        previousViewSeq: z.ZodNullable<z.ZodNumber>;
        previousCheckpointSeq: z.ZodNullable<z.ZodNumber>;
        active: z.ZodArray<z.ZodString>;
        contentHash: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strip>], "type">]>;
/** DSH's supported plugin-record seam preserves these non-surface records across resume. */
export declare function readCompactionEvents(session: Session): (SessionEvent | z.infer<typeof recordSchema>)[];
export declare function committedSummary(session: Session, id: string, text: string): boolean;
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'dafeiyu-compaction-retired': {
            kind: 'dafeiyu-compaction-retired';
        };
    }
}
export declare const capsuleSchema: z.ZodObject<{
    kind: z.ZodLiteral<"dafeiyu-incremental-summary">;
    schemaVersion: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>]>;
    agentId: z.ZodString;
    route: z.ZodString;
    owner: z.ZodString;
    version: z.ZodString;
    epoch: z.ZodString;
    taskId: z.ZodNullable<z.ZodString>;
    versions: z.ZodRecord<z.ZodString, z.ZodNumber>;
    policy: z.ZodString;
    policyHash: z.ZodString;
    model: z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
    }, z.core.$strict>;
    sources: z.ZodArray<z.ZodObject<{
        seq: z.ZodNumber;
        hash: z.ZodString;
    }, z.core.$strict>>;
    summary: z.ZodString;
    createdAt: z.ZodNumber;
    dependencies: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "kind">>>;
}, z.core.$strict>;
/** Pair this marker immediately with a model-free replacement, including M4/M5A withdrawals. */
export declare function priceRetirement(ctx: Context, session: Session, seqs: readonly SessionSeq[]): void;
/** Owned-session policy only. DSH remains the history, model transport and replacement owner. */
export declare class CompactionRuntime {
    private readonly ctx;
    private readonly agentId;
    private readonly binding;
    private readonly audit;
    private item;
    private agent;
    private initial;
    private admitted;
    private checkedSeq;
    private readonly provenance;
    private pendingInput;
    constructor(ctx: Context, agentId: string, binding: () => CompactionBinding | undefined, audit: CompactionAudit, context: ContextEvidenceView);
    private scope;
    private epoch;
    begin(item: HistoryFrame, agent: Agent): void;
    seal(): void;
    end(): void;
    private valid;
    private capsuleValid;
    private clean;
    private record;
    private check;
    guard(options: GenerateOptions, admit?: boolean): void;
    private legacyEpoch;
    validateDependencies(dependencies: readonly SourceDependency[]): boolean;
    exposedDependencies(): readonly SourceDependency[];
    sourceCurrent(seq: number): boolean;
    expectInput(message: UserMessage): void;
    fragmentViewCurrent(id: string, text: string): boolean;
    readSummaryReference(ref: string): {
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
}
export {};
