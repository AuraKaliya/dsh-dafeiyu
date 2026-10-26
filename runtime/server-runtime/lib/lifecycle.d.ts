import type { SharedModelBudget } from './shared-budget.js';
/** Owns only the borrowed runtime's teardown order; it never closes an authorization/ledger. */
export declare class RuntimeResourceLifetime {
    private readonly budget;
    private readonly closeProof;
    private readonly isHostDisposed;
    private readonly timeoutMs;
    private closing;
    private closed;
    constructor(options: {
        budget: SharedModelBudget;
        closeProof: () => Promise<void>;
        isHostDisposed: () => boolean;
        timeoutMs: number;
    });
    close(host?: {
        close(reason?: string): Promise<void>;
    }): Promise<void>;
    private drain;
}
