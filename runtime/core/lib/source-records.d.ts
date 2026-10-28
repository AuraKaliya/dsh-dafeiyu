import { z } from 'zod';
import { SessionSeq } from '@deepseek-ai/dsh-session';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { SourceDependency } from '#dafeiyu/contracts';
export declare const digestSource: (text: string) => string;
export declare const dependenciesSchema: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
export declare function unionDependencies(...groups: readonly (readonly SourceDependency[])[]): SourceDependency[];
export declare const sourceRecordSchema: z.ZodObject<{
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
declare const requestSchema: z.ZodObject<{
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
export type SourceRecord = z.infer<typeof sourceRecordSchema>;
export declare const provenanceRecordSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
}, z.core.$strip>], "type">;
declare module '@deepseek-ai/dsh-session' {
    interface PluginRecordMap {
        'plugin:dafeiyu/source-invalid': {
            traceId: string;
            phase: 'dispatch' | 'stream';
            dependency: SourceDependency;
            dependencyHash: string;
            reason: string;
        };
        'plugin:dafeiyu/source-record': SourceRecord;
        'plugin:dafeiyu/request-sources': z.infer<typeof requestSchema>;
    }
}
export declare function readProvenance(session: Session): ({
    type: "plugin:dafeiyu/source-record";
    seq: SessionSeq;
    data: {
        schemaVersion: 1;
        targetSeq: number;
        hash: string;
        parents: number[];
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
        agentId: string;
        route: string;
        traceId: string;
        owner: string;
        producerVersion: string;
        requestSeq?: number | undefined;
    };
} | {
    type: "plugin:dafeiyu/request-sources";
    seq: SessionSeq;
    data: {
        turn: number;
        step: number;
        parents: number[];
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
        contexts: {
            owner: string;
            region: string;
            id: string;
            version: string;
            hash: string;
            sources: {
                ref: string;
                version: string;
                hash: string;
            }[];
        }[];
        agentId: string;
        route: string;
        traceId: string;
        owner: string;
        producerVersion: string;
    };
})[];
export declare function eventText(event: SessionEvent | undefined): string | null;
export {};
