import { z } from 'zod';
import type { Json, ChannelCapability, Receipt } from './index.js';
import type { ContextItem } from './context.js';
import type { ResourceProofProvider } from './resource-observation.js';
export declare const EXTENSION_PROTOCOL_VERSION: 3;
export declare const FeatureSchema: z.ZodString;
export declare const ExtensionIdSchema: z.ZodString;
export declare const WakeOriginSchema: z.ZodObject<{
    kind: z.ZodLiteral<"wake">;
    producerId: z.ZodString;
    scheduleId: z.ZodString;
    scheduleVersion: z.ZodNumber;
    occurrenceId: z.ZodString;
    dueAt: z.ZodISODateTime;
}, z.core.$strict>;
export declare const RunOriginSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
export type RunOrigin = z.infer<typeof RunOriginSchema>;
export declare function taskScopeKey(agentId: string, taskId: string): string;
export declare const ExecutionScopeSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"conversation">;
    agentId: z.ZodString;
    route: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"task">;
    agentId: z.ZodString;
    taskId: z.ZodUUID;
    scopeKey: z.ZodString;
}, z.core.$strict>], "kind">;
export type ExecutionScope = z.infer<typeof ExecutionScopeSchema>;
declare const executionGrantBrand: unique symbol;
export interface ExecutionGrant {
    readonly id: string;
    readonly [executionGrantBrand]: true;
}
export interface ExecutionContextV3 {
    readonly agentId: string;
    readonly taskId: string | null;
    readonly runId: string;
    readonly operationId: string;
    readonly origin: RunOrigin;
    readonly scope: ExecutionScope;
    readonly intentVersion: number;
    readonly grant: ExecutionGrant;
    readonly signal: AbortSignal;
}
export interface ExecutionView {
    readonly runId: string;
    readonly taskId: string | null;
    readonly scope: ExecutionScope;
    readonly origin: RunOrigin;
    readonly signal: AbortSignal;
}
export interface ExecutionSourceRef {
    readonly id: string;
    readonly scopeKey: string;
    readonly version: number;
    readonly contentHash: string;
}
export declare const ActionOutcomeSchema: z.ZodObject<{
    status: z.ZodEnum<{
        unknown: "unknown";
        failed: "failed";
        partial: "partial";
        cancelled: "cancelled";
        succeeded: "succeeded";
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
    data: z.ZodJSONSchema;
    sources: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>>;
    receipts: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodString;
    }, z.core.$strict>>;
    errorCode: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type ActionOutcome = z.infer<typeof ActionOutcomeSchema>;
export interface ActionCapabilityV3 {
    readonly id: string;
    readonly version: string;
    readonly description: string;
    readonly inputSchema: z.ZodType;
    readonly outputSchema: z.ZodType;
    readonly effects: 'read' | 'local-write' | 'external-write';
    readonly requiresTask?: boolean;
    execute(input: Json, context: ExecutionContextV3): Promise<ActionOutcome>;
}
export interface ContextContributorV3 {
    readonly id: string;
    prepare(view: ExecutionView): Promise<readonly ContextItem[]>;
    validate(view: ExecutionView, item: ContextItem): boolean;
}
export interface ExtensionV3 {
    readonly protocolVersion: 3;
    readonly id: string;
    readonly version: string;
    readonly agentId: string;
    readonly provides?: readonly string[];
    readonly requires?: readonly string[];
    readonly actions?: readonly ActionCapabilityV3[];
    readonly channels?: readonly ChannelCapability[];
    readonly contexts?: readonly ContextContributorV3[];
    readonly lifecycleReady?: () => boolean;
    readonly resourceProofs?: ResourceProofProvider;
}
export interface ExtensionHandleV3 {
    readonly ingest?: (message: unknown) => Receipt;
    dispose(): void;
}
export declare const ExtensionMetadataV3Schema: z.ZodObject<{
    protocolVersion: z.ZodLiteral<3>;
    id: z.ZodString;
    version: z.ZodString;
    agentId: z.ZodString;
    provides: z.ZodDefault<z.ZodArray<z.ZodString>>;
    requires: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const TaskSubmitSchema: z.ZodObject<{
    requestId: z.ZodString;
    title: z.ZodString;
    goal: z.ZodString;
    policyId: z.ZodString;
    inputRefs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    data: z.ZodOptional<z.ZodJSONSchema>;
}, z.core.$strict>;
export {};
