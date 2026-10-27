import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { InboundMessage } from '#dafeiyu/contracts';
export declare const QqBatchConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    quietMs: z.ZodDefault<z.ZodNumber>;
    maxWaitMs: z.ZodDefault<z.ZodNumber>;
    maxMessages: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export interface QqBatchHost {
    current(message: InboundMessage): boolean;
    submit(message: InboundMessage): void;
    failed(): void;
}
/** Pending inputs are durable before acknowledgement. Submission is idempotent in Core. */
export declare class QqMessageBatches {
    private readonly db;
    private readonly config;
    private readonly host;
    private readonly now;
    private timer;
    private running;
    private readonly continuing;
    constructor(db: DatabaseSync, config: z.output<typeof QqBatchConfigSchema>, host: QqBatchHost, now?: () => number);
    private lane;
    private waiting;
    private continuous;
    has(message: InboundMessage): boolean;
    discard(message: InboundMessage): void;
    enqueue(message: InboundMessage, focused: boolean): void;
    private flush;
    private submit;
    private finish;
    drain(): void;
    private arm;
    start(): void;
    pause(): void;
    count(): number;
}
