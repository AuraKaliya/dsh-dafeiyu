import { z } from 'zod';
export declare const ActivityTimeZoneSchema: z.ZodString;
export declare const QuietWindowSchema: z.ZodObject<{
    start: z.ZodString;
    end: z.ZodString;
}, z.core.$strict>;
export declare const ActivityTriggerSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"once">;
    at: z.ZodISODateTime;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"interval">;
    anchorAt: z.ZodISODateTime;
    intervalMs: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"condition">;
    event: z.ZodEnum<{
        "task-settled": "task-settled";
        "memory-pending": "memory-pending";
        "resource-restored": "resource-restored";
    }>;
    key: z.ZodString;
}, z.core.$strict>], "kind">;
export declare const ActivityConfigSchema: z.ZodObject<{
    tickMs: z.ZodDefault<z.ZodNumber>;
    minIntervalMs: z.ZodDefault<z.ZodNumber>;
    maxPlans: z.ZodDefault<z.ZodNumber>;
    maxConcurrent: z.ZodDefault<z.ZodNumber>;
    maxActiveMs: z.ZodDefault<z.ZodNumber>;
    dailyActiveMs: z.ZodDefault<z.ZodNumber>;
    backoffBaseMs: z.ZodDefault<z.ZodNumber>;
    maxBackoffMs: z.ZodDefault<z.ZodNumber>;
    timeZone: z.ZodDefault<z.ZodString>;
    quiet: z.ZodDefault<z.ZodArray<z.ZodObject<{
        start: z.ZodString;
        end: z.ZodString;
    }, z.core.$strict>>>;
    explorationPolicy: z.ZodDefault<z.ZodString>;
    maintenancePolicy: z.ZodDefault<z.ZodString>;
    maintenance: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
/** Serialized anchor is a locator; core must resolve and verify its durable record. */
export declare const ActivityAnchorSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    runId: z.ZodUUID;
    operationId: z.ZodUUID;
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
    intentVersion: z.ZodNumber;
    kind: z.ZodEnum<{
        maintenance: "maintenance";
        execution: "execution";
    }>;
    hash: z.ZodString;
}, z.core.$strict>;
export type ActivityAnchor = z.infer<typeof ActivityAnchorSchema>;
export declare const ActivityScheduleBodySchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    agentId: z.ZodString;
    version: z.ZodNumber;
    owner: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    purpose: z.ZodEnum<{
        maintenance: "maintenance";
        exploration: "exploration";
    }>;
    goal: z.ZodString;
    basis: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    anchor: z.ZodNullable<z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        id: z.ZodUUID;
        runId: z.ZodUUID;
        operationId: z.ZodUUID;
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
        intentVersion: z.ZodNumber;
        kind: z.ZodEnum<{
            maintenance: "maintenance";
            execution: "execution";
        }>;
        hash: z.ZodString;
    }, z.core.$strict>>;
    maintenanceId: z.ZodNullable<z.ZodUUID>;
    policyId: z.ZodString;
    configHash: z.ZodString;
    taskGeneration: z.ZodNumber;
    trigger: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"once">;
        at: z.ZodISODateTime;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"interval">;
        anchorAt: z.ZodISODateTime;
        intervalMs: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"condition">;
        event: z.ZodEnum<{
            "task-settled": "task-settled";
            "memory-pending": "memory-pending";
            "resource-restored": "resource-restored";
        }>;
        key: z.ZodString;
    }, z.core.$strict>], "kind">;
    missed: z.ZodEnum<{
        skip: "skip";
        coalesce: "coalesce";
        "run-once": "run-once";
    }>;
    timeZone: z.ZodString;
    quiet: z.ZodArray<z.ZodObject<{
        start: z.ZodString;
        end: z.ZodString;
    }, z.core.$strict>>;
    state: z.ZodEnum<{
        active: "active";
        paused: "paused";
        cancelled: "cancelled";
    }>;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type ActivityScheduleBody = z.infer<typeof ActivityScheduleBodySchema>;
export declare const ActivityDomainEventSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<{
        "task-settled": "task-settled";
        "memory-pending": "memory-pending";
        "resource-restored": "resource-restored";
    }>;
    key: z.ZodString;
    watermark: z.ZodString;
    occurredAt: z.ZodISODateTime;
    origin: z.ZodEnum<{
        maintenance: "maintenance";
        primary: "primary";
        activity: "activity";
    }>;
    causedBy: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export type ActivityDomainEvent = z.infer<typeof ActivityDomainEventSchema>;
export declare const WakeOccurrenceBodySchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodString;
    scheduleId: z.ZodUUID;
    scheduleVersion: z.ZodNumber;
    taskId: z.ZodUUID;
    taskEpoch: z.ZodNumber;
    taskGeneration: z.ZodNumber;
    dueAt: z.ZodISODateTime;
    createdAt: z.ZodISODateTime;
    reason: z.ZodEnum<{
        time: "time";
        maintenance: "maintenance";
        condition: "condition";
        resume: "resume";
    }>;
    eventId: z.ZodNullable<z.ZodString>;
    configHash: z.ZodString;
}, z.core.$strict>;
export type WakeOccurrenceBody = z.infer<typeof WakeOccurrenceBodySchema>;
export declare const ActivityOccurrenceStateSchema: z.ZodEnum<{
    failed: "failed";
    waiting: "waiting";
    blocked: "blocked";
    completed: "completed";
    pending: "pending";
    cancelled: "cancelled";
    accepted: "accepted";
    running: "running";
}>;
export type ActivityOccurrenceState = z.infer<typeof ActivityOccurrenceStateSchema>;
