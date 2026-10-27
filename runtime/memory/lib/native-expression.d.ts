import type { Context } from '@deepseek-ai/cordis';
import type { DatabaseSync } from 'node:sqlite';
import type { NativeExpressionAccess, NativeExpressionPort } from '#dafeiyu/contracts';
import type { MemoryStore } from './store.js';
import type { TaskExpression } from './expression.js';
export declare function migrateNativeExpression(db: DatabaseSync): void;
export declare class NativeExpression implements NativeExpressionPort {
    private readonly ctx;
    private readonly db;
    private readonly store;
    private readonly expression;
    readonly ready: () => boolean;
    private readonly flush;
    private readonly stop;
    readonly signal: AbortSignal;
    private readonly pending;
    constructor(ctx: Context, db: DatabaseSync, store: MemoryStore, expression: TaskExpression, ready: () => boolean, flush: () => void);
    private audit;
    private build;
    prepare(access: NativeExpressionAccess): {
        id: string;
        version: number;
        anchor: {
            kind: "task-result";
            schemaVersion: 1;
            taskId: string;
            runId: string;
            inboundId: string;
            target: {
                channel: string;
                account: string;
                kind: "private" | "group" | "local";
                id: string;
            };
            intentVersion: number;
            authorityVersion: string;
            expiresAt: string;
            outcome?: "waiting" | undefined;
        };
        question: string;
        evidence: {
            id: string;
            kind: "inference" | "reported";
            text: string;
        }[];
        sourceStamp: string;
        resultIncluded: boolean;
        media?: {
            draftId: string;
            draftVersion: number;
            sourceStamp: string;
            parts: ({
                kind: "asset";
                delivery: "record" | "file" | "image";
                asset: {
                    schemaVersion: 1;
                    id: string;
                    version: number;
                    kind: "image" | "document" | "audio" | "video";
                    sha256: string;
                    bytes: number;
                    mime: string;
                };
                name: string | null;
            } | {
                kind: "final-voice";
            })[];
        } | undefined;
    };
    open(access: NativeExpressionAccess, id: string, purpose?: 'send' | 'context'): {
        id: string;
        version: number;
        anchor: {
            kind: "task-result";
            schemaVersion: 1;
            taskId: string;
            runId: string;
            inboundId: string;
            target: {
                channel: string;
                account: string;
                kind: "private" | "group" | "local";
                id: string;
            };
            intentVersion: number;
            authorityVersion: string;
            expiresAt: string;
            outcome?: "waiting" | undefined;
        };
        question: string;
        evidence: {
            id: string;
            kind: "inference" | "reported";
            text: string;
        }[];
        sourceStamp: string;
        resultIncluded: boolean;
        media?: {
            draftId: string;
            draftVersion: number;
            sourceStamp: string;
            parts: ({
                kind: "asset";
                delivery: "record" | "file" | "image";
                asset: {
                    schemaVersion: 1;
                    id: string;
                    version: number;
                    kind: "image" | "document" | "audio" | "video";
                    sha256: string;
                    bytes: number;
                    mime: string;
                };
                name: string | null;
            } | {
                kind: "final-voice";
            })[];
        } | undefined;
    };
    withdraw(access: NativeExpressionAccess, id: string, version: number): void;
    verify(access: NativeExpressionAccess, id: string, answer: string, signal: AbortSignal, guard: () => void): Promise<void>;
    cancel(): void;
    whenIdle(): Promise<void>;
    close(): Promise<void>;
}
