export type ExecutorVisibleEvent = {
    type: 'session';
    sessionId: string;
} | {
    type: 'status';
    phase: string;
    turn: number | null;
    step: number | null;
} | {
    type: 'tool_call';
    callHash: string;
    tool: string;
} | {
    type: 'tool_result';
    callHash: string;
    status: 'error' | 'completed';
};
export interface ExecutorVisibleOutput {
    schemaVersion: 1;
    sessionId: string | null;
    final: {
        kind: 'executor-self-report';
        text: string;
        redacted: boolean;
        truncated: boolean;
    } | null;
    events: readonly ExecutorVisibleEvent[];
    counts: {
        stdoutBytes: number;
        stderrBytes: number;
        toolCalls: number;
        toolResults: number;
        discarded: number;
    };
    gaps: readonly string[];
}
/** The raw stream is never archived. Thinking, tool payloads, intermediate text and stderr content are discarded. */
export declare class ExecutorOutputCollector {
    private readonly decoder;
    private readonly maxLineBytes;
    private readonly maxFinalBytes;
    private readonly maxEvents;
    private buffer;
    private dropping;
    private ended;
    private readonly events;
    private readonly gaps;
    private readonly counts;
    private sessionId;
    private final;
    constructor(options?: {
        maxLineBytes?: number;
        maxFinalBytes?: number;
        maxEvents?: number;
    });
    stdout(chunk: Uint8Array): void;
    stderr(chunk: Uint8Array): void;
    private consume;
    private append;
    private line;
    finish(): ExecutorVisibleOutput;
}
