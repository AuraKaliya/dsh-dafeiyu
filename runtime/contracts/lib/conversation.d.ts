import { z } from 'zod';
export declare const ConversationSchema: z.ZodObject<{
    channel: z.ZodString;
    account: z.ZodString;
    kind: z.ZodEnum<{
        private: "private";
        group: "group";
        local: "local";
    }>;
    id: z.ZodString;
}, z.core.$strict>;
export type Conversation = z.infer<typeof ConversationSchema>;
