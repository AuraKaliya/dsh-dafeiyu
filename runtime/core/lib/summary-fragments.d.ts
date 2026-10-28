import { z } from 'zod';
import { SessionSeq } from '@deepseek-ai/dsh-session';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { SourceDependency, TimelineScope, SemanticRequest } from '#dafeiyu/contracts';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'dafeiyu-summary-view': {
            kind: 'dafeiyu-summary-view';
            compactionId: string;
        };
    }
}
export declare const rewriteSchema: z.ZodObject<{
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
}, z.core.$strict>;
export type SummaryRewrite = z.infer<typeof rewriteSchema>;
export declare const fragmentManifestSchema: z.ZodObject<{
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
export type FragmentManifest = z.infer<typeof fragmentManifestSchema>;
export declare const fragmentViewSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    manifestSeq: z.ZodNumber;
    revision: z.ZodNumber;
    previousViewSeq: z.ZodNullable<z.ZodNumber>;
    previousCheckpointSeq: z.ZodNullable<z.ZodNumber>;
    active: z.ZodArray<z.ZodString>;
    contentHash: z.ZodString;
}, z.core.$strict>;
export type FragmentView = z.infer<typeof fragmentViewSchema>;
export declare const fragmentRecordSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
}, z.core.$strip>], "type">;
declare module '@deepseek-ai/dsh-session' {
    interface PluginRecordMap {
        'plugin:dafeiyu/summary-manifest': FragmentManifest;
        'plugin:dafeiyu/summary-view': FragmentView;
    }
}
export declare function parseSummaryReference(value: string): {
    bundle: string;
    fragment: string | null;
    revision: number | null;
} | null;
export declare function summaryReference(seq: number, m: FragmentManifest): string;
export declare const fragmentCapsuleSchema: z.ZodObject<{
    kind: z.ZodLiteral<"dafeiyu-incremental-summary">;
    schemaVersion: z.ZodLiteral<3>;
    ref: z.ZodString;
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
        ref: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare function renderFragmentView(seq: number, m: FragmentManifest, active: readonly string[]): string;
type Artifact = z.infer<typeof fragmentRecordSchema>;
/** Proofs are log-only; this index is disposable and never an authority for deletion state. */
export declare function readSummaryArtifacts(session: Session): readonly Artifact[];
export interface ResolvedFragmentView {
    manifest: FragmentManifest;
    manifestSeq: SessionSeq;
    view: FragmentView;
    viewSeq: SessionSeq;
    checkpoint: SessionEvent<'user/message'>;
    text: string;
}
export declare function summaryGeneration(m: FragmentManifest): number;
/** Deterministic composition. No model sees the other fragments; dependencies stay local.
 * Equality includes original event identities, task and the complete source-state closure. */
export declare function composeFragmentContent(views: readonly ResolvedFragmentView[]): {
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
    fragments: {
        kind: "pending" | "result" | "fact" | "decision" | "constraint" | "correction" | "uncertainty" | "note";
        text: string;
        id: string;
        version: 1;
        group: string;
    }[];
    composition: {
        mode: "lossless-pack-v1";
        generation: number;
        parents: {
            ref: string;
            manifestSeq: number;
            viewSeq: number;
            checkpointSeq: number;
            revision: number;
            hash: string;
        }[];
        lineage: {
            id: string;
            parents: string[];
        }[];
    };
};
/** Rebuild reads raw records only. Even a retired mixed group may yield independent valid
 * leaves, but it never yields old summary text. Caller validates live source state. */
export declare function rawRewriteInputs(session: Session, parent: ResolvedFragmentView, inputs: SummaryRewrite['inputs']): {
    sources: {
        text: string;
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
};
export declare function rewriteRequest(session: Session, parent: ResolvedFragmentView, rewrite: Pick<SummaryRewrite, 'mode' | 'targetGroup' | 'inputs' | 'maxChars'>): SemanticRequest;
export declare function rewrittenContent(session: Session, parent: ResolvedFragmentView, rewrite: SummaryRewrite): {
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
    fragments: {
        kind: "pending" | "result" | "fact" | "decision" | "constraint" | "correction" | "uncertainty" | "note";
        text: string;
        id: string;
        version: 1;
        group: string;
    }[];
};
/** Historical proof validity is separate from current surface selection. A captured parent
 * is checked at the child creation boundary, never against its later display membership. */
export declare function resolveFragmentProof(session: Session, reference: string, scope: TimelineScope, before?: import("@deepseek-ai/dsh-session").SessionLogOffset, reservedNodes?: number): ResolvedFragmentView | null;
/** Normal reads require an active view; historical proof inspection cannot grant access. */
export declare function resolveFragmentView(session: Session, reference: string, scope: TimelineScope): ResolvedFragmentView | null;
/** Display lifecycle only. Neither 'active' nor 'superseded' asserts live source validity. */
export declare function summarySelectionState(session: Session, reference: string, scope: TimelineScope): 'active' | 'withdrawn' | 'superseded' | 'unselected' | 'unproven';
export declare function activeFragments(view: ResolvedFragmentView): {
    kind: "pending" | "result" | "fact" | "decision" | "constraint" | "correction" | "uncertainty" | "note";
    text: string;
    id: string;
    version: 1;
    group: string;
}[];
export declare function fragmentDependencies(view: ResolvedFragmentView, ids?: readonly string[]): SourceDependency[];
/** Uniform developer-side proof inspection; never pass this expanded object to the model. */
export declare function expandedFragmentProof(view: ResolvedFragmentView): {
    kind: "dafeiyu-incremental-summary";
    schemaVersion: 2;
    version: string;
    agentId: string;
    route: string;
    owner: string;
    epoch: string;
    taskId: string | null;
    versions: Record<string, number>;
    policy: string;
    policyHash: string;
    model: {
        provider: string;
        model: string;
    };
    createdAt: number;
    sources: {
        seq: number;
        hash: string;
    }[];
    summary: string;
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
};
export {};
