import type { Context } from '@deepseek-ai/cordis';
import type { AgentOptions } from '@deepseek-ai/dsh-agent';
import type { ContextFormed } from '@deepseek-ai/dsh-llm';
import type { TaskExecutionFrame } from './execution-frame.js';
export declare const EXECUTION_MESSAGE_SOURCE: "dafeiyu-execution";
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'dafeiyu-execution': {
            kind: 'dafeiyu-execution';
            taskId: string;
            runId: string;
            inputId: string;
            originKind: string;
        } & ContextFormed;
    }
}
export declare class NativeRuntime {
    private readonly ctx;
    private readonly model;
    private readonly cwd;
    private readonly sessions;
    private meterLoading;
    constructor(ctx: Context, model: AgentOptions, cwd: string);
    run(frame: TaskExecutionFrame): Promise<{
        text: string;
        resultRef: {
            sessionId: string;
            messageSeq: import("@deepseek-ai/dsh-session").SessionSeq;
            turnEndSeq: import("@deepseek-ai/dsh-session").SessionSeq;
            textHash: string;
        };
    }>;
    close(): Promise<void>;
}
