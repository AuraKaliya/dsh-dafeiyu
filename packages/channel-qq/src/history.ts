import { z } from 'zod';
import type { Conversation } from '@dafeiyu/contracts';
import { platformId } from './onebot.js';

export const QQ_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const messageSchema = z.object({
  message_id: platformId.pipe(z.string().max(80)), message_type: z.enum(['private', 'group']),
  user_id: platformId, group_id: platformId.optional(), target_id: platformId.optional(), self_id: platformId.optional(),
  time: z.number().finite().nonnegative().max(253402300799),
  message: z.array(z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) })).max(1000),
});
export type QqHistoryMessage = z.infer<typeof messageSchema>;
interface HistoryHost {
  botId: string;
  windowMs?:number;
  allowed(scene: Conversation): boolean;
  fetch(scene: Conversation, anchor: string | null, signal: AbortSignal): Promise<unknown>;
  append(scene: Conversation, message: QqHistoryMessage): { added: boolean; media: number };
  now?: () => number;
}

/** Explicit observation only. Historical messages never enter the live message/trigger pipeline. */
export async function readRecentQqHistory(host: HistoryHost, scene: Conversation, signal: AbortSignal) {
  const now = host.now?.() ?? Date.now(), since = now - (host.windowMs??QQ_HISTORY_WINDOW_MS);
  const guard = () => { signal.throwIfAborted(); if (scene.channel !== 'qq' || scene.account !== host.botId || !host.allowed(scene)) throw new Error('TARGET_NOT_ALLOWED'); };
  const seen = new Set<string>(); let anchor: string | null = null, pages = 0, received = 0, appended = 0, media = 0, excluded = 0, limited = false;
  for (; pages < 5;) {
    guard(); const raw = await host.fetch(scene, anchor, signal); guard();
    const parsed = z.object({ messages: z.array(messageSchema).max(20) }).safeParse(raw);
    if (!parsed.success) throw new Error('HISTORY_INVALID_RESPONSE');
    pages++; const batch = parsed.data.messages; received += batch.length;
    const valid = batch.filter(message => {
      const ownAccount = message.self_id === undefined || message.self_id === host.botId;
      const sameScene = message.message_type === scene.kind && (scene.kind === 'group' ? message.group_id === scene.id
        : message.user_id === scene.id && (message.target_id === undefined || message.target_id === host.botId)
          || message.user_id === host.botId && message.target_id === scene.id);
      if (!ownAccount || !sameScene || message.time * 1000 < since || message.time * 1000 > now) { excluded++; return false; }
      return true;
    });
    let fresh = 0;
    for (const message of valid.sort((a, b) => a.time - b.time)) {
      guard(); if (seen.has(message.message_id)) continue; seen.add(message.message_id); fresh++;
      const result = host.append(scene, message); if (result.added) appended++; media += result.media;
    }
    // OneBot has no server-side time parameter. Drop out-of-window bodies and stop at that boundary.
    if (batch.length < 20 || !fresh || batch.some(message => message.time * 1000 < since)) break;
    const oldest = valid[0]; if (!oldest || oldest.message_id === anchor) break; anchor = oldest.message_id;
    if (pages === 5) limited = true;
  }
  guard(); return { since: new Date(since).toISOString(), until: new Date(now).toISOString(), pages, received, appended, mediaReferences: media, excluded, limited,
    coverage: '仅按需追加配置时间窗口内、当前已授权会话的实际QQ记录；最多5页。不覆盖已有文字、不自动重放；可由核心选择感兴趣内容引用回复。平台记录可能不完整。' };
}
