import { z } from 'zod';
import type { Conversation } from './index.js';
/** Opaque by identity at the core boundary; only issued during a context preparation cycle. */
export interface ContextRequest {
    readonly conversation: Conversation;
    readonly sourceMessageId: string;
    readonly signal: AbortSignal;
}
export declare const ContextItemSchema: z.ZodObject<{
    id: z.ZodString;
    version: z.ZodString;
    text: z.ZodString;
    sources: z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        version: z.ZodString;
        hash: z.ZodString;
    }, z.core.$strict>>;
    expiresAt: z.ZodISODateTime;
}, z.core.$strict>;
export type ContextItem = z.infer<typeof ContextItemSchema>;
export interface ContextContributor {
    readonly id: string;
    readonly kind: 'working-state' | 'evidence' | 'operational-fact';
    /** Return only selected atomic entries. Never return a whole analysis report or search hit list. */
    prepare(request: ContextRequest): Promise<readonly ContextItem[]>;
    /** Synchronous admission check; false retires the entry without affecting other contributors. */
    validate(request: ContextRequest, item: Readonly<ContextItem>): boolean;
}
