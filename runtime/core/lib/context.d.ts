import { z } from 'zod';
import type { ContextContributor, ContextItem, ContextRequest, OperationScope, PendingMessage } from '#dafeiyu/contracts';
import type { Journal } from '#dafeiyu/journal';
import { contextManifest, requestCapacity } from './context-plan.js';
import type { ContextPacket } from './context-plan.js';
export type { ContextPacket } from './context-plan.js';
export declare const contextConfigSchema: z.ZodObject<{
    maxBytes: z.ZodDefault<z.ZodNumber>;
    requestMaxBytes: z.ZodDefault<z.ZodNumber>;
    outputReserveBytes: z.ZodDefault<z.ZodNumber>;
    prepareTimeoutMs: z.ZodDefault<z.ZodNumber>;
    regions: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        maxBytes: z.ZodDefault<z.ZodNumber>;
        priority: z.ZodDefault<z.ZodNumber>;
        required: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>>;
    assembly: z.ZodPrefault<z.ZodObject<{
        mode: z.ZodDefault<z.ZodEnum<{
            legacy: "legacy";
            unified: "unified";
        }>>;
        deadlineMs: z.ZodDefault<z.ZodNumber>;
        recall: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            strategy: z.ZodDefault<z.ZodEnum<{
                lexical: "lexical";
                hybrid: "hybrid";
            }>>;
            candidates: z.ZodDefault<z.ZodNumber>;
            limit: z.ZodDefault<z.ZodNumber>;
            maxBytes: z.ZodDefault<z.ZodNumber>;
            timeoutMs: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        background: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            windowMs: z.ZodDefault<z.ZodNumber>;
            limit: z.ZodDefault<z.ZodNumber>;
            maxBytes: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        recentState: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            shared: z.ZodDefault<z.ZodBoolean>;
            maxBytes: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const CONTEXT_CARRIER = "dafeiyu:controlled-context:v1";
export declare const bytes: (value: unknown) => number;
interface Entry {
    owner: string;
    version: string;
    contributor: ContextContributor;
    active: boolean;
    controller: AbortController;
}
export interface PreparedRegion {
    entry: Entry;
    request: ContextRequest;
    items: readonly ContextItem[];
    unavailable: boolean;
}
/** Registry and admission policy owned by the persona core, not by any contributing plugin. */
export declare class ContextCoordinator {
    private readonly agentId;
    private readonly journal;
    readonly config: z.output<typeof contextConfigSchema>;
    private readonly entries;
    private readonly scopes;
    private readonly pinnedRegions;
    private readonly latest;
    status(route: string): {
        manifest: ReturnType<typeof contextManifest>;
        requestBytes: number;
    } | null;
    pinRegion(name: string): () => void;
    constructor(agentId: string, journal: Journal, config?: z.input<typeof contextConfigSchema>);
    register(owner: string, version: string, contributors: readonly ContextContributor[]): () => void;
    scopeFor(request: ContextRequest): OperationScope;
    release(regions: readonly PreparedRegion[]): void;
    prepare(item: PendingMessage, signal: AbortSignal): Promise<PreparedRegion[]>;
    private policy;
    packet(prepared: readonly PreparedRegion[], allowance?: number): ContextPacket;
    audit(item: PendingMessage, packet: ContextPacket, retired: number, nativeNames: readonly string[], requestBytes: number, capacity?: ReturnType<typeof requestCapacity>): void;
}
