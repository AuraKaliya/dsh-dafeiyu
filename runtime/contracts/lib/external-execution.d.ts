import { z } from 'zod';
/** Omission denies external actions and must stay omitted in historical policy hashes. */
export declare const ExternalActionPolicySchema: z.ZodObject<{
    extensionId: z.ZodString;
    actionId: z.ZodString;
    actionVersion: z.ZodString;
}, z.core.$strict>;
export type ExternalActionPolicy = z.infer<typeof ExternalActionPolicySchema>;
export declare const ExternalActionPoliciesSchema: z.ZodArray<z.ZodObject<{
    extensionId: z.ZodString;
    actionId: z.ZodString;
    actionVersion: z.ZodString;
}, z.core.$strict>>;
export declare const ExternalTaskSourceSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
export type ExternalTaskSource = z.infer<typeof ExternalTaskSourceSchema>;
/** Plain evidence describes a live authorization; parsing or copying it grants no capability. */
export declare const ExternalTaskAuthorizationSchema: z.ZodObject<{
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
export type ExternalTaskAuthorization = z.infer<typeof ExternalTaskAuthorizationSchema>;
export interface ExternalTaskAuthority {
    readonly authorization: ExternalTaskAuthorization;
    readonly hash: string;
    /** Core rechecks its original WeakMap context and current evidence; invalid after the action exits. */
    guard(): void;
}
