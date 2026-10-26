import type { Context } from '@deepseek-ai/cordis';
import { SharedModelBudget } from './shared-budget.js';
export interface ParentModelAdmissionOptions {
    readonly profileId: string;
    readonly maximumCallMs: number;
    /** Cancels the actual owners' work controllers, including isolated analysis contexts. */
    readonly cancelActive: (code: string) => void;
    readonly guard?: () => void;
}
/** Await before Core activation: a provider's oversized default must fail startup, not the first user Run. */
export declare function validateParentModelAdmission(ctx: Context, budget: SharedModelBudget, signal?: AbortSignal): Promise<void>;
/** The official frozen request and prepared adapter binding are preserved; next() is invoked once. */
export declare function installParentModelAdmission(ctx: Context, budget: SharedModelBudget, options: ParentModelAdmissionOptions): () => void;
