import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { z } from 'zod';
import type { ExecutorProcess } from './types.js';
import type { ExecutionBudgetPort, ExecutorBudgetRecord } from './budget.js';
import type { ExecutorRoute, ExecutorToolRecord } from './protocol.js';
import type { ExecutorVisibleOutput } from './output.js';
export declare const ExecutorNodeCommandSchema: z.ZodObject<{
    nodePath: z.ZodString;
    entryPath: z.ZodString;
    cwd: z.ZodString;
    args: z.ZodArray<z.ZodString>;
    nodeHash: z.ZodString;
    entryHash: z.ZodString;
    profilePath: z.ZodString;
    profileHash: z.ZodString;
    env: z.ZodObject<{
        SystemRoot: z.ZodOptional<z.ZodString>;
        WINDIR: z.ZodOptional<z.ZodString>;
        PATH: z.ZodOptional<z.ZodString>;
        TEMP: z.ZodOptional<z.ZodString>;
        TMP: z.ZodOptional<z.ZodString>;
        DSH_PERMISSION_MODE: z.ZodOptional<z.ZodLiteral<"danger-full-access">>;
        DSH_HOME: z.ZodOptional<z.ZodString>;
        DSH_TELEMETRY_DISABLED: z.ZodOptional<z.ZodLiteral<"1">>;
    }, z.core.$strict>;
}, z.core.$strict>;
export type ExecutorNodeCommand = z.infer<typeof ExecutorNodeCommandSchema>;
/** Production supplies OS creation/token evidence. A test fixture must label its own substitute as simulated. */
export interface ExecutorProcessControl {
    identify(child: ChildProcess): Promise<ExecutorProcess>;
    terminate(child: ChildProcess, expected: ExecutorProcess): Promise<{
        verified: boolean;
    }>;
}
export interface ExecutorNodeRunOptions {
    command: ExecutorNodeCommand;
    jobId: string;
    nonce: string;
    input: string;
    authorizationId: string;
    route: ExecutorRoute;
    deadline: number;
    budget: ExecutionBudgetPort;
    guard: () => void;
    beforeSpawn: () => void | Promise<void>;
    onReady: (process: ExecutorProcess) => void | Promise<void>;
    processControl: ExecutorProcessControl;
    signal?: AbortSignal;
    handshakeTimeoutMs?: number;
    cancelGraceMs?: number;
    allowedTools?: readonly string[];
}
export interface ExecutorNodeRunResult {
    schemaVersion: 1;
    spawned: boolean;
    ready: boolean;
    finished: boolean;
    process: ExecutorProcess | null;
    exit: {
        code: number | null;
        signal: string | null;
    } | null;
    termination: {
        requested: boolean;
        verified: boolean;
    };
    output: ExecutorVisibleOutput;
    budget: readonly ExecutorBudgetRecord[];
    tools: readonly ExecutorToolRecord[];
    gaps: readonly string[];
}
export declare function executorSpawnOptions(command: ExecutorNodeCommand): SpawnOptions;
/** Only starts an already authorized, fixed Node program; it does not classify business effects or send platform messages. */
export declare function runExecutorNode(options: ExecutorNodeRunOptions): Promise<ExecutorNodeRunResult>;
