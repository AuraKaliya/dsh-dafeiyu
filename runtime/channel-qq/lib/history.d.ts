import { z } from 'zod';
import type { Conversation } from '#dafeiyu/contracts';
export declare const QQ_HISTORY_WINDOW_MS: number;
declare const messageSchema: z.ZodObject<{
    message_id: z.ZodPipe<z.ZodPipe<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>, z.ZodTransform<string, string | number>>, z.ZodString>;
    message_type: z.ZodEnum<{
        private: "private";
        group: "group";
    }>;
    user_id: z.ZodPipe<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>, z.ZodTransform<string, string | number>>;
    group_id: z.ZodOptional<z.ZodPipe<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>, z.ZodTransform<string, string | number>>>;
    target_id: z.ZodOptional<z.ZodPipe<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>, z.ZodTransform<string, string | number>>>;
    self_id: z.ZodOptional<z.ZodPipe<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>, z.ZodTransform<string, string | number>>>;
    time: z.ZodNumber;
    message: z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        data: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type QqHistoryMessage = z.infer<typeof messageSchema>;
interface HistoryHost {
    botId: string;
    allowed(scene: Conversation): boolean;
    fetch(scene: Conversation, anchor: string | null, signal: AbortSignal): Promise<unknown>;
    append(scene: Conversation, message: QqHistoryMessage): {
        added: boolean;
        media: number;
    };
    now?: () => number;
}
/** Explicit observation only. Historical messages never enter the live message/trigger pipeline. */
export declare function readRecentQqHistory(host: HistoryHost, scene: Conversation, signal: AbortSignal): Promise<{
    since: string;
    until: string;
    pages: number;
    received: number;
    appended: number;
    mediaReferences: number;
    excluded: number;
    limited: boolean;
    coverage: string;
}>;
export {};
