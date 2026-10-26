import type { Context } from '@deepseek-ai/cordis';
import type { HostRuntimeOptions, PreparedHostConfig } from '#dafeiyu/host';
import type { WindowsProcessControlOptions, WindowsHostProof } from '#dafeiyu/server-executor/windows-process';
import type { ModelBudgetAuthority } from './types.js';
import { SharedModelBudget } from './shared-budget.js';
export interface ProductionRuntimeOptions {
    readonly authority: ModelBudgetAuthority;
    readonly windows: WindowsProcessControlOptions;
    readonly maximumCallMs: number;
    readonly drainTimeoutMs: number;
    /** Fixed launcher release pins, separate from the immutable financial scope. */
    readonly guard?: () => void;
}
export interface ProductionRuntimeResources {
    readonly budget: SharedModelBudget;
    readonly parentProof: WindowsHostProof;
    readonly hostOptions: Pick<HostRuntimeOptions, 'installModelAdmission' | 'serverExecutorDependencies'>;
    /** Pass the live Host, or call after a failed start has disposed its context. */
    close(host?: {
        close(reason?: string): Promise<void>;
    }): Promise<void>;
}
/** Uses current services even during Host.start(), before an outer host variable exists. */
export declare function cancelManagedModelWork(ctx: Context, code: string): void;
/** Explicit start/run operation only. Import/inspect/init never call this OS factory. */
export declare function createProductionRuntime(config: PreparedHostConfig, options: ProductionRuntimeOptions): Promise<ProductionRuntimeResources>;
