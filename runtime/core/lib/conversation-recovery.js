import { inspectRequestCapacity } from './context-plan.js';
import { phaseStream } from './phase-stream.js';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { z } from 'zod';
import { runAgentTurn } from './agent-session.js';
import { visibleStream } from './visible-stream.js';
export const RecoveryDecisionSchema = z.strictObject({ next: z.enum(['answer', 'wait']), message: z.string().trim().min(1).max(2000) });
export const ReplyDecisionSchema = z.strictObject({ decisions: z.array(z.strictObject({ inboundId: z.uuid(), action: z.enum(['resume', 'supersede', 'wait']) })).min(1).max(6) });
/** A separate, tool-free recovery stage. It never repeats the failed model turn or its operations. */
export async function renderConversationRecovery(ctx, model, cwd, id, persona, growth, facts, signal, guard) { return renderDecision(ctx, model, cwd, 'dafeiyu-recovery-' + id, persona, growth, facts, signal, guard, RecoveryDecisionSchema, '当前会话的一次处理没有完成。你负责理解程序提供的进展与局限，判断现有材料足以回答还是需要等待，并以当前人格向原会话自然说明。操作回执与来源状态是事实；先前输出并不代表已经送达。没有材料支持的成果仍是未知，不承诺不存在的自动续跑。程序负责保存进度和实际交付。'); }
export async function decidePendingReplies(ctx, model, cwd, id, persona, growth, facts, signal, guard) { return renderDecision(ctx, model, cwd, 'dafeiyu-reply-decision-' + id, persona, growth, facts, signal, guard, ReplyDecisionSchema, '当前收到一条新消息，前一答复有确定尚未发送的部分。你负责理解新消息与原问题的关系，判断是否续发、由当前回答替代、或等待澄清。追加信息不自动等于取消；明确改变目标时应重新判断旧答复的适用性。程序负责来源、权限、逐段回执及实际发送，不需要你复写这些事实。'); }
async function renderDecision(ctx, model, cwd, id, persona, growth, facts, signal, guard, schema, purpose) {
    signal = AbortSignal.any([signal, AbortSignal.timeout(ctx.dafeiyu.phaseTimeouts().feedback)]);
    const sessionId = SessionId(id);
    if (await ctx.sessionPersistence.stat(sessionId))
        throw new Error('RECOVERY_ALREADY_ATTEMPTED');
    const handle = await ctx.agents.create({ sessionId, meta: { cwd }, agentOptions: { ...model, maxTokens: 4096 }, setup: scope => {
            scope.tools.presentAs('native');
            scope.tools.restrict({ allow: [] });
            scope.on('system-prompt/assemble', async () => ({ sections: [{ name: 'persona', text: persona, interpolate: false }, { name: 'recovery-purpose', text: purpose, interpolate: false }], contexts: [{ name: 'current-persona', text: JSON.stringify(growth), interpolate: false }, { name: 'decision-contract', text: JSON.stringify(z.toJSONSchema(schema)), interpolate: false }], tools: [], variables: {} }));
            scope.on('llm/stream', async function* (options, next) {
                if (options.sessionId !== sessionId) {
                    yield* next();
                    return;
                }
                const budget = ctx.dafeiyu.contextBudget();
                await inspectRequestCapacity(scope, options, budget.requestMaxBytes, budget.outputReserveBytes);
                guard();
                let chars = 0;
                for await (const chunk of phaseStream(visibleStream(next()), signal)) {
                    signal.throwIfAborted();
                    if (chunk.type === 'tool-call-delta' || chunk.type === 'block-start' && chunk.blockType === 'tool-call')
                        throw new Error('RECOVERY_TOOLS_FORBIDDEN');
                    if (chunk.type === 'text-delta')
                        chars += chunk.text.length;
                    if (chars > 10000)
                        throw new Error('RECOVERY_OUTPUT_LIMIT');
                    yield chunk;
                }
                guard();
            });
        } });
    try {
        guard();
        const result = await runAgentTurn(ctx, handle.agent, createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: JSON.stringify(facts && typeof facts === 'object' && !Array.isArray(facts) ? { ...facts, stage: 'recovery' } : { stage: 'recovery', facts }) }] }), signal);
        guard();
        return schema.parse(JSON.parse(result.text));
    }
    finally {
        await handle.dispose();
    }
}
