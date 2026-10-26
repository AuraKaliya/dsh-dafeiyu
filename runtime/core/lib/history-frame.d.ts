import type { PendingMessage } from '#dafeiyu/contracts';
/** History scope carries an actual input identity, never a fabricated conversation. */
export interface HistoryFrame {
    readonly id: string;
    readonly route: string;
    readonly sessionId: string;
    readonly inputKind: 'user' | 'dafeiyu-execution';
    readonly inputSourceId: string;
}
export declare function conversationHistory(item: PendingMessage): HistoryFrame;
