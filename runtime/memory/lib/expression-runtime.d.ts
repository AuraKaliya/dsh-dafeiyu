import type { Context } from '@deepseek-ai/cordis';
export interface ExpressionModelInput {
    question: string;
    evidence: {
        id: string;
        text: string;
    }[];
}
/** Final persona wording is checked against exactly the approved target evidence. */
export declare function verifyPersonaDelivery(ctx: Context, input: ExpressionModelInput, answer: string, signal: AbortSignal, guard: () => void, bounds?: {
    maxAnswerChars: number;
    maxInputBytes: number;
}): Promise<void>;
/** Two fresh, tool-free DSH transport requests. No host prompt, task text, history or previous answer is inherited. */
export declare function rebuildExpression(ctx: Context, input: ExpressionModelInput, signal: AbortSignal, guard: () => void): Promise<{
    verification: {
        faithful: boolean;
        issues: string[];
    };
    model: Readonly<{
        reasoningEffort?: string;
        provider: string;
        model: string;
    }>;
    answer: string;
    citations: string[];
    insufficient: boolean;
}>;
