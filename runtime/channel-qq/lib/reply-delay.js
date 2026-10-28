import { setTimeout } from 'node:timers/promises';
import { qqMessageSequence } from '#dafeiyu/contracts';
export const deliveryAbortCode = (signal) => signal.reason instanceof Error && signal.reason.message === 'DELIVERY_INTERRUPTED_BY_MESSAGE' ? 'DELIVERY_INTERRUPTED_BY_MESSAGE' : 'DELIVERY_CANCELLED';
/** One delay per logical reply. Unicode characters count once; media bytes do not count. */
export function qqReplyDelayMs(text) { return Math.min(10000, 2000 + qqMessageSequence(text).messages.reduce((size, message) => size + Array.from(message).length, 0) * 20); }
export async function waitBetweenQqMessages(signal) { try {
    await setTimeout(650, undefined, { signal });
}
catch (error) {
    if (signal.aborted)
        throw new Error(deliveryAbortCode(signal));
    throw error;
} }
export async function waitForQqReply(text, signal) {
    try {
        await setTimeout(qqReplyDelayMs(text), undefined, { signal });
    }
    catch (error) {
        if (signal.aborted)
            throw new Error(deliveryAbortCode(signal));
        throw error;
    }
}
