import { z } from 'zod';
export declare const RecentStateSaveSchema: z.ZodObject<{
    requestId: z.ZodString;
    id: z.ZodOptional<z.ZodUUID>;
    expectedVersion: z.ZodNumber;
    text: z.ZodString;
    topics: z.ZodArray<z.ZodString>;
    motivation: z.ZodEnum<{
        unknown: "unknown";
        mixed: "mixed";
        delegated: "delegated";
        "self-directed": "self-directed";
    }>;
    status: z.ZodEnum<{
        active: "active";
        withdrawn: "withdrawn";
        dormant: "dormant";
    }>;
    expiresAt: z.ZodISODateTime;
}, z.core.$strict>;
export declare const RecentStatePublishSchema: z.ZodObject<{
    requestId: z.ZodString;
    id: z.ZodUUID;
    expectedVersion: z.ZodNumber;
    view: z.ZodString;
}, z.core.$strict>;
export declare const RecentStateUnpublishSchema: z.ZodObject<{
    requestId: z.ZodString;
    publication: z.ZodUUID;
    expectedVersion: z.ZodNumber;
}, z.core.$strict>;
export declare const RecentStateRecordSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    version: z.ZodNumber;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    runId: z.ZodUUID;
    operationId: z.ZodString;
    text: z.ZodString;
    topics: z.ZodArray<z.ZodString>;
    motivation: z.ZodEnum<{
        unknown: "unknown";
        mixed: "mixed";
        delegated: "delegated";
        "self-directed": "self-directed";
    }>;
    originMotivation: z.ZodString;
    status: z.ZodEnum<{
        active: "active";
        withdrawn: "withdrawn";
        dormant: "dormant";
    }>;
    expiresAt: z.ZodISODateTime;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
    sources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    claimType: z.ZodLiteral<"self_report">;
}, z.core.$strict>;
export type RecentStateRecord = z.infer<typeof RecentStateRecordSchema>;
