import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type { InboundMessage, Conversation } from '#dafeiyu/contracts';
export declare const QQ_TASK_ACTIONS: readonly ["qq_task_submit", "qq_task_status", "qq_task_control", "qq_explore"];
export declare const QqTasksConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    deliverResults: z.ZodDefault<z.ZodBoolean>;
    policyId: z.ZodDefault<z.ZodString>;
    explorationResources: z.ZodOptional<z.ZodArray<z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            private: "private";
            group: "group";
            local: "local";
        }>;
        id: z.ZodString;
    }, z.core.$strict>>>;
    expressionPolicy: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        version: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare function qqTaskDirective(message: Pick<InboundMessage, 'mainText' | 'batch'>, names?: readonly string[]): {
    kind: 'submit' | 'cancel' | 'revise' | 'resolve' | 'none';
    text: string;
};
export declare class QqTaskCapabilities {
    private readonly ctx;
    private readonly handle;
    private readonly unbind;
    private closed;
    constructor(ctx: Context, config: {
        agentId: string;
        botId: string;
        ownerId: string;
        policyId: string;
        naturalNames: readonly string[];
        deliverResults: boolean;
        voiceDirectives?: boolean;
        explorationResources?: readonly Conversation[];
        expressionPolicy?: {
            id: string;
            version: number;
        };
    });
    private actions;
    close(): void;
}
