import type { Context } from '@deepseek-ai/cordis';
import type { MemoryStore } from './store.js';
import type { MemorySourcePolicy } from './source-policy.js';
export declare class CapabilityObservationService {
    private readonly unbind;
    private readonly unvalidate;
    constructor(ctx: Context, memory: MemoryStore, ready: () => boolean, sourcePolicy: MemorySourcePolicy, flush: () => unknown);
    close(): void;
}
