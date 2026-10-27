export { MediaStore, MEDIA_APPLICATION_ID, MEDIA_SCHEMA_VERSION, MEDIA_TABLES } from './store.js';
export { MediaFiles } from './files.js';
export { BoundedProcess, MediaWorkerError } from './process.js';
export { MediaRangeBroker } from './range-broker.js';
export { MediaDecoder } from './decoder.js';
export { MediaService, MEDIA_ACTIONS, mediaConfigSchema } from './service.js';
export declare const MediaPluginConfigSchema: import("zod").ZodObject<{
    ffmpeg: import("zod").ZodString;
    ffprobe: import("zod").ZodString;
    maxBytes: import("zod").ZodDefault<import("zod").ZodNumber>;
    maxAssetBytes: import("zod").ZodDefault<import("zod").ZodNumber>;
    timeoutMs: import("zod").ZodDefault<import("zod").ZodNumber>;
    vision: import("zod").ZodOptional<import("zod").ZodObject<{
        provider: import("zod").ZodString;
        model: import("zod").ZodString;
        reasoningEffort: import("zod").ZodOptional<import("zod").ZodString>;
    }, import("zod/v4/core").$strict>>;
    audio: import("zod").ZodOptional<import("zod").ZodObject<{
        whisper: import("zod").ZodOptional<import("zod").ZodObject<{
            node: import("zod").ZodString;
            moduleDirectory: import("zod").ZodString;
            moduleVersion: import("zod").ZodLiteral<"1.1.3">;
            model: import("zod").ZodObject<{
                path: import("zod").ZodString;
                sha256: import("zod").ZodString;
            }, import("zod/v4/core").$strict>;
            language: import("zod").ZodDefault<import("zod").ZodString>;
            memoryBytes: import("zod").ZodDefault<import("zod").ZodNumber>;
        }, import("zod/v4/core").$strict>>;
        events: import("zod").ZodOptional<import("zod").ZodObject<{
            python: import("zod").ZodString;
            model: import("zod").ZodObject<{
                path: import("zod").ZodString;
                sha256: import("zod").ZodString;
            }, import("zod/v4/core").$strict>;
            labels: import("zod").ZodObject<{
                path: import("zod").ZodString;
                sha256: import("zod").ZodString;
            }, import("zod/v4/core").$strict>;
            onnxruntimeVersion: import("zod").ZodString;
            numpyVersion: import("zod").ZodString;
            memoryBytes: import("zod").ZodDefault<import("zod").ZodNumber>;
        }, import("zod/v4/core").$strict>>;
    }, import("zod/v4/core").$strict>>;
    documents: import("zod").ZodOptional<import("zod").ZodObject<{
        python: import("zod").ZodString;
        pypdfVersion: import("zod").ZodLiteral<"6.10.0">;
    }, import("zod/v4/core").$strict>>;
    tts: import("zod").ZodOptional<import("zod").ZodObject<{
        powershell: import("zod").ZodString;
        voice: import("zod").ZodString;
    }, import("zod/v4/core").$strict>>;
}, import("zod/v4/core").$strict>;
export type { Config } from './service.js';
import type { Config } from './service.js';
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dafeiyu-media";
export declare const inject: string[];
export declare function apply(ctx: Context, config: Config): void;
