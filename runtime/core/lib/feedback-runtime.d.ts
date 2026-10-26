import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { PendingMessage } from '#dafeiyu/contracts';
export type FeedbackValidator = (item: PendingMessage, metadata: unknown, text: string) => boolean;
/** Replaces only core-tagged tool results; preserves tool-call pairing and other plugins' nodes. */
export declare class FeedbackRuntime {
    private readonly scope;
    private readonly validate;
    private agent;
    private item;
    constructor(scope: Context, validate: FeedbackValidator);
    begin(item: PendingMessage, agent: Agent): void;
    end(): void;
    private retire;
    guard(options: GenerateOptions): void;
}
