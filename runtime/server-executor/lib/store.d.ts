import { z } from 'zod';
import { ExecutorIdentitySchema } from './types.js';
import type { ExecutorJobSpec, ExecutorOperationBinding, ExecutorHandshake, ExecutorTaskScope, ExecutorTerminal, ExecutorReceipt, ExecutorEvent, StoredExecutorJob } from './types.js';
export declare const EXECUTOR_APPLICATION_ID = 1145460785;
export declare const EXECUTOR_SCHEMA_VERSION = 1;
/** Trusted persistence only. A job description or a copied authorization hash never authorizes dispatch. */
export declare class ExecutorStore {
    private readonly db;
    private closed;
    readonly identity: z.infer<typeof ExecutorIdentitySchema>;
    constructor(file: string, identity: z.infer<typeof ExecutorIdentitySchema>, create?: boolean);
    private initialize;
    private verifySchema;
    private transaction;
    private time;
    private scope;
    private append;
    private operation;
    private receipt;
    get(id: string, rawScope: ExecutorTaskScope): StoredExecutorJob;
    list(scope: ExecutorTaskScope): StoredExecutorJob[];
    events(id: string, scope: ExecutorTaskScope): ExecutorEvent[];
    operations(id: string, scope: ExecutorTaskScope): ExecutorOperationBinding[];
    linkBudget(id: string, scope: ExecutorTaskScope, input: {
        callId: string;
        reservationId: string;
        requestHash: string;
    }): void;
    settleBudget(id: string, scope: ExecutorTaskScope, input: {
        callId: string;
        reservationId: string;
        state: 'settled' | 'unknown';
        settlementHash: string;
    }): void;
    budgetLinks(id: string, scope: ExecutorTaskScope): {
        callId: string;
        reservationId: string;
        requestHash: string;
        state: "unknown" | "reserved" | "settled";
        settlementHash: string | null;
    }[];
    counts(): Record<string, number>;
    prepare(raw: ExecutorJobSpec, rawBinding: ExecutorOperationBinding, now?: number): {
        job: StoredExecutorJob;
        created: boolean;
    };
    claimLaunch(id: string, scope: ExecutorTaskScope, expectedVersion: number, nonceHash: string, now?: number): StoredExecutorJob;
    running(id: string, scope: ExecutorTaskScope, expectedVersion: number, raw: ExecutorHandshake, now?: number): StoredExecutorJob;
    requestCancel(id: string, scope: ExecutorTaskScope, code: string, now?: number): StoredExecutorJob;
    private sealInternal;
    seal(id: string, scope: ExecutorTaskScope, expectedVersion: number, raw: ExecutorTerminal, now?: number): ExecutorReceipt;
    /** Called under the owner's recovery lease. It never spawns, reattaches authority, or resolves unknown effects. */
    recover(now?: number): ExecutorReceipt[];
    unresolved(): number;
    close(): void;
}
