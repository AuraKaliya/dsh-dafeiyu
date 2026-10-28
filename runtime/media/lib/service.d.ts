import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { MediaAcquireSchema, MediaReadSchema } from '#dafeiyu/contracts';
import type { MediaPort, MediaSourceProvider, MediaAssetRef, ExecutionContextV3, MediaVoiceEvidence, MediaReplyAccess, NativeExpressionAccess, PersonaAccess, PersonaSourceRef, Conversation, ReplyMediaManifest } from '#dafeiyu/contracts';
import { MediaStore } from './store.js';
import { MediaFiles } from './files.js';
import { MediaDecoder } from './decoder.js';
import type { AudioWorker } from './audio.js';
export declare const mediaConfigSchema: z.ZodObject<{
    agentId: z.ZodString;
    profileId: z.ZodString;
    dataDir: z.ZodString;
    createStore: z.ZodDefault<z.ZodBoolean>;
    ffmpeg: z.ZodString;
    ffprobe: z.ZodString;
    maxBytes: z.ZodDefault<z.ZodNumber>;
    maxAssetBytes: z.ZodDefault<z.ZodNumber>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    vision: z.ZodOptional<z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
        reasoningEffort: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    audio: z.ZodOptional<z.ZodObject<{
        whisper: z.ZodOptional<z.ZodObject<{
            node: z.ZodString;
            moduleDirectory: z.ZodString;
            moduleVersion: z.ZodLiteral<"1.1.3">;
            model: z.ZodObject<{
                path: z.ZodString;
                sha256: z.ZodString;
            }, z.core.$strict>;
            language: z.ZodDefault<z.ZodString>;
            memoryBytes: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        events: z.ZodOptional<z.ZodObject<{
            python: z.ZodString;
            model: z.ZodObject<{
                path: z.ZodString;
                sha256: z.ZodString;
            }, z.core.$strict>;
            labels: z.ZodObject<{
                path: z.ZodString;
                sha256: z.ZodString;
            }, z.core.$strict>;
            onnxruntimeVersion: z.ZodString;
            numpyVersion: z.ZodString;
            memoryBytes: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    documents: z.ZodOptional<z.ZodObject<{
        python: z.ZodString;
        pypdfVersion: z.ZodLiteral<"6.10.0">;
    }, z.core.$strict>>;
    tts: z.ZodOptional<z.ZodObject<{
        powershell: z.ZodString;
        voice: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type Config = z.input<typeof mediaConfigSchema>;
export declare const MEDIA_ACTIONS: readonly ["dafeiyu_media_acquire", "dafeiyu_media_inspect", "dafeiyu_media_read", "dafeiyu_media_select", "dafeiyu_media_reply", "dafeiyu_media_reply_status"];
type Input = z.output<typeof MediaReadSchema>;
declare module '@deepseek-ai/cordis' {
    interface Context {
        dafeiyuMedia: MediaService;
    }
}
export declare class MediaService extends Service implements MediaPort {
    readonly config: z.output<typeof mediaConfigSchema>;
    readonly store: MediaStore;
    readonly files: MediaFiles;
    readonly decoder: MediaDecoder;
    private readonly images;
    private readonly analysis;
    private readonly audio;
    private readonly documents;
    private readonly replies;
    private readonly replySpeech;
    private readonly gate;
    private readonly controller;
    private readonly providers;
    private readonly handle;
    private readonly unbind;
    private tail;
    private closing;
    private finalCounts;
    private reconciliation;
    constructor(ctx: Context, raw: Config, testBackends?: {
        audioWorker?: AudioWorker;
        ttsWorker?: AudioWorker;
    });
    ready(): boolean;
    private sourceCurrent;
    registerProvider(provider: MediaSourceProvider): () => void;
    private describe;
    private access;
    private serial;
    private acquireWithin;
    acquire(context: ExecutionContextV3, owner: string, input: z.output<typeof MediaAcquireSchema>): Promise<{
        schemaVersion: 1;
        id: string;
        version: number;
        kind: "image" | "audio" | "video" | "document";
        sha256: string;
        bytes: number;
        mime: string;
    }>;
    inspect(context: ExecutionContextV3, owner: string, ref: MediaAssetRef): {
        schemaVersion: 1;
        id: string;
        version: number;
        agentId: string;
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
        taskEpoch: number | null;
        sourceId: string;
        sourceVersion: number;
        kind: "image" | "audio" | "video" | "document";
        state: "deleted" | "failed" | "staging" | "ready" | "evicted";
        sha256: string | null;
        bytes: number | null;
        mime: string | null;
        parent: {
            schemaVersion: 1;
            id: string;
            version: number;
            kind: "image" | "audio" | "video" | "document";
            sha256: string;
            bytes: number;
            mime: string;
        } | null;
        processingHash: string | null;
        coverage: {
            acquiredBytes: number;
            processed: {
                kind: "image" | "audio" | "frame" | "page" | "paragraph" | "row";
                start: number;
                end: number;
                unit: "index" | "milliseconds" | "whole-image";
            }[];
            exposed: boolean;
            gaps: string[];
            completeness: "unknown" | "complete" | "partial";
        };
        createdAt: string;
        updatedAt: string;
    };
    private withInput;
    read(context: ExecutionContextV3, owner: string, input: Input): Promise<{
        next?: {
            offset: number;
            textOffset: number;
        } | null;
        exposureId: string;
        text: string;
        coverage: {
            acquiredBytes: number;
            processed: {
                kind: "image" | "audio" | "frame" | "page" | "paragraph" | "row";
                start: number;
                end: number;
                unit: "index" | "milliseconds" | "whole-image";
            }[];
            exposed: boolean;
            gaps: string[];
            completeness: "unknown" | "complete" | "partial";
        };
        readProgress: {
            state: "failed" | "observed" | "unread" | "unavailable";
            subject: "source-range" | "reference" | "provided-page";
            completeness: "unknown" | "complete" | "partial";
        };
        assets: {
            schemaVersion: 1;
            id: string;
            version: number;
            kind: "image" | "audio" | "video" | "document";
            sha256: string;
            bytes: number;
            mime: string;
        }[];
        observation: {
            source: PersonaSourceRef;
            duplicate: boolean;
        };
    } | {
        document: {
            schemaVersion: 1;
            kind: "text" | "json" | "csv" | "pdf" | "docx" | "xlsx";
            sha256: string;
            bytes: number;
            units: {
                kind: "page" | "paragraph" | "row";
                locator: string;
                text: string;
                index: number;
                textStart: number;
                textEnd: number;
                cachedFormula?: boolean | undefined;
            }[];
            next: {
                offset: number;
                textOffset: number;
            } | null;
            totalUnits: number | null;
            gaps: string[];
        };
        understood: boolean;
    } | {
        metadata: {
            kind: "image" | "audio" | "video" | "unknown";
            width: number | null;
            height: number | null;
            durationMs: number | null;
            startMs: number;
            videoCodec: string | null;
            audioCodec: string | null;
            sampleRate: number | null;
            channels: number | null;
            format: string;
            peakCommitBytes: number;
        };
        understood: boolean;
    }>;
    private readAudio;
    private prepareReplyAsset;
    prepareReply(context: ExecutionContextV3, input: unknown, owner?: string): Promise<{
        draftId: string;
        version: number;
        currentDraftId: string;
        currentVersion: number;
        selected: number;
        cancelled: boolean;
    }>;
    imageOriginal(context: ExecutionContextV3, owner: string, exposureId: string): Promise<{
        data: Buffer<ArrayBuffer>;
        mime: string;
        source: {
            ref: {
                provider: string;
                key: string;
            };
            origin: {
                provider: string;
                scene: {
                    channel: string;
                    account: string;
                    kind: "private" | "group" | "local";
                    id: string;
                };
                key: string;
                version: number;
                hash: string;
                roots: string[];
                detail: z.core.util.JSONType;
            };
            kind: "image" | "audio" | "video" | "document";
            name: string | null;
            mimeHint: string | null;
            bytesHint: number | null;
            durationMsHint: number | null;
            rangeReadable: boolean;
            publicContent: boolean;
            sourceFrame?: {
                positionMs: number;
                durationMs: number;
            } | undefined;
        };
    }>;
    replyDraft(runId: string): {
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
    finalizeReply(access: MediaReplyAccess): Promise<{
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
                kind: "image" | "audio" | "video" | "document";
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
                kind: "image" | "audio" | "video" | "document";
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
                kind: "image" | "audio" | "video" | "document";
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
    readReplyPart(access: MediaReplyAccess, id: string, position: number): Promise<Buffer<ArrayBuffer>>;
    validateReply(access: MediaReplyAccess, id: string): void;
    settleReply(access: MediaReplyAccess, id: string, state: 'sent' | 'unknown' | 'blocked'): void;
    releaseReply(access: MediaReplyAccess): void;
    nativeMaterial(access: NativeExpressionAccess): {
        draftId: string;
        draftVersion: number;
        sourceStamp: string;
        parts: ({
            kind: "asset";
            delivery: "image" | "file" | "record";
            asset: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "image" | "audio" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
            name: string | null;
        } | {
            kind: "final-voice";
        })[];
    } | null;
    observedMaterial(access: PersonaAccess, ref: PersonaSourceRef, target: Conversation, view: string): {
        kind: "reported" | "inference";
        stamp: string;
    } | null;
    private observed;
    private readDocument;
    select(context: ExecutionContextV3, raw: unknown): Record<string, unknown>;
    voice(context: ExecutionContextV3, owner: string, exposureId: string): {
        text: string;
        evidence: {
            schemaVersion: 1;
            exposure: {
                provider: string;
                scene: {
                    channel: string;
                    account: string;
                    kind: "private" | "group" | "local";
                    id: string;
                };
                key: string;
                version: number;
                hash: string;
                roots: string[];
                detail: z.core.util.JSONType;
            };
            origin: {
                provider: string;
                scene: {
                    channel: string;
                    account: string;
                    kind: "private" | "group" | "local";
                    id: string;
                };
                key: string;
                version: number;
                hash: string;
                roots: string[];
                detail: z.core.util.JSONType;
            };
            source: {
                provider: string;
                key: string;
            };
            audioAsset: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "image" | "audio" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
            pcm: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "image" | "audio" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
            observation: {
                kind: "memory";
                revision: number;
                id: string;
                agentId: string;
                scopeKey: string;
                version: number;
                contentHash: string;
                authorization?: {
                    taskId: string;
                    taskEpoch: number;
                    grantId: string;
                    grantVersion: number;
                    policyId: string;
                    policyVersion: number;
                } | undefined;
                selectionId?: string | undefined;
                range?: {
                    start: number;
                    end: number;
                } | undefined;
            } | {
                kind: "execution-source";
                id: string;
                agentId: string;
                scopeKey: string;
                version: number;
                contentHash: string;
            };
            transcriptHash: string;
            sourceDurationMs: number;
            asr: {
                backend: "whisper.node";
                version: "1.1.3";
                modelSha256: string;
            };
            events: {
                backend: "yamnet-onnx";
                modelSha256: string;
                labelsSha256: string;
                onnxruntimeVersion: string;
                numpyVersion: string;
            };
        };
    };
    voiceCurrent(raw: MediaVoiceEvidence): boolean;
    private actions;
    flush(): void;
    reconcile(read: (manifest: ReplyMediaManifest) => 'sent' | 'unknown' | 'blocked' | 'pending' | 'conflict'): {
        settled: number;
        pending: number;
        conflicts: number;
    };
    recover(): Promise<void>;
    activate(): void;
    whenIdle(): Promise<unknown>;
    cancelRunning(): void;
    get health(): {
        lifecycle: import("#dafeiyu/contracts").ServicePhase;
        modalities: {
            vision: boolean;
            asr: boolean;
            events: boolean;
            documents: boolean;
            tts: boolean;
        };
        counts: {
            sources: number;
            assets: number;
            bytes: number;
            drafts: number;
            exports: number;
            jobs: Record<string, number>;
        };
        reconciliation: {
            settled: number;
            pending: number;
            conflicts: number;
        };
    };
    close(): Promise<void>;
}
export {};
