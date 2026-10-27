/** One delay per logical reply. Unicode characters count once; media bytes do not count. */
export declare function qqReplyDelayMs(text: string): number;
export declare function waitForQqReply(text: string, signal: AbortSignal): Promise<void>;
