import { z } from 'zod';
export const QQ_PROGRESS_ACTIONS = ['qq_progress'];
export function bindQqProgress(ctx, agentId) {
    return ctx.dafeiyu.registerExtensionV3({ protocolVersion: 3, id: 'qq-progress', version: '1', agentId, requires: ['execution.task.v1'], actions: [{
                id: 'qq_progress', version: '1', effects: 'external-write', requiresTask: true, inputSchema: z.strictObject({ kind: z.enum(['intent', 'progress', 'blocked']), text: z.string().trim().min(1).max(1000) }), outputSchema: z.json(),
                description: '必要时向本次主人任务的原QQ会话发送阶段反馈。intent说明接下来做什么；progress必须已有实际操作回执；blocked说明当前缺口。只写准备公开说的话，不写内部思考。核心会结合真实回执、原会话人格和长期表达偏好重新整理，然后发送并返回实际回执；不是每次工具调用都播报。最终结果仍另行交付，不重复总结已发送阶段消息。',
                execute: async (input, context) => {
                    try {
                        const result = await ctx.dafeiyu.deliverPublicProgress(context, 'qq-progress', input);
                        return { status: result.status === 'sent' ? 'succeeded' : result.status === 'unknown' ? 'unknown' : 'failed', effects: result.status === 'sent' ? 'confirmed' : result.status === 'unknown' ? 'unknown' : 'none', completeness: 'complete', data: z.json().parse(result), sources: [], receipts: result.status === 'sent' ? [{ kind: 'qq-message', id: result.receiptId }] : [] };
                    }
                    catch (error) {
                        const code = error instanceof Error && /^[A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'QQ_PROGRESS_FAILED';
                        if (!['MESSAGE_REQUIRED', 'SCOPE_DENIED', 'SOURCE_STALE', 'DEPENDENCY_UNAVAILABLE', 'PROGRESS_EVIDENCE_REQUIRED'].includes(code))
                            throw new Error(code);
                        return { status: 'failed', effects: 'none', completeness: 'unknown', data: null, sources: [], receipts: [], errorCode: code };
                    }
                },
            }] });
}
