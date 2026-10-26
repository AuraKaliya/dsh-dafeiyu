import { z } from 'zod';
export declare const BILI_SCENE: {
    channel: string;
    account: string;
    kind: "local";
    id: string;
};
export declare const BiliConfigSchema: z.ZodObject<{
    minIntervalMs: z.ZodDefault<z.ZodNumber>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    backoffMs: z.ZodDefault<z.ZodNumber>;
    maxResponseBytes: z.ZodDefault<z.ZodNumber>;
    maxMediaReadBytes: z.ZodDefault<z.ZodNumber>;
    maxPages: z.ZodDefault<z.ZodNumber>;
    session: z.ZodOptional<z.ZodObject<{
        file: z.ZodString;
        expectedUid: z.ZodString;
    }, z.core.$strict>>;
    topics: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export type BiliConfig = z.output<typeof BiliConfigSchema>;
export declare const BiliPluginConfigSchema: z.ZodObject<{
    minIntervalMs: z.ZodDefault<z.ZodNumber>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    backoffMs: z.ZodDefault<z.ZodNumber>;
    maxResponseBytes: z.ZodDefault<z.ZodNumber>;
    maxMediaReadBytes: z.ZodDefault<z.ZodNumber>;
    maxPages: z.ZodDefault<z.ZodNumber>;
    session: z.ZodOptional<z.ZodObject<{
        file: z.ZodString;
        expectedUid: z.ZodString;
    }, z.core.$strict>>;
    topics: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export declare const BvidSchema: z.ZodString;
export declare const NumberIdSchema: z.ZodString;
export declare const code: (error: unknown) => string;
