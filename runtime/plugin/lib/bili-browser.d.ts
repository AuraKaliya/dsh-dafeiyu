import type { BiliBrowserRequest, BiliBrowserResult, Json } from '#dafeiyu/contracts';
export type BrowserToolCall = (name: string, args: Record<string, Json>, signal: AbortSignal) => Promise<unknown>;
/** Internal clock seam for deterministic tests; never accepted from model/tool arguments. */
export interface BrowserReadinessClock {
    now(): number;
    wait(ms: number, signal: AbortSignal): Promise<void>;
}
export declare function readBiliBrowser(request: BiliBrowserRequest, expectedUid: string, call: BrowserToolCall, signal: AbortSignal, clock?: BrowserReadinessClock): Promise<BiliBrowserResult>;
