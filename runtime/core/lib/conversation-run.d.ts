import type { PendingMessage, HostConfig, PersonaManifest } from '#dafeiyu/contracts';
import type { Journal } from '#dafeiyu/journal';
import type { Context } from '@deepseek-ai/cordis';
import { RuntimeStore } from './runtime-store.js';
import type { StoredRun } from './runtime-store.js';
import type { RunResult } from './runtime.js';
import type { FoundationSnapshot } from './foundation.js';
/** The journal owns delivery. The Run owns only the durable model execution and its projection. */
export declare class ConversationRuns {
    private readonly ctx;
    private readonly store;
    private readonly journal;
    private readonly agentId;
    private readonly validatePersona;
    constructor(ctx: Context, store: RuntimeStore, journal: Journal, agentId: string, validatePersona?: (run: StoredRun) => void);
    begin(item: PendingMessage, persona: FoundationSnapshot, model: HostConfig['modelRoutes']['chat'], registry: unknown, execution?: {
        policyId: string;
        authority: unknown;
        actions: unknown;
    }, preparePersona?: (run: StoredRun) => PersonaManifest): StoredRun;
    complete(run: StoredRun, item: PendingMessage, result: RunResult, startedEventId: string): void;
    fail(run: StoredRun, code?: string): void;
    project(): Promise<void>;
    recover(): Promise<void>;
}
