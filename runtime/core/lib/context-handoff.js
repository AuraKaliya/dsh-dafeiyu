import { ContextHandoffSchema, messageMainText, redactContent } from '#dafeiyu/contracts';
const source = (message) => message ? { conversation: message.conversation, messageId: message.id, occurredAt: message.occurredAt,
    text: redactContent(messageMainText(message)).value } : null;
/** Callers own source/epoch authorization. Never infer new tasks or grants from the text. */
export function stageHandoff(stage, goal, task, message, facts = {}, latest = null) {
    return ContextHandoffSchema.parse({ schemaVersion: 1, stage, task, goal: redactContent(goal).value, originalRequest: source(message), latestRequest: source(latest), facts,
        note: '原请求和后续原话保留其来源。保持整个任务的目标、限制与最新有效纠正；仅针对受理阶段的确认要求按当前阶段解释，不能把“只分析不实施”等任务范围限制当成已过期。事实来自程序账本，草稿不等于已发送。没有登记的口头承诺不能冒称已安排。' });
}
