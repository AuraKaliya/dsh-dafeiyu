import { z } from 'zod';
export declare const RuntimeHashSchema: z.ZodString;
export declare const RuntimePathSchema: z.ZodString;
export declare function runtimeCheck(value: unknown, code: string): asserts value;
export declare const runtimeDigest: (value: unknown) => string;
export declare const runtimeBytesHash: (value: Uint8Array | string) => string;
export declare function runtimeFreeze<T>(value: T): T;
export declare function runtimePathIdentity(raw: string, kind: 'directory' | 'file'): string;
export declare function readRuntimeJson<T>(file: string, schema: z.ZodType<T>, expectedHash?: string): T;
