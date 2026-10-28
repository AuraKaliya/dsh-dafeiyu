import type { Context } from '@deepseek-ai/cordis';
import type { AgentOptions } from '@deepseek-ai/dsh-agent';
import type { ContextItem, Json } from '#dafeiyu/contracts';
import { z } from 'zod';
export declare const RecoveryDecisionSchema: z.ZodObject<{
    next: z.ZodEnum<{
        wait: "wait";
        answer: "answer";
    }>;
    message: z.ZodString;
}, z.core.$strict>;
export declare const ReplyDecisionSchema: z.ZodObject<{
    decisions: z.ZodArray<z.ZodObject<{
        inboundId: z.ZodUUID;
        action: z.ZodEnum<{
            wait: "wait";
            resume: "resume";
            supersede: "supersede";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** A separate, tool-free recovery stage. It never repeats the failed model turn or its operations. */
export declare function renderConversationRecovery(ctx: Context, model: AgentOptions, cwd: string, id: string, persona: string, growth: readonly ContextItem[], facts: Json, signal: AbortSignal, guard: () => void): Promise<{
    next: "wait" | "answer";
    message: string;
}>;
export declare function decidePendingReplies(ctx: Context, model: AgentOptions, cwd: string, id: string, persona: string, growth: readonly ContextItem[], facts: Json, signal: AbortSignal, guard: () => void): Promise<{
    decisions: {
        inboundId: string;
        action: "wait" | "resume" | "supersede";
    }[];
}>;
