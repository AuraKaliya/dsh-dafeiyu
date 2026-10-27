import type { Context } from '@deepseek-ai/cordis';
import type { MediaAssetRef, MediaReplyAccess, MediaSourceDescription, ExecutionContextV3, NativeExpressionAccess } from '#dafeiyu/contracts';
import type { MediaStore } from './store.js';
import type { MediaFiles } from './files.js';
import type { ReplySpeech } from './reply-speech.js';
interface Host {
    ctx: Context;
    store: MediaStore;
    files: MediaFiles;
    ready(): boolean;
    prepareAsset(context: ExecutionContextV3, asset: MediaAssetRef, as: 'image' | 'record' | 'file', key: string, owner: string): Promise<{
        asset: MediaAssetRef;
        source: MediaSourceDescription;
    }>;
    sourceCurrent(source: MediaSourceDescription): boolean;
    speech?: ReplySpeech;
}
export declare class MediaReplies {
    private readonly host;
    constructor(host: Host);
    private write;
    prepare(context: ExecutionContextV3, raw: unknown, owner?: string): Promise<{
        draftId: string;
        version: number;
        currentDraftId: string;
        currentVersion: number;
        selected: number;
        cancelled: boolean;
    }>;
    status(context: ExecutionContextV3): {
        draftId: string;
        version: number;
        selected: number;
        frozen: boolean;
    } | {
        draftId: null;
        version: number;
        selected: number;
        frozen: boolean;
    };
    pending(runId: string): {
        id: string;
        version: number;
        selected: number;
        authority: {
            schemaVersion: 1;
            id: string;
            runId: string;
            operationId: string;
            scope: {
                kind: "conversation";
                agentId: string;
                route: string;
            } | {
                kind: "task";
                agentId: string;
                taskId: string;
                scopeKey: string;
            };
            intentVersion: number;
            hash: string;
        };
    } | null;
    native(access: NativeExpressionAccess): {
        draftId: string;
        draftVersion: number;
        sourceStamp: string;
        parts: ({
            kind: "asset";
            delivery: "image" | "record" | "file";
            asset: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "audio" | "image" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
            name: string | null;
        } | {
            kind: "final-voice";
        })[];
    } | null;
    private fence;
    private access;
    private partAccess;
    private frozenBinding;
    finalize(access: MediaReplyAccess): Promise<{
        schemaVersion: 1;
        id: string;
        replyId: string;
        runId: string;
        target: {
            channel: string;
            account: string;
            kind: "private" | "group" | "local";
            id: string;
        };
        sourceMessageId: string;
        anchor: {
            kind: "reply";
            inboundId: string;
        } | {
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
        textHash: string;
        draft: {
            id: string;
            version: number;
        };
        parts: ({
            kind: "image";
            asset: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "audio" | "image" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
        } | {
            kind: "record";
            asset: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "audio" | "image" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
        } | {
            kind: "file";
            asset: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "audio" | "image" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
            name: string;
        })[];
        sourceStamp: string;
        credential: string;
        expiresAt: string;
    } | null>;
    bytes(access: MediaReplyAccess, manifestId: string, position: number): Promise<Buffer<ArrayBuffer>>;
    validate(access: MediaReplyAccess, id: string): void;
    settle(access: MediaReplyAccess, id: string, state: 'sent' | 'unknown' | 'blocked'): void;
    private speech;
}
export {};
