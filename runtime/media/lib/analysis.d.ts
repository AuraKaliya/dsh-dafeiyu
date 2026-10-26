import { Context } from '@deepseek-ai/cordis';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { ScopedImages } from './images.js';
export interface MediaModelRoute {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
/** DSH owns the only model loop. Each read gets an isolated session and ephemeral image lease. */
export declare class MediaAnalysis {
    private readonly host;
    private readonly images;
    private readonly directory;
    constructor(host: Context, images: ScopedImages, directory: string);
    run<T>(job: {
        route: MediaModelRoute;
        instructions: string;
        input: unknown;
        refs?: readonly ImageAttachmentRef[];
        lease?: string;
        guard: () => void;
        parse: (value: unknown) => T;
    }, signal: AbortSignal): Promise<T>;
}
