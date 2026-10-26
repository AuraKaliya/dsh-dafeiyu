export interface WorkerSpec {
    executable: string;
    arguments: readonly string[];
    timeoutMs: number;
    memoryBytes: number;
    maxStdoutBytes: number;
    maxStderrBytes?: number;
    signal: AbortSignal;
}
export interface WorkerResult {
    stdout: Buffer;
    stderr: Buffer;
    peakCommitBytes: number;
    memoryLimitBytes: number;
}
export declare class MediaWorkerError extends Error {
    readonly code: string;
    constructor(code: string);
}
export declare function contained(root: string, file: string): Promise<string>;
/** Executes one known program under a Windows Job before it can read input. No shell commands. */
export declare class BoundedProcess {
    private readonly workRoot;
    private readonly powershell;
    constructor(workRoot: string, powershell?: string);
    run(raw: WorkerSpec): Promise<WorkerResult>;
}
