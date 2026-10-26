import { setTimeout } from 'node:timers/promises';

/** One delay per logical reply. Unicode characters count once; media bytes do not count. */
export function qqReplyDelayMs(text: string): number { return Math.min(10000, 2000 + Array.from(text).length * 20); }
export async function waitForQqReply(text: string, signal: AbortSignal): Promise<void> {
  try { await setTimeout(qqReplyDelayMs(text), undefined, { signal }); }
  catch (error) { if (signal.aborted) throw new Error('DELIVERY_CANCELLED'); throw error; }
}
