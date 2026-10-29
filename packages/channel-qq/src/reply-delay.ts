import { setTimeout } from 'node:timers/promises';
import { qqMessageSequence } from '@dafeiyu/contracts';
import { z } from 'zod';
export const QqReplyDelaySchema=z.strictObject({enabled:z.boolean().default(true),minimumMs:z.number().int().min(0).max(60000).default(2000),perCharacterMs:z.number().min(0).max(1000).default(20),maximumMs:z.number().int().min(0).max(120000).default(10000),betweenMessagesMs:z.number().int().min(0).max(60000).default(650)}).refine(value=>value.maximumMs>=value.minimumMs,'Maximum delay must cover minimum delay');
export type QqReplyDelay=z.infer<typeof QqReplyDelaySchema>;
export const deliveryAbortCode=(signal:AbortSignal)=>signal.reason instanceof Error&&signal.reason.message==='DELIVERY_INTERRUPTED_BY_MESSAGE'?'DELIVERY_INTERRUPTED_BY_MESSAGE':'DELIVERY_CANCELLED';

/** One delay per logical reply. Unicode characters count once; media bytes do not count. */
export function qqReplyDelayMs(text: string,config:QqReplyDelay=QqReplyDelaySchema.parse({})): number { return config.enabled?Math.min(config.maximumMs, config.minimumMs + qqMessageSequence(text).messages.reduce((size,message)=>size+Array.from(message).length,0) * config.perCharacterMs):0; }
export async function waitBetweenQqMessages(signal:AbortSignal,config:QqReplyDelay=QqReplyDelaySchema.parse({})):Promise<void>{try{await setTimeout(config.enabled?config.betweenMessagesMs:0,undefined,{signal});}catch(error){if(signal.aborted)throw new Error(deliveryAbortCode(signal));throw error;}}
export async function waitForQqReply(text: string, signal: AbortSignal,config:QqReplyDelay=QqReplyDelaySchema.parse({})): Promise<void> {
  try { await setTimeout(qqReplyDelayMs(text,config), undefined, { signal }); }
  catch (error) { if (signal.aborted) throw new Error(deliveryAbortCode(signal)); throw error; }
}
