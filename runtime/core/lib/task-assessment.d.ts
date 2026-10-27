import type { Context } from '@deepseek-ai/cordis';
import type { AgentOptions } from '@deepseek-ai/dsh-agent';
import type { Json } from '#dafeiyu/contracts';
import type { TaskExecutionFrame } from './execution-frame.js';
import type { RunResultRef } from './runtime-store.js';
/** A program-owned phase. The model evaluates value and sufficiency; it cannot forge program facts. */
export declare function assessTask(ctx: Context, model: AgentOptions, cwd: string, frame: TaskExecutionFrame, draft: {
    text: string;
    resultRef: RunResultRef;
}, facts: Json): Promise<{
    assessment: {
        goalStatus: "met" | "partial" | "unmet" | "uncertain";
        summary: string;
        evidenceIds: string[];
        limitations: string[];
        unfinished: string[];
        requiredCapabilities: string[];
        retainExperience: boolean;
        next: "deliver" | "continue" | "wait" | "capability-change";
    };
    resultRef: {
        sessionId: string;
        messageSeq: import("@deepseek-ai/dsh-session").SessionSeq;
        turnEndSeq: import("@deepseek-ai/dsh-session").SessionSeq;
        textHash: string;
    };
}>;
