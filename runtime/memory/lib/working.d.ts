import type { Context } from '@deepseek-ai/cordis';
import type { ActionContext, ContextContributor, OperationScope } from '#dafeiyu/contracts';
import { MemoryStore } from './store.js';
import { MemoryRetrieval } from './retrieval.js';
import type { Evidence } from './types.js';
/** Explicit work state and citation selection. Analysis reports never feed this service automatically. */
export declare class WorkingMemory {
    private readonly ctx;
    private readonly memory;
    private readonly retrieval;
    private readonly evidence;
    private readonly strictSources;
    private readonly state;
    private readonly cache;
    constructor(ctx: Context, memory: MemoryStore, retrieval: MemoryRetrieval | null, directory: string, evidence: (context: ActionContext, refs: readonly string[]) => Promise<Evidence[]>, strictSources?: boolean);
    private scope;
    compactionBasis(scope: Pick<OperationScope, 'agentId' | 'route'>): {
        working: number;
        evidence: number;
        taskId: string | null;
    };
    sourceItem(scope: Pick<OperationScope, 'agentId' | 'route'>, id: string): {
        id: string;
        taskId: string;
        revision: number;
        hash: string;
        item: {
            id: string;
            category: "result" | "goal" | "constraint" | "correction" | "pending" | "gap";
            text: string;
            sources: {
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
                version: number | null;
                ancestors?: {
                    id: string;
                    revision: number;
                    version: number;
                    contentHash: string;
                }[] | undefined;
                sourceFences?: {
                    ref: string;
                    contentHash: string;
                    fence: string;
                }[] | undefined;
            }[];
        };
    } | null;
    private match;
    private expiry;
    private selected;
    update(context: ActionContext, raw: unknown): Promise<{
        admission: string;
        duplicate: boolean;
        kind: "evidence" | "working";
        version: number;
        eventId: string;
        status: "ok";
    }>;
    select(context: ActionContext, raw: unknown): {
        selected: number;
        admission: string;
        duplicate: boolean;
        kind: "evidence" | "working";
        version: number;
        eventId: string;
        status: "ok";
    };
    retrieve(context: ActionContext, raw: unknown): Promise<{
        status: "not_configured";
    } | {
        strategy: "lexical" | "semantic" | "hybrid";
        degraded: boolean;
        selected: number;
        admission: string;
        duplicate: boolean;
        kind: "evidence" | "working";
        version: number;
        eventId: string;
        status: "ok";
    }>;
    clear(context: ActionContext, raw: unknown): {
        duplicate: boolean;
        kind: "evidence" | "working";
        version: number;
        eventId: string;
        status: "ok";
    };
    status(context: ActionContext): {
        status: "ok";
        areas: {
            kind: "evidence" | "working";
            version: number;
            taskId: string | null;
            expiresAt: string | null;
            storedCount: number;
            expired: boolean;
        }[];
    };
    private contributions;
    private readContributions;
    contributors(): ContextContributor[];
    private flush;
    close(): void;
}
