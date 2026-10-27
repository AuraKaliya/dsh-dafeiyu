import type { Context } from '@deepseek-ai/cordis';
import type { InlineModelSettings } from './inline-model.js';
/** Reuses the official account service. No token is converted to an API key or copied to another store. */
export declare function installAccountModel(ctx: Context, input: {
    baseURL: string;
    route: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
    };
    inlineTransport?: InlineModelSettings;
    guard: () => void;
}): Promise<void>;
