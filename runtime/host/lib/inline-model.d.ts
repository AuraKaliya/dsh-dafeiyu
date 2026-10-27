import type { Context } from '@deepseek-ai/cordis';
import { DeepSeekAdapter, DeepSeekFileStore } from '@deepseek-ai/dsh-llm-deepseek';
import type { DeepSeekAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
import { z } from 'zod';
export declare const InlineModelSettingsSchema: z.ZodObject<{
    contextWindow: z.ZodNumber;
    maxOutputTokens: z.ZodNumber;
    streamIdleTimeoutMs: z.ZodDefault<z.ZodNumber>;
    maxInlineImageBytes: z.ZodDefault<z.ZodNumber>;
    maxImages: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export type InlineModelSettings = z.infer<typeof InlineModelSettingsSchema>;
/** Selects the official inline fallback before any Files index or network operation. */
export declare class InlineOnlyDeepSeekFiles extends DeepSeekFileStore {
    ensureUploaded(...args: Parameters<DeepSeekFileStore['ensureUploaded']>): ReturnType<DeepSeekFileStore['ensureUploaded']>;
    invalidate(): Promise<void>;
    release(): Promise<boolean>;
    reclaimOldestOwned(): Promise<number>;
    releaseAll(): Promise<number>;
}
/** Public official adapter seam; no replacement protocol, model loop, global fetch patch or Files upload. */
export declare function inlineDeepSeekAdapter(dependencies: Omit<DeepSeekAdapterOptions, 'resolveFiles'>): DeepSeekAdapter;
export declare function installInlineDeepSeek(ctx: Context, input: {
    auth?: 'api-key' | 'dsh-account';
    baseURL: string;
    credentialName: 'DEEPSEEK_API_KEY';
    route: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
    };
    settings: InlineModelSettings;
    credentialGuard: () => void;
}): Promise<void>;
