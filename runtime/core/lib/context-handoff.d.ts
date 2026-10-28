import type { ContextHandoff, ContextStage, InboundMessage, Json } from '#dafeiyu/contracts';
/** Callers own source/epoch authorization. Never infer new tasks or grants from the text. */
export declare function stageHandoff(stage: ContextStage, goal: string, task: ContextHandoff['task'], message: InboundMessage | null, facts?: Record<string, Json>, latest?: InboundMessage | null): ContextHandoff;
