import { z } from 'zod';
/** No remote OneBot endpoints or credential-bearing URLs in this local development connector. */
export declare function loopbackURL(value: string, protocol: 'http:' | 'ws:'): string;
export declare const platformId: z.ZodPipe<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>, z.ZodTransform<string, string | number>>;
type OneBotAction = 'get_login_info' | 'get_status' | 'get_group_list' | 'get_image' | 'get_record' | 'get_file' | 'get_forward_msg' | 'get_group_msg_history' | 'get_friend_msg_history' | 'send_private_msg' | 'send_group_msg';
export declare class OneBot {
    private readonly base;
    private readonly token;
    readonly botId: string;
    private readonly timeoutMs;
    constructor(base: string, token: string, botId: string, timeoutMs: number);
    call(action: OneBotAction, params: object, signal?: AbortSignal): Promise<unknown>;
    private request;
    verify(signal?: AbortSignal): Promise<void>;
    groups(signal: AbortSignal): Promise<{
        id: string;
        name: string;
        msgMask: 1 | 2 | 4 | 3 | null;
    }[]>;
    history(scene: {
        account: string;
        kind: string;
        id: string;
    }, anchor: string | null, signal: AbortSignal): Promise<unknown>;
}
export {};
