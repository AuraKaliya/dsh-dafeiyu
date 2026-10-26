import { z } from 'zod';
import type { MediaByteStream } from '#dafeiyu/contracts';
import type { QqMediaLocator } from './media-store.js';
import type { OneBot } from './onebot.js';
export declare const QqMediaConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    sendEnabled: z.ZodDefault<z.ZodBoolean>;
    cacheRoots: z.ZodDefault<z.ZodArray<z.ZodString>>;
    httpsHosts: z.ZodDefault<z.ZodArray<z.ZodString>>;
    maxReadBytes: z.ZodDefault<z.ZodNumber>;
    voiceDirectives: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
type Range = {
    start: number;
    end: number;
} | null;
export declare function publicIpv4(value: string): boolean;
/** No caller-supplied paths or addresses: locators must come from the registered QQ source resolver. */
export declare class QqMediaReader {
    private readonly config;
    private readonly roots;
    constructor(config: z.output<typeof QqMediaConfigSchema>);
    local(file: string, range: Range, signal: AbortSignal, guard: () => void): Promise<MediaByteStream>;
    private remote;
    open(location: string, range: Range, signal: AbortSignal, guard: () => void): Promise<MediaByteStream>;
    resolve(api: Pick<OneBot, 'call' | 'verify'>, kind: 'image' | 'audio' | 'video' | 'document', locator: QqMediaLocator, range: Range, signal: AbortSignal, guard: () => void): Promise<MediaByteStream>;
}
export {};
