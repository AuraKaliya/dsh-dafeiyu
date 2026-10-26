import { z } from 'zod';
export declare const TaskMemoryPolicySchema: z.ZodObject<{
    requestId: z.ZodString;
    id: z.ZodString;
    expectedVersion: z.ZodNumber;
    enabled: z.ZodBoolean;
    sources: z.ZodArray<z.ZodObject<{
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
        memoryIds: z.ZodOptional<z.ZodArray<z.ZodUUID>>;
    }, z.core.$strict>>;
    reason: z.ZodString;
}, z.core.$strict>;
export declare const TaskMemoryGrantSchema: z.ZodObject<{
    requestId: z.ZodString;
    policyId: z.ZodString;
    expectedPolicyVersion: z.ZodNumber;
    sources: z.ZodArray<z.ZodObject<{
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
        memoryIds: z.ZodOptional<z.ZodArray<z.ZodUUID>>;
    }, z.core.$strict>>;
    expiresAt: z.ZodISODateTime;
    reason: z.ZodString;
}, z.core.$strict>;
export declare const TaskMemoryRevokeSchema: z.ZodObject<{
    requestId: z.ZodString;
    id: z.ZodUUID;
    expectedVersion: z.ZodNumber;
}, z.core.$strict>;
export declare const TaskMemoryQuerySchema: z.ZodObject<{
    query: z.ZodString;
    strategy: z.ZodDefault<z.ZodEnum<{
        lexical: "lexical";
        semantic: "semantic";
        hybrid: "hybrid";
    }>>;
    limit: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export declare const TaskMemoryOpenSchema: z.ZodObject<{
    hitId: z.ZodUUID;
    offset: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export declare const TaskMemorySelectSchema: z.ZodObject<{
    requestId: z.ZodString;
    expectedVersion: z.ZodNumber;
    hitIds: z.ZodArray<z.ZodUUID>;
}, z.core.$strict>;
export declare const TaskMemoryAuthorizationSchema: z.ZodObject<{
    taskId: z.ZodUUID;
    taskEpoch: z.ZodNumber;
    grantId: z.ZodUUID;
    grantVersion: z.ZodNumber;
    policyId: z.ZodString;
    policyVersion: z.ZodNumber;
}, z.core.$strict>;
export type TaskMemoryAuthorization = z.infer<typeof TaskMemoryAuthorizationSchema>;
/** Internal coordinator capability. Never expose its text to ordinary chat tool results. */
export interface TaskMemoryAccess {
    readonly id: string;
    recall(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    open(input: unknown): Record<string, unknown>;
    select(input: unknown): Record<string, unknown>;
}
export interface TaskMemoryControl {
    grant(input: unknown): TaskMemoryAccess;
    resume(id: string): TaskMemoryAccess;
    revoke(input: unknown): Record<string, unknown>;
}
export interface TaskMemoryProvider {
    policy(agentId: string, input: z.output<typeof TaskMemoryPolicySchema>): Record<string, unknown>;
    grant(agentId: string, taskId: string, input: z.output<typeof TaskMemoryGrantSchema>): string;
    check(agentId: string, taskId: string, grantId: string): void;
    revoke(agentId: string, taskId: string, input: z.output<typeof TaskMemoryRevokeSchema>): Record<string, unknown>;
    recall(agentId: string, taskId: string, grantId: string, input: z.output<typeof TaskMemoryQuerySchema>, signal: AbortSignal, guard: () => void): Promise<Record<string, unknown>>;
    open(agentId: string, taskId: string, grantId: string, input: z.output<typeof TaskMemoryOpenSchema>): Record<string, unknown>;
    select(agentId: string, taskId: string, grantId: string, input: z.output<typeof TaskMemorySelectSchema>): Record<string, unknown>;
}
