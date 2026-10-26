import { z } from 'zod';
export declare const ExecutionEventInputSchema: z.ZodObject<{
    agentId: z.ZodString;
    taskId: z.ZodUUID;
    runId: z.ZodUUID;
    route: z.ZodString;
    traceId: z.ZodString;
    operationId: z.ZodString;
    causedBy: z.ZodNullable<z.ZodString>;
    type: z.ZodString;
    plugin: z.ZodString;
    pluginVersion: z.ZodString;
    occurredAt: z.ZodISODateTime;
    sources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodEnum<{
            message: "message";
            event: "event";
        }>;
        id: z.ZodString;
        route: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"session">;
        id: z.ZodString;
        seq: z.ZodNumber;
        route: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    data: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
}, z.core.$strict>;
export declare const ExecutionEventSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<2>;
    id: z.ZodUUID;
    recordedAt: z.ZodISODateTime;
    visibility: z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
    }, z.core.$strict>;
    agentId: z.ZodString;
    taskId: z.ZodUUID;
    runId: z.ZodUUID;
    route: z.ZodString;
    traceId: z.ZodString;
    operationId: z.ZodString;
    causedBy: z.ZodNullable<z.ZodString>;
    type: z.ZodString;
    plugin: z.ZodString;
    pluginVersion: z.ZodString;
    occurredAt: z.ZodISODateTime;
    sources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodEnum<{
            message: "message";
            event: "event";
        }>;
        id: z.ZodString;
        route: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"session">;
        id: z.ZodString;
        seq: z.ZodNumber;
        route: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    data: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
}, z.core.$strict>;
export type NewExecutionEvent = z.infer<typeof ExecutionEventInputSchema>;
export type ExecutionEvent = z.infer<typeof ExecutionEventSchema> & {
    readonly seq: number;
};
