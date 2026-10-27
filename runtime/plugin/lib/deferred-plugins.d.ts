import { z } from 'zod';
import type { ExternalTaskAuthorization, Json } from '#dafeiyu/contracts';
declare const rowSchema: z.ZodObject<{
    id: z.ZodUUID;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
    state: z.ZodEnum<{
        queued: "queued";
        applying: "applying";
        applied: "applied";
        failed: "failed";
        "restart-required": "restart-required";
        unknown: "unknown";
    }>;
    ownerPid: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    hostPid: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    catalogVersion: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    arguments: z.ZodJSONSchema;
    authorization: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        runId: z.ZodUUID;
        operationId: z.ZodUUID;
        intentVersion: z.ZodNumber;
        parentRunId: z.ZodNullable<z.ZodUUID>;
        scope: z.ZodObject<{
            kind: z.ZodLiteral<"task">;
            agentId: z.ZodString;
            taskId: z.ZodUUID;
            scopeKey: z.ZodString;
        }, z.core.$strict>;
        goal: z.ZodString;
        motivation: z.ZodObject<{
            kind: z.ZodEnum<{
                unknown: "unknown";
                maintenance: "maintenance";
                "explicit-task": "explicit-task";
                "self-exploration": "self-exploration";
                "conversation-invitation": "conversation-invitation";
                mixed: "mixed";
            }>;
            basis: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>;
        policy: z.ZodObject<{
            producer: z.ZodString;
            id: z.ZodString;
            hash: z.ZodString;
        }, z.core.$strict>;
        action: z.ZodObject<{
            owner: z.ZodString;
            id: z.ZodString;
            version: z.ZodString;
            pluginVersion: z.ZodString;
            effects: z.ZodLiteral<"external-write">;
            hash: z.ZodString;
        }, z.core.$strict>;
        source: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"owner-message">;
            bindingId: z.ZodString;
            inboundId: z.ZodUUID;
            messageId: z.ZodString;
            messageHash: z.ZodString;
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
            senderId: z.ZodString;
            modality: z.ZodEnum<{
                text: "text";
                voice: "voice";
            }>;
            sourceHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"activity-wake">;
            origin: z.ZodObject<{
                kind: z.ZodLiteral<"wake">;
                producerId: z.ZodString;
                scheduleId: z.ZodString;
                scheduleVersion: z.ZodNumber;
                occurrenceId: z.ZodString;
                dueAt: z.ZodISODateTime;
            }, z.core.$strict>;
            anchor: z.ZodObject<{
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
            sourceHash: z.ZodString;
        }, z.core.$strict>], "kind">;
    }, z.core.$strict>;
    result: z.ZodNullable<z.ZodJSONSchema>;
}, z.core.$strict>;
export type DeferredPluginChange = z.infer<typeof rowSchema>;
/** A durable handoff to DSH's installer, after the originating reply and task have settled. */
export declare class DeferredPluginChanges {
    private readonly directory;
    private readonly dispatch;
    private readonly rows;
    private busy;
    constructor(directory: string, dispatch: (row: DeferredPluginChange) => Promise<Json>);
    private refresh;
    private save;
    enqueue(authorization: ExternalTaskAuthorization, args: Json, catalogVersion?: string | null): {
        id: string;
        createdAt: string;
        updatedAt: string;
        state: "queued" | "applying" | "applied" | "failed" | "restart-required" | "unknown";
        ownerPid: number | null;
        hostPid: number | null;
        catalogVersion: string | null;
        arguments: z.core.util.JSONType;
        authorization: {
            schemaVersion: 1;
            agentId: string;
            taskId: string;
            runId: string;
            operationId: string;
            intentVersion: number;
            parentRunId: string | null;
            scope: {
                kind: "task";
                agentId: string;
                taskId: string;
                scopeKey: string;
            };
            goal: string;
            motivation: {
                kind: "unknown" | "maintenance" | "explicit-task" | "self-exploration" | "conversation-invitation" | "mixed";
                basis: string[];
            };
            policy: {
                producer: string;
                id: string;
                hash: string;
            };
            action: {
                owner: string;
                id: string;
                version: string;
                pluginVersion: string;
                effects: "external-write";
                hash: string;
            };
            source: {
                kind: "owner-message";
                bindingId: string;
                inboundId: string;
                messageId: string;
                messageHash: string;
                conversation: {
                    channel: string;
                    account: string;
                    kind: "private" | "group" | "local";
                    id: string;
                };
                senderId: string;
                modality: "text" | "voice";
                sourceHash: string;
            } | {
                kind: "activity-wake";
                origin: {
                    kind: "wake";
                    producerId: string;
                    scheduleId: string;
                    scheduleVersion: number;
                    occurrenceId: string;
                    dueAt: string;
                };
                anchor: {
                    schemaVersion: 1;
                    id: string;
                    runId: string;
                    operationId: string;
                    scope: {
                        kind: "conversation";
                        agentId: string;
                        route: string;
                    } | {
                        kind: "task";
                        agentId: string;
                        taskId: string;
                        scopeKey: string;
                    };
                    intentVersion: number;
                    kind: "maintenance" | "execution";
                    hash: string;
                };
                sourceHash: string;
            };
        };
        result: z.core.util.JSONType;
    };
    status(): {
        id: string;
        state: "queued" | "applying" | "applied" | "failed" | "restart-required" | "unknown";
        updatedAt: string;
    }[];
    notifications(): {
        id: string;
        createdAt: string;
        updatedAt: string;
        state: "queued" | "applying" | "applied" | "failed" | "restart-required" | "unknown";
        ownerPid: number | null;
        hostPid: number | null;
        catalogVersion: string | null;
        arguments: z.core.util.JSONType;
        authorization: {
            schemaVersion: 1;
            agentId: string;
            taskId: string;
            runId: string;
            operationId: string;
            intentVersion: number;
            parentRunId: string | null;
            scope: {
                kind: "task";
                agentId: string;
                taskId: string;
                scopeKey: string;
            };
            goal: string;
            motivation: {
                kind: "unknown" | "maintenance" | "explicit-task" | "self-exploration" | "conversation-invitation" | "mixed";
                basis: string[];
            };
            policy: {
                producer: string;
                id: string;
                hash: string;
            };
            action: {
                owner: string;
                id: string;
                version: string;
                pluginVersion: string;
                effects: "external-write";
                hash: string;
            };
            source: {
                kind: "owner-message";
                bindingId: string;
                inboundId: string;
                messageId: string;
                messageHash: string;
                conversation: {
                    channel: string;
                    account: string;
                    kind: "private" | "group" | "local";
                    id: string;
                };
                senderId: string;
                modality: "text" | "voice";
                sourceHash: string;
            } | {
                kind: "activity-wake";
                origin: {
                    kind: "wake";
                    producerId: string;
                    scheduleId: string;
                    scheduleVersion: number;
                    occurrenceId: string;
                    dueAt: string;
                };
                anchor: {
                    schemaVersion: 1;
                    id: string;
                    runId: string;
                    operationId: string;
                    scope: {
                        kind: "conversation";
                        agentId: string;
                        route: string;
                    } | {
                        kind: "task";
                        agentId: string;
                        taskId: string;
                        scopeKey: string;
                    };
                    intentVersion: number;
                    kind: "maintenance" | "execution";
                    hash: string;
                };
                sourceHash: string;
            };
        };
        result: z.core.util.JSONType;
    }[];
    idle(validate: (row: DeferredPluginChange) => Promise<boolean>): Promise<void>;
}
export {};
