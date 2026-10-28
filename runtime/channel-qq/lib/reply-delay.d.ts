export declare const deliveryAbortCode: (signal: AbortSignal) => "DELIVERY_INTERRUPTED_BY_MESSAGE" | "DELIVERY_CANCELLED";
/** One delay per logical reply. Unicode characters count once; media bytes do not count. */
export declare function qqReplyDelayMs(text: string): number;
export declare function waitBetweenQqMessages(signal: AbortSignal): Promise<void>;
export declare function waitForQqReply(text: string, signal: AbortSignal): Promise<void>;
