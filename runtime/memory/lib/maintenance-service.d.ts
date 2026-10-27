import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import type { ExecutionContextV3, MemoryMaintenanceSchedulingPort } from '#dafeiyu/contracts';
import type { MemoryStore } from './store.js';
import type { PersonaService } from './persona-service.js';
export declare const maintenanceConfigSchema: z.ZodObject<{
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    maxInputBytes: z.ZodDefault<z.ZodNumber>;
    maxOutputBytes: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
/** Runs only inside an authorized native task. It is deliberately not a scheduler. */
export declare class MaintenanceService {
    private readonly ctx;
    private readonly memory;
    private readonly persona;
    private readonly agentId;
    private readonly ready;
    private readonly runtime;
    private readonly controller;
    private readonly pending;
    private readonly active;
    private closed;
    private schedulerConnected;
    private finalCounts;
    private readonly handle;
    readonly config: z.output<typeof maintenanceConfigSchema>;
    constructor(ctx: Context, memory: MemoryStore, persona: PersonaService, directory: string, config: z.input<typeof maintenanceConfigSchema>, agentId: string, ready: () => boolean);
    private access;
    request(context: ExecutionContextV3, input: unknown, pluginId?: string): {
        id: string;
    };
    status(context: ExecutionContextV3, id?: string, pluginId?: string): {
        id: string;
        state: "completed" | "failed" | "running" | "ready" | "cancelled" | "stale" | "waiting-scheduler";
        version: number;
        reason: string;
        watermark: string;
        available: boolean;
        error: string | null;
        processed: boolean;
    }[];
    read(context: ExecutionContextV3, id: string, pluginId?: string): {
        schemaVersion: 1;
        id: string;
        version: number;
        state: "withdrawn" | "accepted" | "proposed" | "held" | "rejected";
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
        taskEpoch: number;
        runId: string;
        maintenanceId: string;
        goal: string;
        motivation: {
            kind: "unknown" | "maintenance" | "explicit-task" | "self-exploration" | "conversation-invitation" | "mixed";
            basis: string[];
        };
        content: {
            observation: string;
            action: string;
            outcome: string;
            interpretation: string;
            conditions: string[];
            unknowns: string[];
        };
        contentRef: {
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        };
        supports: ({
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        })[];
        counters: ({
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        })[];
        dependencies: ({
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        })[];
        rootSources: string[];
        reason: string;
        createdAt: string;
        policy: "experience-e-v1";
        evidenceStatus: "source-bound-inference";
    };
    review(context: ExecutionContextV3, input: unknown, pluginId?: string): z.core.util.JSONType | {
        id: string;
        version: number;
        state: "withdrawn" | "accepted" | "held" | "rejected";
    };
    private result;
    inspect(context: ExecutionContextV3, id: string, pluginId?: string): {
        persona: {
            text: string;
            kind: "preference" | "view" | "interest" | "habit" | "relationship" | "value-application";
            contentRef: {
                kind: "memory";
                revision: number;
                id: string;
                agentId: string;
                scopeKey: string;
                version: number;
                contentHash: string;
                authorization?: {
                    taskId: string;
                    taskEpoch: number;
                    grantId: string;
                    grantVersion: number;
                    policyId: string;
                    policyVersion: number;
                } | undefined;
                selectionId?: string | undefined;
                range?: {
                    start: number;
                    end: number;
                } | undefined;
            } | {
                kind: "execution-source";
                id: string;
                agentId: string;
                scopeKey: string;
                version: number;
                contentHash: string;
            };
            supports: ({
                kind: "memory";
                revision: number;
                id: string;
                agentId: string;
                scopeKey: string;
                version: number;
                contentHash: string;
                authorization?: {
                    taskId: string;
                    taskEpoch: number;
                    grantId: string;
                    grantVersion: number;
                    policyId: string;
                    policyVersion: number;
                } | undefined;
                selectionId?: string | undefined;
                range?: {
                    start: number;
                    end: number;
                } | undefined;
            } | {
                kind: "execution-source";
                id: string;
                agentId: string;
                scopeKey: string;
                version: number;
                contentHash: string;
            })[];
            counters: ({
                kind: "memory";
                revision: number;
                id: string;
                agentId: string;
                scopeKey: string;
                version: number;
                contentHash: string;
                authorization?: {
                    taskId: string;
                    taskEpoch: number;
                    grantId: string;
                    grantVersion: number;
                    policyId: string;
                    policyVersion: number;
                } | undefined;
                selectionId?: string | undefined;
                range?: {
                    start: number;
                    end: number;
                } | undefined;
            } | {
                kind: "execution-source";
                id: string;
                agentId: string;
                scopeKey: string;
                version: number;
                contentHash: string;
            })[];
            applicability: string;
            reason: string;
            eligible: boolean;
            holdReason: string | null;
        }[];
        summary: string | null;
        relations: z.core.util.JSONType[];
        instructionAuthority: boolean;
        experienceIds: string[];
        summaryRef: {
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        } | null;
        experienceBasis: {
            id: string;
            sourceId: string;
            taskEpoch: number;
        }[];
        dependencies: ({
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        })[];
        model: z.core.util.JSONType;
        policy: "experience-e-v1";
    };
    propose(context: ExecutionContextV3, input: {
        id: string;
        index: number;
        requestId: string;
    }, pluginId?: string): {
        id: `${string}-${string}-${string}-${string}-${string}`;
        version: number;
        state: string;
    };
    consolidate(context: ExecutionContextV3, id: string, pluginId?: string): Promise<{
        id: string;
        state: string;
        duplicate: boolean;
        experienceCount?: never;
        personaSuggestions?: never;
    } | {
        id: string;
        state: string;
        duplicate: boolean;
        experienceCount: number;
        personaSuggestions: number;
    }>;
    private execute;
    private actions;
    recover(): void;
    schedulingPort(): MemoryMaintenanceSchedulingPort;
    cancel(): void;
    whenIdle(): Promise<void>;
    get health(): {
        state: "paused" | "closed" | "ready";
        active: number;
        requests: Record<string, number>;
        scheduler: "connected" | "not-configured";
    };
    close(): Promise<void>;
}
