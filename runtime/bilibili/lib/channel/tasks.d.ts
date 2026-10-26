import type { Context } from '@deepseek-ai/cordis';
import type { Conversation, InboundMessage } from '#dafeiyu/contracts';
export declare const BILI_OWNER_TASK_ACTIONS: readonly ["bili_owner_task_submit", "bili_owner_task_status", "bili_owner_task_control"];
export declare function biliOwnerTaskDirective(message: Pick<InboundMessage, 'mainText'>): {
    kind: 'submit' | 'cancel' | 'revise' | 'resolve' | 'none';
    text: string;
};
export declare class BiliOwnerTasks {
    private readonly ctx;
    private readonly config;
    private readonly current;
    private readonly admitting;
    private readonly handle;
    private readonly unbind;
    private closed;
    constructor(ctx: Context, config: {
        accountUid: string;
        ownerUid: string;
        agentId: string;
        policyId: string;
        version: string;
        deliverResults: boolean;
        explorationResources: readonly Conversation[];
    }, current: () => boolean, admitting: () => boolean);
    private access;
    private actions;
    close(): void;
}
