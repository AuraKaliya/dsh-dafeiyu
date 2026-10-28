import type { Context } from '@deepseek-ai/cordis';
import type { AgentOptions } from '@deepseek-ai/dsh-agent';
import type { ContextFormed } from '@deepseek-ai/dsh-llm';
import type { NativeExpressionPacket, ContextItem, Conversation } from '#dafeiyu/contracts';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'dafeiyu-task-result': {
            kind: 'dafeiyu-task-result';
            taskId: string;
            runId: string;
            inboundId: string;
            deliveryId: string;
        } & ContextFormed;
    }
}
/** A real, persisted DSH turn in a new target-persona session; no executor or chat transcript is inherited. */
export interface DeliveryRepair {
    previousAnswer: string;
    issues: readonly string[];
}
export declare function renderTaskResult(ctx: Context, model: AgentOptions, cwd: string, id: string, foundation: string, growth: readonly ContextItem[], packet: NativeExpressionPacket, signal: AbortSignal, guard: () => void, requestMaxBytes: number, repair?: DeliveryRepair): Promise<{
    text: string;
    resultRef: {
        sessionId: string;
        messageSeq: import("@deepseek-ai/dsh-session").SessionSeq;
        turnEndSeq: import("@deepseek-ai/dsh-session").SessionSeq;
        textHash: string;
    };
}>;
interface TargetMaterial {
    target: Conversation;
    taskId: string;
    runId: string;
    inboundId: string;
    question: string;
    evidence: NativeExpressionPacket['evidence'];
    taskState: string;
    progress?: true;
    repair?: DeliveryRepair;
}
export declare function renderPublicProgress(ctx: Context, model: AgentOptions, cwd: string, id: string, foundation: string, growth: readonly ContextItem[], material: TargetMaterial, signal: AbortSignal, guard: () => void, requestMaxBytes: number): Promise<{
    text: string;
    resultRef: {
        sessionId: string;
        messageSeq: import("@deepseek-ai/dsh-session").SessionSeq;
        turnEndSeq: import("@deepseek-ai/dsh-session").SessionSeq;
        textHash: string;
    };
}>;
export {};
