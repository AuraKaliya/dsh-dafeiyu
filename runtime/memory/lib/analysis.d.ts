import type { Context } from '@deepseek-ai/cordis';
import type { ActionContext } from '#dafeiyu/contracts';
import { z } from 'zod';
import { MemoryStore } from './store.js';
import { analysisConfigSchema } from './analysis-types.js';
export declare class MemoryAnalysis {
    private readonly ctx;
    private readonly memories;
    private readonly canRun;
    private readonly queue;
    private readonly sources;
    private readonly runtime;
    private readonly config;
    private worker;
    private active;
    private stopping;
    private faulted;
    private readonly cancelled;
    private enabled;
    constructor(ctx: Context, memories: MemoryStore, directory: string, config: z.input<typeof analysisConfigSchema>, managed?: boolean, canRun?: () => boolean);
    recover(): void;
    activate(): void;
    quiesce(): void;
    cancelRunning(): void;
    get health(): {
        state: "failed" | "paused" | "stopped" | "ready";
        active: boolean;
    };
    start(): void;
    whenIdle(): Promise<void>;
    private scope;
    private summary;
    submit(context: ActionContext, raw: unknown): Promise<{
        duplicate: boolean;
        status: "ok";
        jobId: string;
        state: "completed" | "failed" | "running" | "queued" | "committing" | "cancelled";
        attempts: number;
        counts: {
            candidates: number;
            committed: number;
            review: number;
        };
        error: string | null;
        contextInjected: boolean;
    }>;
    status(context: ActionContext, id: unknown): {
        status: "ok";
        jobId: string;
        state: "completed" | "failed" | "running" | "queued" | "committing" | "cancelled";
        attempts: number;
        counts: {
            candidates: number;
            committed: number;
            review: number;
        };
        error: string | null;
        contextInjected: boolean;
    } | {
        status: "not_found";
    };
    inspect(context: ActionContext, id: unknown): Promise<{
        status: "not_found";
    } | {
        untrustedEvidence: boolean;
        useRestriction: string;
        result: {
            schemaVersion: 1;
            overview: string;
            gaps: string[];
            claims: {
                action: "add" | "revise" | "none";
                kind: "experience" | "knowledge" | "preference" | "procedure";
                claimType: "observation" | "self_report" | "reported_claim" | "inference";
                subject: string;
                content: string;
                support: {
                    sourceId: string;
                    quote: string;
                }[];
                opposition: {
                    sourceId: string;
                    quote: string;
                }[];
                uncertainties: string[];
                explicit: boolean;
                temporal: "durable" | "temporary" | "uncertain";
                targetId: string | null;
            }[];
        } | null;
        model: import("./analysis-types.js").ModelRoute;
        policyVersion: string;
        inputGeneration: number;
        sources: {
            sourceId: string;
            evidence: {
                kind: "capability";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "execution";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "observation";
                ref: string;
                version: number;
                contentHash: string;
            } | {
                kind: "timeline";
                ref: string;
                contentHash: string;
            } | {
                kind: "memory";
                id: string;
                revision: number;
                contentHash: string;
            };
            origin: "user" | "tool" | "memory" | "event";
            authorId?: string | undefined;
            version?: number | undefined;
        }[];
        targets: {
            id: string;
            version: number;
            revision: number;
        }[];
        candidates: {
            id: string;
            claim: import("./analysis-types.js").Claim;
            status: "needs_review" | "ready" | "committed" | "duplicate" | "stale";
            reason: string;
            receipt?: import("./types.js").MutationReceipt | undefined;
        }[];
        status: "ok";
        jobId: string;
        state: "completed" | "failed" | "running" | "queued" | "committing" | "cancelled";
        attempts: number;
        counts: {
            candidates: number;
            committed: number;
            review: number;
        };
        error: string | null;
        contextInjected: boolean;
    }>;
    cancel(context: ActionContext, id: unknown): {
        status: "ok";
        jobId: string;
        state: "completed" | "failed" | "running" | "queued" | "committing" | "cancelled";
        attempts: number;
        counts: {
            candidates: number;
            committed: number;
            review: number;
        };
        error: string | null;
        contextInjected: boolean;
    } | {
        status: "not_found";
    };
    private validateGeneration;
    private flush;
    private execute;
    private drain;
    close(): Promise<void>;
}
