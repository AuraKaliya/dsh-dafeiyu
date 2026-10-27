import { z } from 'zod';
export declare const MaintenanceLifecycleSchema: z.ZodObject<{
    id: z.ZodUUID;
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
    taskEpoch: z.ZodNumber;
    origin: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"message">;
        inboundId: z.ZodUUID;
        conversation: z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                private: "private";
                group: "group";
                local: "local";
            }>;
            id: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"native">;
        producerId: z.ZodString;
        requestId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"wake">;
        producerId: z.ZodString;
        scheduleId: z.ZodString;
        scheduleVersion: z.ZodNumber;
        occurrenceId: z.ZodString;
        dueAt: z.ZodISODateTime;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"continuation">;
        parentRunId: z.ZodUUID;
        checkpointId: z.ZodUUID;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"maintenance">;
        producerId: z.ZodString;
        requestId: z.ZodString;
    }, z.core.$strict>], "kind">;
    motivation: z.ZodObject<{
        kind: z.ZodEnum<{
            "explicit-task": "explicit-task";
            "self-exploration": "self-exploration";
            unknown: "unknown";
            "conversation-invitation": "conversation-invitation";
            maintenance: "maintenance";
            mixed: "mixed";
        }>;
        basis: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    type: z.ZodEnum<{
        "run.running": "run.running";
        "run.completed": "run.completed";
        "run.waiting": "run.waiting";
        "run.failed": "run.failed";
        "run.cancelled": "run.cancelled";
        "run.interrupted": "run.interrupted";
        "evidence.changed": "evidence.changed";
    }>;
    goal: z.ZodString;
    at: z.ZodISODateTime;
    operations: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        action: z.ZodString;
        status: z.ZodEnum<{
            unknown: "unknown";
            failed: "failed";
            partial: "partial";
            cancelled: "cancelled";
            succeeded: "succeeded";
            started: "started";
        }>;
        effects: z.ZodEnum<{
            unknown: "unknown";
            none: "none";
            confirmed: "confirmed";
        }>;
        completeness: z.ZodEnum<{
            unknown: "unknown";
            complete: "complete";
            partial: "partial";
        }>;
    }, z.core.$strict>>;
    omittedOperations: z.ZodNumber;
    assessmentSource: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "kind">>;
}, z.core.$strict>;
export type MaintenanceLifecycle = z.infer<typeof MaintenanceLifecycleSchema>;
export declare const MaintenanceRequestInputSchema: z.ZodObject<{
    requestId: z.ZodString;
    sources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "kind">>;
    reason: z.ZodString;
    targets: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        version: z.ZodNumber;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export declare const MaintenanceSnapshotSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
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
    taskEpoch: z.ZodNumber;
    runId: z.ZodUUID;
    requestId: z.ZodString;
    reason: z.ZodString;
    goal: z.ZodString;
    motivation: z.ZodObject<{
        kind: z.ZodEnum<{
            "explicit-task": "explicit-task";
            "self-exploration": "self-exploration";
            unknown: "unknown";
            "conversation-invitation": "conversation-invitation";
            maintenance: "maintenance";
            mixed: "mixed";
        }>;
        basis: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    sources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "kind">>;
    history: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    targets: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        version: z.ZodNumber;
    }, z.core.$strict>>;
    event: z.ZodNullable<z.ZodObject<{
        id: z.ZodUUID;
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
        taskEpoch: z.ZodNumber;
        origin: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"message">;
            inboundId: z.ZodUUID;
            conversation: z.ZodObject<{
                channel: z.ZodString;
                account: z.ZodString;
                kind: z.ZodEnum<{
                    private: "private";
                    group: "group";
                    local: "local";
                }>;
                id: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"native">;
            producerId: z.ZodString;
            requestId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"wake">;
            producerId: z.ZodString;
            scheduleId: z.ZodString;
            scheduleVersion: z.ZodNumber;
            occurrenceId: z.ZodString;
            dueAt: z.ZodISODateTime;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"continuation">;
            parentRunId: z.ZodUUID;
            checkpointId: z.ZodUUID;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"maintenance">;
            producerId: z.ZodString;
            requestId: z.ZodString;
        }, z.core.$strict>], "kind">;
        motivation: z.ZodObject<{
            kind: z.ZodEnum<{
                "explicit-task": "explicit-task";
                "self-exploration": "self-exploration";
                unknown: "unknown";
                "conversation-invitation": "conversation-invitation";
                maintenance: "maintenance";
                mixed: "mixed";
            }>;
            basis: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>;
        type: z.ZodEnum<{
            "run.running": "run.running";
            "run.completed": "run.completed";
            "run.waiting": "run.waiting";
            "run.failed": "run.failed";
            "run.cancelled": "run.cancelled";
            "run.interrupted": "run.interrupted";
            "evidence.changed": "evidence.changed";
        }>;
        goal: z.ZodString;
        at: z.ZodISODateTime;
        operations: z.ZodArray<z.ZodObject<{
            id: z.ZodUUID;
            action: z.ZodString;
            status: z.ZodEnum<{
                unknown: "unknown";
                failed: "failed";
                partial: "partial";
                cancelled: "cancelled";
                succeeded: "succeeded";
                started: "started";
            }>;
            effects: z.ZodEnum<{
                unknown: "unknown";
                none: "none";
                confirmed: "confirmed";
            }>;
            completeness: z.ZodEnum<{
                unknown: "unknown";
                complete: "complete";
                partial: "partial";
            }>;
        }, z.core.$strict>>;
        omittedOperations: z.ZodNumber;
        assessmentSource: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
        }, z.core.$strict>], "kind">>;
    }, z.core.$strict>>;
    watermark: z.ZodString;
    createdAt: z.ZodISODateTime;
    expiresAt: z.ZodISODateTime;
    omittedSources: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export type MaintenanceSnapshot = z.infer<typeof MaintenanceSnapshotSchema>;
export declare const MaintenanceStateSchema: z.ZodEnum<{
    failed: "failed";
    completed: "completed";
    cancelled: "cancelled";
    ready: "ready";
    running: "running";
    "waiting-scheduler": "waiting-scheduler";
    stale: "stale";
}>;
export type MaintenanceState = z.infer<typeof MaintenanceStateSchema>;
export declare const ExperienceContentSchema: z.ZodObject<{
    observation: z.ZodString;
    action: z.ZodString;
    outcome: z.ZodString;
    interpretation: z.ZodString;
    conditions: z.ZodArray<z.ZodString>;
    unknowns: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const ExperienceRevisionSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    version: z.ZodNumber;
    state: z.ZodEnum<{
        proposed: "proposed";
        held: "held";
        rejected: "rejected";
        withdrawn: "withdrawn";
        accepted: "accepted";
    }>;
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
    taskEpoch: z.ZodNumber;
    runId: z.ZodUUID;
    maintenanceId: z.ZodUUID;
    goal: z.ZodString;
    motivation: z.ZodObject<{
        kind: z.ZodEnum<{
            "explicit-task": "explicit-task";
            "self-exploration": "self-exploration";
            unknown: "unknown";
            "conversation-invitation": "conversation-invitation";
            maintenance: "maintenance";
            mixed: "mixed";
        }>;
        basis: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    content: z.ZodObject<{
        observation: z.ZodString;
        action: z.ZodString;
        outcome: z.ZodString;
        interpretation: z.ZodString;
        conditions: z.ZodArray<z.ZodString>;
        unknowns: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    contentRef: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    supports: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "kind">>;
    counters: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "kind">>;
    dependencies: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "kind">>;
    rootSources: z.ZodArray<z.ZodString>;
    reason: z.ZodString;
    createdAt: z.ZodISODateTime;
    policy: z.ZodLiteral<"experience-e-v1">;
    evidenceStatus: z.ZodLiteral<"source-bound-inference">;
}, z.core.$strict>;
export type ExperienceRevision = z.infer<typeof ExperienceRevisionSchema>;
export declare const ExperienceRelationSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        supports: "supports";
        counters: "counters";
        revises: "revises";
        "same-entity": "same-entity";
        "interest-related": "interest-related";
    }>;
    from: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    to: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    reason: z.ZodString;
}, z.core.$strict>;
export declare const ExperienceReviewSchema: z.ZodObject<{
    requestId: z.ZodString;
    id: z.ZodUUID;
    expectedVersion: z.ZodNumber;
    state: z.ZodEnum<{
        held: "held";
        rejected: "rejected";
        withdrawn: "withdrawn";
        accepted: "accepted";
    }>;
    reason: z.ZodString;
}, z.core.$strict>;
/** Model suggestions never contain authority, program outcomes, confidence scores or adoption commands. */
export declare const MaintenanceAnalysisSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    summary: z.ZodString;
    gaps: z.ZodArray<z.ZodString>;
    experiences: z.ZodArray<z.ZodObject<{
        content: z.ZodObject<{
            observation: z.ZodString;
            action: z.ZodString;
            outcome: z.ZodString;
            interpretation: z.ZodString;
            conditions: z.ZodArray<z.ZodString>;
            unknowns: z.ZodArray<z.ZodString>;
        }, z.core.$strict>;
        supports: z.ZodArray<z.ZodObject<{
            sourceId: z.ZodString;
            quote: z.ZodString;
        }, z.core.$strict>>;
        counters: z.ZodArray<z.ZodObject<{
            sourceId: z.ZodString;
            quote: z.ZodString;
        }, z.core.$strict>>;
        target: z.ZodNullable<z.ZodObject<{
            id: z.ZodUUID;
            version: z.ZodNumber;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    relations: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            supports: "supports";
            counters: "counters";
            revises: "revises";
            "same-entity": "same-entity";
            "interest-related": "interest-related";
        }>;
        from: z.ZodObject<{
            sourceId: z.ZodString;
            quote: z.ZodString;
        }, z.core.$strict>;
        to: z.ZodObject<{
            sourceId: z.ZodString;
            quote: z.ZodString;
        }, z.core.$strict>;
        reason: z.ZodString;
    }, z.core.$strict>>;
    persona: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            interest: "interest";
            preference: "preference";
            view: "view";
            habit: "habit";
            relationship: "relationship";
            "value-application": "value-application";
        }>;
        text: z.ZodString;
        applicability: z.ZodString;
        reason: z.ZodString;
        supports: z.ZodArray<z.ZodObject<{
            sourceId: z.ZodString;
            quote: z.ZodString;
        }, z.core.$strict>>;
        counters: z.ZodArray<z.ZodObject<{
            sourceId: z.ZodString;
            quote: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type MaintenanceAnalysis = z.infer<typeof MaintenanceAnalysisSchema>;
export declare const MaintenanceSchedulingItemSchema: z.ZodObject<{
    id: z.ZodUUID;
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
    taskEpoch: z.ZodNumber;
    runId: z.ZodUUID;
    watermark: z.ZodString;
    expiresAt: z.ZodISODateTime;
    state: z.ZodEnum<{
        failed: "failed";
        completed: "completed";
        cancelled: "cancelled";
        ready: "ready";
        running: "running";
        "waiting-scheduler": "waiting-scheduler";
        stale: "stale";
    }>;
    version: z.ZodNumber;
    reason: z.ZodString;
    retainedSources: z.ZodNumber;
    omittedSources: z.ZodNumber;
}, z.core.$strict>;
export type MaintenanceSchedulingItem = z.infer<typeof MaintenanceSchedulingItemSchema>;
/** Program-only metadata bridge. It conveys no content-reading or execution authority. */
export interface MemoryMaintenanceSchedulingPort {
    ready(): boolean;
    pending(after: number, limit: number): {
        items: MaintenanceSchedulingItem[];
        next: number | null;
    };
    inspect(id: string): MaintenanceSchedulingItem | null;
    coalesce(id: string): MaintenanceSchedulingItem | null;
    settleMetadata(id: string): boolean;
    connect(): () => void;
}
