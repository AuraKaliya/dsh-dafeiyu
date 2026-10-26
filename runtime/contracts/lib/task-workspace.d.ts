import { z } from 'zod';
import type { Conversation } from './conversation.js';
import type { ActionContext } from './index.js';
import type { MemoryObservation, ObservationAuthority, ObservationReceipt } from './observation.js';
import type { TimelineScope } from './history.js';
import type { TaskMemoryControl } from './task-memory.js';
import type { TaskExpressionControl } from './expression.js';
import type { TaskDeliveryControl } from './delivery.js';
export declare const TaskCreateSchema: z.ZodObject<{
    requestId: z.ZodString;
    title: z.ZodString;
    goal: z.ZodString;
}, z.core.$strict>;
export declare const TaskUpdateSchema: z.ZodObject<{
    requestId: z.ZodString;
    expectedVersion: z.ZodNumber;
    title: z.ZodOptional<z.ZodString>;
    goal: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        completed: "completed";
        active: "active";
        paused: "paused";
    }>>;
}, z.core.$strict>;
export declare const TaskSceneSchema: z.ZodObject<{
    requestId: z.ZodString;
    conversation: z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            local: "local";
            private: "private";
            group: "group";
        }>;
        id: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const TaskActivateSchema: z.ZodObject<{
    requestId: z.ZodString;
    conversation: z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            local: "local";
            private: "private";
            group: "group";
        }>;
        id: z.ZodString;
    }, z.core.$strict>;
    expectedVersion: z.ZodNumber;
}, z.core.$strict>;
export declare const TaskLinkSchema: z.ZodObject<{
    requestId: z.ZodString;
    conversation: z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            local: "local";
            private: "private";
            group: "group";
        }>;
        id: z.ZodString;
    }, z.core.$strict>;
    expectedVersion: z.ZodNumber;
    items: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        id: z.ZodUUID;
        revision: z.ZodNumber;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"observation">;
        id: z.ZodUUID;
    }, z.core.$strict>], "kind">>;
}, z.core.$strict>;
export declare const TaskBeginSchema: z.ZodObject<{
    requestId: z.ZodString;
    conversation: z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            local: "local";
            private: "private";
            group: "group";
        }>;
        id: z.ZodString;
    }, z.core.$strict>;
    slot: z.ZodString;
    expectedSlotVersion: z.ZodNumber;
    inputs: z.ZodArray<z.ZodUUID>;
}, z.core.$strict>;
export declare const TaskCompleteSchema: z.ZodObject<{
    requestId: z.ZodString;
    text: z.ZodString;
}, z.core.$strict>;
/** These identities are opaque core capabilities. A serialized id is not authority. */
export interface TaskReference {
    readonly id: string;
}
export interface TaskWorkTicket {
    readonly id: string;
}
export interface TaskController {
    readonly reference: TaskReference;
    readonly memory: TaskMemoryControl;
    readonly expression: TaskExpressionControl;
    readonly delivery: TaskDeliveryControl;
    read(): Record<string, unknown>;
    update(input: unknown): Record<string, unknown>;
}
export interface TaskPluginAPI {
    join(task: TaskReference, input: unknown, context?: ActionContext): Record<string, unknown>;
    activate(task: TaskReference | null, input: unknown, context?: ActionContext): Record<string, unknown>;
    link(task: TaskReference, input: unknown, context?: ActionContext): Record<string, unknown>;
    begin(task: TaskReference, input: unknown, context?: ActionContext): TaskWorkTicket;
    observe(ticket: TaskWorkTicket, input: unknown): ObservationReceipt;
    complete(ticket: TaskWorkTicket, input: unknown): Record<string, unknown>;
    view(task: TaskReference, conversation: Conversation, context?: ActionContext): Record<string, unknown>;
}
export interface TaskWorkspaceProvider {
    current(scope: TimelineScope): string | null;
    create(agentId: string, input: z.output<typeof TaskCreateSchema>): string;
    read(agentId: string, id: string): Record<string, unknown>;
    update(agentId: string, id: string, input: z.output<typeof TaskUpdateSchema>): Record<string, unknown>;
    join(authority: ObservationAuthority, id: string, input: z.output<typeof TaskSceneSchema>): Record<string, unknown>;
    activate(authority: ObservationAuthority, id: string | null, input: z.output<typeof TaskActivateSchema>): Record<string, unknown>;
    link(authority: ObservationAuthority, id: string, input: z.output<typeof TaskLinkSchema>): Record<string, unknown>;
    begin(authority: ObservationAuthority, id: string, input: z.output<typeof TaskBeginSchema>): string;
    observe(authority: ObservationAuthority, jobId: string, input: MemoryObservation): ObservationReceipt;
    complete(authority: ObservationAuthority, jobId: string, input: z.output<typeof TaskCompleteSchema>): Record<string, unknown>;
    view(authority: ObservationAuthority, id: string): Record<string, unknown>;
}
