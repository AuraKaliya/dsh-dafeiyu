import type { Context } from '@deepseek-ai/cordis';
import type { Conversation, ContextItem, ExecutionContextV3, PersonaAccess } from '#dafeiyu/contracts';
import { z } from 'zod';
import type { MemoryStore } from './store.js';
export declare const QqExpressionSaveSchema: z.ZodObject<{
    requestId: z.ZodString;
    slot: z.ZodEnum<{
        length: "length";
        tone: "tone";
        structure: "structure";
        pacing: "pacing";
        address: "address";
        other: "other";
    }>;
    text: z.ZodString;
    basis: z.ZodEnum<{
        "self-preference": "self-preference";
        "user-request": "user-request";
    }>;
    expectedVersion: z.ZodNumber;
}, z.core.$strict>;
/** Growth-owned projections of ordinary, versioned Memory records. No second personality database. */
export declare class QqExpressionPreferences {
    private readonly ctx;
    private readonly memory;
    private readonly agentId;
    private readonly ready;
    constructor(ctx: Context, memory: MemoryStore, agentId: string, ready: () => boolean);
    private entries;
    private currentSources;
    prepare(scene: Conversation): ContextItem[];
    status(scene: Conversation): {
        kind: "qq-expression-preference";
        slot: "length" | "tone" | "structure" | "pacing" | "address" | "other";
        text: string;
        basis: "self-preference" | "user-request";
        note: "只影响QQ表达；不改变身份、事实、任务或工具权限。";
        id: string;
        version: number;
    }[];
    save(context: ExecutionContextV3, access: PersonaAccess, raw: unknown): {
        slot: "length" | "tone" | "structure" | "pacing" | "address" | "other";
        version: number;
        removed: boolean;
        id?: never;
        saved?: never;
        appliesTo?: never;
        note?: never;
    } | {
        slot: "length" | "tone" | "structure" | "pacing" | "address" | "other";
        version: number;
        id: string;
        saved: boolean;
        appliesTo: string;
        note: string;
        removed?: never;
    };
}
