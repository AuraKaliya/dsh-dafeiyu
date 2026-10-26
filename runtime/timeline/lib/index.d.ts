import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type { ActionContext, ContextRequest, ExecutionContextV3, TimelineScope } from '#dafeiyu/contracts';
import { z } from 'zod';
export declare const name = "dafeiyu-timeline";
export declare const inject: string[];
declare const settingsSchema: z.ZodObject<{
    agentId: z.ZodString;
    maxPageChars: z.ZodDefault<z.ZodNumber>;
    previewChars: z.ZodDefault<z.ZodNumber>;
    execution: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
export type Config = z.input<typeof settingsSchema>;
export declare const TimelinePluginConfigSchema: z.ZodObject<{
    maxPageChars: z.ZodDefault<z.ZodNumber>;
    previewChars: z.ZodDefault<z.ZodNumber>;
    execution: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
declare module '@deepseek-ai/cordis' {
    interface Context {
        dafeiyuTimeline: TimelineService;
    }
}
/** Read-only memory foundation. Access comes from an active core action, never from a model-supplied route. */
export declare class TimelineService extends Service {
    private readonly config;
    private readonly handle;
    private closed;
    private readonly validatingSources;
    private readonly executionHandle;
    constructor(ctx: Context, config: Config);
    executionEvents(context: ExecutionContextV3): import("#dafeiyu/contracts").ExecutionEvent[];
    private scope;
    private archiveLink;
    checkWorkingSource(context: ActionContext, ref: string, hash: string): boolean;
    /** Trusted archive validation; no content is exported through this predicate. */
    checkArchivedSource(scope: TimelineScope, ref: string, hash: string): boolean;
    /** Exact inbound identity, kept separate from session receipt identities. */
    matchesInboundSource(scope: TimelineScope, ref: string, messageId: string): boolean;
    archivedSourceIdentity(scope: TimelineScope, ref: string): string | null;
    sameArchivedSource(scope: TimelineScope, left: string, right: string): boolean;
    checkContextSource(context: ContextRequest, ref: string, hash: string): boolean;
    private visibleSource;
    private links;
    private cause;
    private audit;
    search(context: ActionContext, raw: unknown): {
        status: string;
        untrustedEvidence: boolean;
        order: string;
        snapshot: number;
        nextCursor: string | null;
        items: {
            summary: string;
            metadataTruncated: boolean;
            causedBy: string | null;
            sourceCount: number;
            seq: number;
            type: string;
            plugin: string;
            pluginVersion: string;
            occurredAt: string;
            recordedAt: string;
            traceId: string;
            operationId: string;
            redacted: boolean;
            ref: string;
        }[];
    };
    open(context: ActionContext, raw: unknown): Promise<{
        status: "not_found";
        untrustedEvidence?: never;
        memoryUse?: never;
        ref?: never;
        revision?: never;
        sourceSeqs?: never;
        sessionId?: never;
        proof?: never;
    } | {
        status: "invalid_reference";
        untrustedEvidence?: never;
        memoryUse?: never;
        ref?: never;
        revision?: never;
        sourceSeqs?: never;
        sessionId?: never;
        proof?: never;
    } | {
        status: "stale_reference";
        untrustedEvidence?: never;
        memoryUse?: never;
        ref?: never;
        revision?: never;
        sourceSeqs?: never;
        sessionId?: never;
        proof?: never;
    } | {
        status: "not_exported";
        untrustedEvidence?: never;
        memoryUse?: never;
        ref?: never;
        revision?: never;
        sourceSeqs?: never;
        sessionId?: never;
        proof?: never;
    } | {
        status: "invalid_reference";
        ref?: never;
        untrustedEvidence?: never;
        kind?: never;
        text?: never;
        offset?: never;
        totalChars?: never;
        hasMore?: never;
        nextOffset?: never;
        redacted?: never;
        omittedBlocks?: never;
        interrupted?: never;
        memoryUse?: never;
        contentHash?: never;
    } | {
        status: "redirect";
        ref: string;
        untrustedEvidence: boolean;
        kind?: never;
        text?: never;
        offset?: never;
        totalChars?: never;
        hasMore?: never;
        nextOffset?: never;
        redacted?: never;
        omittedBlocks?: never;
        interrupted?: never;
        memoryUse?: never;
        contentHash?: never;
    } | {
        status: "not_exported";
        ref?: never;
        untrustedEvidence?: never;
        kind?: never;
        text?: never;
        offset?: never;
        totalChars?: never;
        hasMore?: never;
        nextOffset?: never;
        redacted?: never;
        omittedBlocks?: never;
        interrupted?: never;
        memoryUse?: never;
        contentHash?: never;
    } | {
        status: "not_found" | "source_unavailable";
        ref?: never;
        untrustedEvidence?: never;
        kind?: never;
        text?: never;
        offset?: never;
        totalChars?: never;
        hasMore?: never;
        nextOffset?: never;
        redacted?: never;
        omittedBlocks?: never;
        interrupted?: never;
        memoryUse?: never;
        contentHash?: never;
    } | {
        status: "ok";
        ref: string;
        untrustedEvidence: boolean;
        kind: string;
        text: string;
        offset: number;
        totalChars: number;
        hasMore: boolean;
        nextOffset: number | null;
        redacted: boolean;
        omittedBlocks: number;
        interrupted: boolean;
        memoryUse: "derived-only" | "primary-candidate";
        contentHash: string;
    } | {
        status: "ok";
        ref: string;
        kind: string;
        memoryUse: "derived-only";
        untrustedEvidence: boolean;
        revision: number;
        text: string;
        offset: number;
        totalChars: number;
        hasMore: boolean;
        nextOffset: number | null;
        contentHash: string;
        redacted: boolean;
        omittedBlocks: number;
        interrupted: boolean;
    }>;
    /** Only a core-issued durable analysis grant can reach the background reader. */
    openForAnalysis(grantId: string, raw: unknown, signal: AbortSignal): Promise<{
        status: "invalid_reference";
        ref?: never;
        untrustedEvidence?: never;
        kind?: never;
        text?: never;
        offset?: never;
        totalChars?: never;
        hasMore?: never;
        nextOffset?: never;
        redacted?: never;
        omittedBlocks?: never;
        interrupted?: never;
        memoryUse?: never;
        contentHash?: never;
    } | {
        status: "redirect";
        ref: string;
        untrustedEvidence: boolean;
        kind?: never;
        text?: never;
        offset?: never;
        totalChars?: never;
        hasMore?: never;
        nextOffset?: never;
        redacted?: never;
        omittedBlocks?: never;
        interrupted?: never;
        memoryUse?: never;
        contentHash?: never;
    } | {
        status: "not_exported";
        ref?: never;
        untrustedEvidence?: never;
        kind?: never;
        text?: never;
        offset?: never;
        totalChars?: never;
        hasMore?: never;
        nextOffset?: never;
        redacted?: never;
        omittedBlocks?: never;
        interrupted?: never;
        memoryUse?: never;
        contentHash?: never;
    } | {
        status: "not_found" | "source_unavailable";
        ref?: never;
        untrustedEvidence?: never;
        kind?: never;
        text?: never;
        offset?: never;
        totalChars?: never;
        hasMore?: never;
        nextOffset?: never;
        redacted?: never;
        omittedBlocks?: never;
        interrupted?: never;
        memoryUse?: never;
        contentHash?: never;
    } | {
        status: "ok";
        ref: string;
        untrustedEvidence: boolean;
        kind: string;
        text: string;
        offset: number;
        totalChars: number;
        hasMore: boolean;
        nextOffset: number | null;
        redacted: boolean;
        omittedBlocks: number;
        interrupted: boolean;
        memoryUse: "derived-only" | "primary-candidate";
        contentHash: string;
    }>;
    private openScoped;
}
export declare function apply(ctx: Context, config: Config): void;
export {};
