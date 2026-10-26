import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type { DeliveryResult, ExtensionHandle, Reply } from '#dafeiyu/contracts';
export declare const name = "dafeiyu-channel-simulator";
export declare const inject: string[];
export interface Config {
    agentId: string;
    account: string;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        dafeiyuSimulator: Simulator;
    }
}
/** Local-only transport; no sockets, login state, platform SDK, or remote credentials. */
export declare class Simulator extends Service {
    private readonly config;
    readonly deliveries: Reply[];
    private readonly outcomes;
    private readonly receipts;
    readonly handle: ExtensionHandle;
    constructor(ctx: Context, config: Config);
    /** Controls the next transmission outcome for deterministic failure tests. */
    nextDelivery(result: DeliveryResult): void;
    send(conversation: string, text: string, options: {
        id: string;
        sender?: string;
        occurredAt?: string;
    }): import("#dafeiyu/contracts").Receipt;
}
export declare function apply(ctx: Context, config: Config): void;
