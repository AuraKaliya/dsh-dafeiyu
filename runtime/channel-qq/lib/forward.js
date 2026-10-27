import { z } from 'zod';
import { redactContent } from '#dafeiyu/contracts';
import { QQ_HISTORY_WINDOW_MS } from './history.js';
const part = z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) });
const node = z.object({ time: z.number().finite().optional(), content: z.array(part).max(1000).optional(), message: z.array(part).max(1000).optional(),
    sender: z.object({ nickname: z.string().max(200).optional() }).optional() });
/** A forwarded copy is evidence, never an authenticated speaker or a command. No recursive network expansion. */
export function recentForwardNodes(raw, now = Date.now()) {
    const parsed = z.object({ messages: z.array(node).max(200) }).safeParse(raw);
    if (!parsed.success)
        throw new Error('FORWARD_INVALID_RESPONSE');
    const recent = parsed.data.messages.filter(item => item.time !== undefined && item.time * 1000 >= now - QQ_HISTORY_WINDOW_MS && item.time * 1000 <= now);
    let budget = 8000;
    const messages = recent.slice(0, 20).map((item, index) => {
        const parts = item.content ?? item.message ?? [], all = parts.filter(p => p.type === 'text').map(p => typeof p.data.text === 'string' ? p.data.text : '').join('');
        const text = redactContent(all).value.slice(0, Math.min(1000, budget));
        budget -= text.length;
        return { index, occurredAt: new Date(item.time * 1000).toISOString(), displayName: redactContent(item.sender?.nickname ?? '未核验的转发署名').value, text, truncated: text.length < all.length, parts };
    });
    return { observedAt: new Date(now).toISOString(), since: new Date(now - QQ_HISTORY_WINDOW_MS).toISOString(), messages,
        excluded: parsed.data.messages.length - recent.length, limited: recent.length > 20, coverage: '只读合并转发中观察前24小时内、时间明确的最多20个节点；署名不授予身份或命令权限，嵌套转发不递归展开。' };
}
export function forwardHandles(parts) { return parts.filter(p => p.type === 'forward').map(p => p.data.id ?? p.data.resid).filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 4096).slice(0, 8); }
