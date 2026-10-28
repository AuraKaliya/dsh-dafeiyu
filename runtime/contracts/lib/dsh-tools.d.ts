import { z } from 'zod';
import type { ExternalTaskAuthority, ExternalTaskAuthorization } from './external-execution.js';
import type { Json } from './index.js';
export declare const DSH_TOOL_ACTIONS: readonly ["dsh_tool_list", "dsh_tool_call", "dsh_result_read"];
export declare const DshToolSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    parameters: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
}, z.core.$strict>;
export declare const DshToolCatalogSchema: z.ZodObject<{
    version: z.ZodString;
    tools: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        parameters: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>>;
    environment: z.ZodOptional<z.ZodObject<{
        workingDirectory: z.ZodString;
        developmentDirectory: z.ZodString;
        platform: z.ZodString;
    }, z.core.$strict>>;
    skills: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        load: z.ZodJSONSchema;
    }, z.core.$strict>>>;
    skillsComplete: z.ZodOptional<z.ZodBoolean>;
    pluginChanges: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        state: z.ZodString;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export type DshToolCatalog = z.infer<typeof DshToolCatalogSchema>;
/** Canonical program data. Array order remains semantic except named capability inventories. */
export declare function stableJson(value: Json): string;
export declare function orderedDshCatalog(value: DshToolCatalog): DshToolCatalog;
export declare const DshToolCallSchema: z.ZodObject<{
    catalogVersion: z.ZodString;
    name: z.ZodString;
    argumentsJson: z.ZodString;
}, z.core.$strict>;
export type DshToolCall = z.infer<typeof DshToolCallSchema>;
export declare const DshResultReadSchema: z.ZodObject<{
    resultId: z.ZodUUID;
    path: z.ZodDefault<z.ZodArray<z.ZodString>>;
    offset: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export type DshResultRead = z.infer<typeof DshResultReadSchema>;
export declare const DshCapabilityChangeSchema: z.ZodObject<{
    id: z.ZodUUID;
    state: z.ZodEnum<{
        unknown: "unknown";
        failed: "failed";
        applied: "applied";
        "restart-required": "restart-required";
    }>;
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
    catalogVersion: z.ZodString;
    toolNames: z.ZodArray<z.ZodString>;
    runtimeReloaded: z.ZodBoolean;
}, z.core.$strict>;
export interface DshToolsPort {
    catalog(signal: AbortSignal, taskId?: string): Promise<DshToolCatalog>;
    execute(call: DshToolCall, authority: ExternalTaskAuthority, signal: AbortSignal): Promise<Json>;
}
export declare const DshBridgeRequestSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"dsh.catalog">;
    id: z.ZodUUID;
    taskId: z.ZodOptional<z.ZodUUID>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"dsh.call">;
    id: z.ZodUUID;
    call: z.ZodObject<{
        catalogVersion: z.ZodString;
        name: z.ZodString;
        argumentsJson: z.ZodString;
    }, z.core.$strict>;
    authorization: z.ZodJSONSchema;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"dsh.bili-read">;
    id: z.ZodUUID;
    request: z.ZodObject<{
        taskId: z.ZodUUID;
        runId: z.ZodUUID;
        operationId: z.ZodUUID;
        bvid: z.ZodOptional<z.ZodString>;
        section: z.ZodDefault<z.ZodEnum<{
            video: "video";
            frame: "frame";
            comments: "comments";
            discover: "discover";
        }>>;
        feed: z.ZodOptional<z.ZodEnum<{
            home: "home";
            popular: "popular";
        }>>;
        positionMs: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"dsh.cancel">;
    id: z.ZodUUID;
}, z.core.$strict>], "type">;
export declare const DshBridgeResponseSchema: z.ZodObject<{
    type: z.ZodLiteral<"dsh.result">;
    id: z.ZodUUID;
    value: z.ZodJSONSchema;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** Authority is checked in Core before transmission; the parent still validates its data boundary. */
export type DshBridgeAuthorization = ExternalTaskAuthorization;
