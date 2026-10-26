import { z } from 'zod';
export declare const TimelineQuerySchema: z.ZodObject<{
    query: z.ZodDefault<z.ZodString>;
    plugin: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodString>;
    actorId: z.ZodOptional<z.ZodString>;
    traceId: z.ZodOptional<z.ZodString>;
    operationId: z.ZodOptional<z.ZodString>;
    since: z.ZodOptional<z.ZodISODateTime>;
    until: z.ZodOptional<z.ZodISODateTime>;
    clock: z.ZodDefault<z.ZodEnum<{
        occurredAt: "occurredAt";
        recordedAt: "recordedAt";
    }>>;
    limit: z.ZodDefault<z.ZodNumber>;
    cursor: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type TimelineQuery = z.input<typeof TimelineQuerySchema>;
/** Issued by the core for one live action, never constructed from model arguments. */
export interface OperationScope {
    readonly agentId: string;
    readonly route: string;
    readonly traceId: string;
    readonly operationId: string;
    readonly startedEventId: string;
}
export interface TimelineScope {
    readonly agentId: string;
    readonly route: string;
}
