import type { DshToolsPort, BiliBrowserPort } from '#dafeiyu/contracts';
/** The inherited Node IPC pipe is the only bridge endpoint; no listener or public token. */
export declare function createDshBridgeClient(): DshToolsPort & {
    biliBrowser: BiliBrowserPort;
};
