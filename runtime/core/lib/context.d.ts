import { z } from 'zod';
import type { ContextContributor, ContextItem, ContextRequest, OperationScope, PendingMessage } from '#dafeiyu/contracts';
import type { Journal } from '#dafeiyu/journal';
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
export interface ContextPacket {
    text: string;
    regions: {
        owner: string;
        region: string;
        kind: string;
        items: ContextItem[];
    }[];
    decisions: {
        owner: string;
        region: string;
        available: number;
        selected: number;
        invalid: number;
        overBudget: number;
        unavailable: boolean;
        maxBytes: number;
        priority: number;
    }[];
}
/** Registry and admission policy owned by the persona core, not by any contributing plugin. */
export declare class ContextCoordinator {
    private readonly agentId;
    private readonly journal;
    readonly config: z.output<typeof contextConfigSchema>;
    private readonly entries;
    private readonly scopes;
    private readonly pinnedRegions;
    pinRegion(name: string): () => void;
    constructor(agentId: string, journal: Journal, config?: z.input<typeof contextConfigSchema>);
    register(owner: string, version: string, contributors: readonly ContextContributor[]): () => void;
    scopeFor(request: ContextRequest): OperationScope;
    release(regions: readonly PreparedRegion[]): void;
    prepare(item: PendingMessage, signal: AbortSignal): Promise<PreparedRegion[]>;
    private policy;
    packet(prepared: readonly PreparedRegion[], allowance?: number): ContextPacket;
    audit(item: PendingMessage, packet: ContextPacket, retired: number, nativeNames: readonly string[], requestBytes: number): void;
}
export {};
