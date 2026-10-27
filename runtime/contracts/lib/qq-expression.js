import { z } from 'zod';
import { outputContract } from './task-assessment.js';
const part = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('text'), text: z.string().min(1).max(32000).refine(text => text.trim().length > 0) }),
    z.strictObject({ type: z.literal('media') }),
]);
export const QqMessageSequenceSchema = z.strictObject({ qq_messages: z.array(part).min(1).max(12) })
    .refine(value => value.qq_messages.filter(item => item.type === 'media').length <= 1);
export const QQ_EXPRESSION_DEFAULTS = 'QQ是即时聊天：按一个完整意思组织每条消息，每条通常几句话，可以一条、多条或纯表情；不强拆句、不机械轮流、不制造错别字。普通闲聊少用标题、编号和报告口吻；需要详细解释、文档或代码时保留必要细节。阶段交流考虑对方的实际需要，说明有依据的进展和阻碍。临时表达要求与当前场景优先；有价值的长期偏好可以选择保存并继续调整。';
export const QQ_SEQUENCE_INSTRUCTIONS = '普通单条回复可以直接使用正文；需要有意安排多条消息或已选媒体的位置时，使用当前消息序列契约。媒体位置仅引用本轮实际选定的部件，未指定时放在文字之后。\n' + JSON.stringify({ kind: 'channel-output-contract', schema: outputContract(QqMessageSequenceSchema) });
/** Only a complete, explicitly marked envelope changes transport semantics. Newlines remain prose. */
export function qqMessageSequence(raw) {
    const trimmed = raw.trim(), body = /^```(?:json)?\s*\r?\n?[\s\S]*\r?\n?```$/u.test(trimmed) ? trimmed.replace(/^```(?:json)?\s*\r?\n?/u, '').replace(/\r?\n?```$/u, '') : raw;
    if (!/^\s*\{\s*"qq_messages"\s*:/u.test(body))
        return { messages: raw ? [raw] : [], mediaAt: raw ? 1 : 0, structured: false };
    let value;
    try {
        value = QqMessageSequenceSchema.parse(JSON.parse(body));
    }
    catch {
        throw new Error('QQ_MESSAGE_SEQUENCE_INVALID');
    }
    const messages = [];
    let mediaAt;
    for (const item of value.qq_messages)
        if (item.type === 'text')
            messages.push(item.text);
        else
            mediaAt = messages.length;
    return { messages, mediaAt: mediaAt ?? messages.length, structured: true };
}
export const qqVisibleText = (raw) => qqMessageSequence(raw).messages.join('\n\n');
