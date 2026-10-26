import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { Json } from '#dafeiyu/contracts';
/** An explicit export projection. Never serialize a DSH event wholesale. */
export declare function projectSession(event: SessionEvent): {
    kind: string;
    text: string;
    redacted: boolean;
    omittedBlocks: number;
    interrupted: boolean;
    seq: import("@deepseek-ai/dsh-session").SessionSeq;
    time: number;
    memoryUse: "derived-only" | "primary-candidate";
} | null;
export declare function eventMetadata(input: {
    seq: number;
    type: string;
    plugin: string;
    pluginVersion: string;
    occurredAt: string;
    recordedAt: string;
    traceId: string;
    operationId: string;
    data: Readonly<Record<string, Json>>;
}): {
    seq: number;
    type: string;
    plugin: string;
    pluginVersion: string;
    occurredAt: string;
    recordedAt: string;
    traceId: string;
    operationId: string;
    data: Json;
    redacted: boolean;
};
