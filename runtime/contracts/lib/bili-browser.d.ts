import { z } from 'zod';
export declare const BiliBrowserRequestSchema: z.ZodObject<{
    taskId: z.ZodUUID;
    runId: z.ZodUUID;
    operationId: z.ZodUUID;
    bvid: z.ZodOptional<z.ZodString>;
    section: z.ZodDefault<z.ZodEnum<{
        video: "video";
        frame: "frame";
        comments: "comments";
        discover: "discover";
    }>>;
    feed: z.ZodOptional<z.ZodEnum<{
        home: "home";
        popular: "popular";
    }>>;
    positionMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const BiliBrowserFrameSchema: z.ZodObject<{
    dataUrl: z.ZodString;
    positionMs: z.ZodNumber;
    durationMs: z.ZodNumber;
}, z.core.$strict>;
export declare const BiliBrowserResultSchema: z.ZodObject<{
    transport: z.ZodLiteral<"dsh-browser">;
    accountUid: z.ZodString;
    bvid: z.ZodNullable<z.ZodString>;
    section: z.ZodEnum<{
        video: "video";
        frame: "frame";
        comments: "comments";
        discover: "discover";
    }>;
    feed: z.ZodOptional<z.ZodEnum<{
        home: "home";
        popular: "popular";
    }>>;
    url: z.ZodString;
    title: z.ZodString;
    text: z.ZodString;
    truncated: z.ZodBoolean;
    observedAt: z.ZodISODateTime;
    frame: z.ZodOptional<z.ZodObject<{
        dataUrl: z.ZodString;
        positionMs: z.ZodNumber;
        durationMs: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type BiliBrowserRequest = z.infer<typeof BiliBrowserRequestSchema>;
export type BiliBrowserResult = z.infer<typeof BiliBrowserResultSchema>;
export interface BiliBrowserPort {
    read(request: BiliBrowserRequest, signal: AbortSignal): Promise<BiliBrowserResult>;
}
