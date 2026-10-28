import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Json, TaskResultAnchor, Conversation } from '#dafeiyu/contracts';
export declare const nativeDeliveryHash: (value: unknown) => string;
declare const stateSchema: z.ZodEnum<{
    accepted: "accepted";
    rendering: "rendering";
    verifying: "verifying";
    ready: "ready";
    sending: "sending";
    sent: "sent";
    "not-sent": "not-sent";
    partial: "partial";
    uncertain: "uncertain";
    rejected: "rejected";
    interrupted: "interrupted";
}>;
export type NativeDeliveryState = z.infer<typeof stateSchema>;
declare const materialSchema: z.ZodObject<{
    packetId: z.ZodUUID;
    sourceStamp: z.ZodString;
    foundationHash: z.ZodString;
    personaHash: z.ZodString;
    modelHash: z.ZodString;
    mediaStamp: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type NativeDeliveryMaterial = z.infer<typeof materialSchema>;
declare const renderRef: z.ZodObject<{
    sessionId: z.ZodString;
    messageSeq: z.ZodNumber;
    turnEndSeq: z.ZodNumber;
    textHash: z.ZodString;
}, z.core.$strict>;
export declare function migrateNativeDeliveries(db: DatabaseSync): void;
export declare class NativeDeliveryStore {
    private readonly db;
    private readonly atomic;
    private readonly event;
    constructor(db: DatabaseSync, atomic: <T>(work: () => T) => T, event: (runId: string, type: string, data: Record<string, Json>) => unknown);
    get(runId: string): {
        id: string;
        runId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
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
        material: {
            packetId: string;
            sourceStamp: string;
            foundationHash: string;
            personaHash: string;
            modelHash: string;
            mediaStamp?: string | undefined;
        } | null;
        renderRef: {
            sessionId: string;
            messageSeq: number;
            turnEndSeq: number;
            textHash: string;
        } | null;
        body: string | null;
        credential: string | null;
        receipt: string | null;
        error: string | null;
    } | null;
    create(anchor: TaskResultAnchor): {
        id: string;
        runId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
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
        material: {
            packetId: string;
            sourceStamp: string;
            foundationHash: string;
            personaHash: string;
            modelHash: string;
            mediaStamp?: string | undefined;
        } | null;
        renderRef: {
            sessionId: string;
            messageSeq: number;
            turnEndSeq: number;
            textHash: string;
        } | null;
        body: string | null;
        credential: string | null;
        receipt: string | null;
        error: string | null;
    };
    private advance;
    start(runId: string, raw: NativeDeliveryMaterial): {
        id: string;
        runId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
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
        material: {
            packetId: string;
            sourceStamp: string;
            foundationHash: string;
            personaHash: string;
            modelHash: string;
            mediaStamp?: string | undefined;
        } | null;
        renderRef: {
            sessionId: string;
            messageSeq: number;
            turnEndSeq: number;
            textHash: string;
        } | null;
        body: string | null;
        credential: string | null;
        receipt: string | null;
        error: string | null;
    };
    candidate(runId: string, raw: z.infer<typeof renderRef>): {
        id: string;
        runId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
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
        material: {
            packetId: string;
            sourceStamp: string;
            foundationHash: string;
            personaHash: string;
            modelHash: string;
            mediaStamp?: string | undefined;
        } | null;
        renderRef: {
            sessionId: string;
            messageSeq: number;
            turnEndSeq: number;
            textHash: string;
        } | null;
        body: string | null;
        credential: string | null;
        receipt: string | null;
        error: string | null;
    };
    repair(runId: string): {
        id: string;
        runId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
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
        material: {
            packetId: string;
            sourceStamp: string;
            foundationHash: string;
            personaHash: string;
            modelHash: string;
            mediaStamp?: string | undefined;
        } | null;
        renderRef: {
            sessionId: string;
            messageSeq: number;
            turnEndSeq: number;
            textHash: string;
        } | null;
        body: string | null;
        credential: string | null;
        receipt: string | null;
        error: string | null;
    };
    rendered(runId: string, raw: z.infer<typeof renderRef>): {
        id: string;
        runId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
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
        material: {
            packetId: string;
            sourceStamp: string;
            foundationHash: string;
            personaHash: string;
            modelHash: string;
            mediaStamp?: string | undefined;
        } | null;
        renderRef: {
            sessionId: string;
            messageSeq: number;
            turnEndSeq: number;
            textHash: string;
        } | null;
        body: string | null;
        credential: string | null;
        receipt: string | null;
        error: string | null;
    };
    approve(runId: string, body: string): {
        id: string;
        runId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
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
        material: {
            packetId: string;
            sourceStamp: string;
            foundationHash: string;
            personaHash: string;
            modelHash: string;
            mediaStamp?: string | undefined;
        } | null;
        renderRef: {
            sessionId: string;
            messageSeq: number;
            turnEndSeq: number;
            textHash: string;
        } | null;
        body: string | null;
        credential: string | null;
        receipt: string | null;
        error: string | null;
    };
    verifyCredential(runId: string): string;
    sending(runId: string): {
        id: string;
        runId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
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
        material: {
            packetId: string;
            sourceStamp: string;
            foundationHash: string;
            personaHash: string;
            modelHash: string;
            mediaStamp?: string | undefined;
        } | null;
        renderRef: {
            sessionId: string;
            messageSeq: number;
            turnEndSeq: number;
            textHash: string;
        } | null;
        body: string | null;
        credential: string | null;
        receipt: string | null;
        error: string | null;
    };
    finish(runId: string, state: 'sent' | 'not-sent' | 'partial' | 'uncertain', receipt: string | null, code: string | null): {
        id: string;
        runId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
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
        material: {
            packetId: string;
            sourceStamp: string;
            foundationHash: string;
            personaHash: string;
            modelHash: string;
            mediaStamp?: string | undefined;
        } | null;
        renderRef: {
            sessionId: string;
            messageSeq: number;
            turnEndSeq: number;
            textHash: string;
        } | null;
        body: string | null;
        credential: string | null;
        receipt: string | null;
        error: string | null;
    };
    reject(runId: string, code: string): {
        id: string;
        runId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
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
        material: {
            packetId: string;
            sourceStamp: string;
            foundationHash: string;
            personaHash: string;
            modelHash: string;
            mediaStamp?: string | undefined;
        } | null;
        renderRef: {
            sessionId: string;
            messageSeq: number;
            turnEndSeq: number;
            textHash: string;
        } | null;
        body: string | null;
        credential: string | null;
        receipt: string | null;
        error: string | null;
    };
    interrupt(runId: string): {
        id: string;
        runId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
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
        material: {
            packetId: string;
            sourceStamp: string;
            foundationHash: string;
            personaHash: string;
            modelHash: string;
            mediaStamp?: string | undefined;
        } | null;
        renderRef: {
            sessionId: string;
            messageSeq: number;
            turnEndSeq: number;
            textHash: string;
        } | null;
        body: string | null;
        credential: string | null;
        receipt: string | null;
        error: string | null;
    };
    recover(): void;
    list(states?: readonly NativeDeliveryState[]): {
        id: string;
        runId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
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
        material: {
            packetId: string;
            sourceStamp: string;
            foundationHash: string;
            personaHash: string;
            modelHash: string;
            mediaStamp?: string | undefined;
        } | null;
        renderRef: {
            sessionId: string;
            messageSeq: number;
            turnEndSeq: number;
            textHash: string;
        } | null;
        body: string | null;
        credential: string | null;
        receipt: string | null;
        error: string | null;
    }[];
    recent(target: Conversation): {
        id: string;
        runId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
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
        material: {
            packetId: string;
            sourceStamp: string;
            foundationHash: string;
            personaHash: string;
            modelHash: string;
            mediaStamp?: string | undefined;
        } | null;
        renderRef: {
            sessionId: string;
            messageSeq: number;
            turnEndSeq: number;
            textHash: string;
        } | null;
        body: string | null;
        credential: string | null;
        receipt: string | null;
        error: string | null;
    }[];
    counts(): {
        total: number;
        pending: number;
        sent: number;
        partial: number;
        uncertain: number;
        blocked: number;
    };
    mediaSettlementPending(runId: string, manifestId: string): void;
    status(runId: string): {
        deliveryId: string;
        runId: string;
        taskId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
        version: number;
        receiptId: string | null;
        error: string | null;
    } | null;
}
export {};
