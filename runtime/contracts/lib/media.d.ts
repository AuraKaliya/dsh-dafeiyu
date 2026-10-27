import { z } from 'zod';
import type { ExecutionContextV3 } from './execution.js';
import type { PersonaAccess } from './persona.js';
import type { ResourceProof } from './resource-observation.js';
import type { MediaReplyAccess, MediaReplyAuthority, ReplyMediaManifest } from './media-delivery.js';
import type { NativeExpressionAccess } from './native-expression.js';
export declare const MediaKindSchema: z.ZodEnum<{
    image: "image";
    audio: "audio";
    video: "video";
    document: "document";
}>;
export declare const MediaProviderRefSchema: z.ZodObject<{
    provider: z.ZodString;
    key: z.ZodString;
}, z.core.$strict>;
export declare const MediaSourceDescriptionSchema: z.ZodObject<{
    ref: z.ZodObject<{
        provider: z.ZodString;
        key: z.ZodString;
    }, z.core.$strict>;
    origin: z.ZodObject<{
        provider: z.ZodString;
        scene: z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                private: "private";
                group: "group";
                local: "local";
            }>;
            id: z.ZodString;
        }, z.core.$strict>;
        key: z.ZodString;
        version: z.ZodNumber;
        hash: z.ZodString;
        roots: z.ZodArray<z.ZodString>;
        detail: z.ZodJSONSchema;
    }, z.core.$strict>;
    kind: z.ZodEnum<{
        image: "image";
        audio: "audio";
        video: "video";
        document: "document";
    }>;
    name: z.ZodNullable<z.ZodString>;
    mimeHint: z.ZodNullable<z.ZodString>;
    bytesHint: z.ZodNullable<z.ZodNumber>;
    durationMsHint: z.ZodNullable<z.ZodNumber>;
    rangeReadable: z.ZodBoolean;
    publicContent: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
export type MediaSourceDescription = z.infer<typeof MediaSourceDescriptionSchema>;
export declare const MediaAttachmentSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    source: z.ZodObject<{
        provider: z.ZodString;
        key: z.ZodString;
    }, z.core.$strict>;
    kind: z.ZodEnum<{
        image: "image";
        audio: "audio";
        video: "video";
        document: "document";
    }>;
    name: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export type MediaAttachment = z.infer<typeof MediaAttachmentSchema>;
export declare const MediaAssetRefSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    version: z.ZodNumber;
    kind: z.ZodEnum<{
        image: "image";
        audio: "audio";
        video: "video";
        document: "document";
    }>;
    sha256: z.ZodString;
    bytes: z.ZodNumber;
    mime: z.ZodString;
}, z.core.$strict>;
export type MediaAssetRef = z.infer<typeof MediaAssetRefSchema>;
export declare const MediaIntervalSchema: z.ZodObject<{
    startMs: z.ZodNumber;
    endMs: z.ZodNumber;
}, z.core.$strict>;
export declare const MediaCoverageSchema: z.ZodObject<{
    acquiredBytes: z.ZodNumber;
    processed: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            image: "image";
            audio: "audio";
            frame: "frame";
            page: "page";
            paragraph: "paragraph";
            row: "row";
        }>;
        start: z.ZodNumber;
        end: z.ZodNumber;
        unit: z.ZodEnum<{
            milliseconds: "milliseconds";
            index: "index";
            "whole-image": "whole-image";
        }>;
    }, z.core.$strict>>;
    exposed: z.ZodBoolean;
    gaps: z.ZodArray<z.ZodString>;
    completeness: z.ZodEnum<{
        unknown: "unknown";
        complete: "complete";
        partial: "partial";
    }>;
}, z.core.$strict>;
export type MediaCoverage = z.infer<typeof MediaCoverageSchema>;
export declare const MediaAssetRecordSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    version: z.ZodNumber;
    agentId: z.ZodString;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    taskEpoch: z.ZodNullable<z.ZodNumber>;
    sourceId: z.ZodUUID;
    sourceVersion: z.ZodNumber;
    kind: z.ZodEnum<{
        image: "image";
        audio: "audio";
        video: "video";
        document: "document";
    }>;
    state: z.ZodEnum<{
        failed: "failed";
        deleted: "deleted";
        staging: "staging";
        ready: "ready";
        evicted: "evicted";
    }>;
    sha256: z.ZodNullable<z.ZodString>;
    bytes: z.ZodNullable<z.ZodNumber>;
    mime: z.ZodNullable<z.ZodString>;
    parent: z.ZodNullable<z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        id: z.ZodUUID;
        version: z.ZodNumber;
        kind: z.ZodEnum<{
            image: "image";
            audio: "audio";
            video: "video";
            document: "document";
        }>;
        sha256: z.ZodString;
        bytes: z.ZodNumber;
        mime: z.ZodString;
    }, z.core.$strict>>;
    processingHash: z.ZodNullable<z.ZodString>;
    coverage: z.ZodObject<{
        acquiredBytes: z.ZodNumber;
        processed: z.ZodArray<z.ZodObject<{
            kind: z.ZodEnum<{
                image: "image";
                audio: "audio";
                frame: "frame";
                page: "page";
                paragraph: "paragraph";
                row: "row";
            }>;
            start: z.ZodNumber;
            end: z.ZodNumber;
            unit: z.ZodEnum<{
                milliseconds: "milliseconds";
                index: "index";
                "whole-image": "whole-image";
            }>;
        }, z.core.$strict>>;
        exposed: z.ZodBoolean;
        gaps: z.ZodArray<z.ZodString>;
        completeness: z.ZodEnum<{
            unknown: "unknown";
            complete: "complete";
            partial: "partial";
        }>;
    }, z.core.$strict>;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type MediaAssetRecord = z.infer<typeof MediaAssetRecordSchema>;
export declare const MediaVoiceEvidenceSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    exposure: z.ZodObject<{
        provider: z.ZodString;
        scene: z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                private: "private";
                group: "group";
                local: "local";
            }>;
            id: z.ZodString;
        }, z.core.$strict>;
        key: z.ZodString;
        version: z.ZodNumber;
        hash: z.ZodString;
        roots: z.ZodArray<z.ZodString>;
        detail: z.ZodJSONSchema;
    }, z.core.$strict>;
    origin: z.ZodObject<{
        provider: z.ZodString;
        scene: z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                private: "private";
                group: "group";
                local: "local";
            }>;
            id: z.ZodString;
        }, z.core.$strict>;
        key: z.ZodString;
        version: z.ZodNumber;
        hash: z.ZodString;
        roots: z.ZodArray<z.ZodString>;
        detail: z.ZodJSONSchema;
    }, z.core.$strict>;
    source: z.ZodObject<{
        provider: z.ZodString;
        key: z.ZodString;
    }, z.core.$strict>;
    audioAsset: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        id: z.ZodUUID;
        version: z.ZodNumber;
        kind: z.ZodEnum<{
            image: "image";
            audio: "audio";
            video: "video";
            document: "document";
        }>;
        sha256: z.ZodString;
        bytes: z.ZodNumber;
        mime: z.ZodString;
    }, z.core.$strict>;
    pcm: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        id: z.ZodUUID;
        version: z.ZodNumber;
        kind: z.ZodEnum<{
            image: "image";
            audio: "audio";
            video: "video";
            document: "document";
        }>;
        sha256: z.ZodString;
        bytes: z.ZodNumber;
        mime: z.ZodString;
    }, z.core.$strict>;
    observation: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">;
    transcriptHash: z.ZodString;
    sourceDurationMs: z.ZodNumber;
    asr: z.ZodObject<{
        backend: z.ZodLiteral<"whisper.node">;
        version: z.ZodLiteral<"1.1.3">;
        modelSha256: z.ZodString;
    }, z.core.$strict>;
    events: z.ZodObject<{
        backend: z.ZodLiteral<"yamnet-onnx">;
        modelSha256: z.ZodString;
        labelsSha256: z.ZodString;
        onnxruntimeVersion: z.ZodString;
        numpyVersion: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export type MediaVoiceEvidence = z.infer<typeof MediaVoiceEvidenceSchema>;
export declare const NativeMediaMaterialSchema: z.ZodObject<{
    draftId: z.ZodUUID;
    draftVersion: z.ZodNumber;
    sourceStamp: z.ZodString;
    parts: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"asset">;
        delivery: z.ZodEnum<{
            record: "record";
            file: "file";
            image: "image";
        }>;
        asset: z.ZodObject<{
            schemaVersion: z.ZodLiteral<1>;
            id: z.ZodUUID;
            version: z.ZodNumber;
            kind: z.ZodEnum<{
                image: "image";
                audio: "audio";
                video: "video";
                document: "document";
            }>;
            sha256: z.ZodString;
            bytes: z.ZodNumber;
            mime: z.ZodString;
        }, z.core.$strict>;
        name: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"final-voice">;
    }, z.core.$strict>], "kind">>;
}, z.core.$strict>;
export type NativeMediaMaterial = z.infer<typeof NativeMediaMaterialSchema>;
export declare const MediaAcquireSchema: z.ZodObject<{
    requestId: z.ZodString;
    source: z.ZodObject<{
        provider: z.ZodString;
        key: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const MediaReadSchema: z.ZodObject<{
    requestId: z.ZodString;
    asset: z.ZodOptional<z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        id: z.ZodUUID;
        version: z.ZodNumber;
        kind: z.ZodEnum<{
            image: "image";
            audio: "audio";
            video: "video";
            document: "document";
        }>;
        sha256: z.ZodString;
        bytes: z.ZodNumber;
        mime: z.ZodString;
    }, z.core.$strict>>;
    source: z.ZodOptional<z.ZodObject<{
        provider: z.ZodString;
        key: z.ZodString;
    }, z.core.$strict>>;
    mode: z.ZodEnum<{
        image: "image";
        audio: "audio";
        document: "document";
        inspect: "inspect";
        frames: "frames";
    }>;
    pointsMs: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    interval: z.ZodOptional<z.ZodObject<{
        startMs: z.ZodNumber;
        endMs: z.ZodNumber;
    }, z.core.$strict>>;
    offset: z.ZodOptional<z.ZodNumber>;
    textOffset: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export interface MediaAccess {
    readonly execution: PersonaAccess;
    readonly origin: ResourceProof;
    guard(): void;
}
export interface MediaByteStream {
    readonly bytes: number | null;
    readonly mime: string | null;
    readonly stream: AsyncIterable<Uint8Array>;
    readonly totalBytes?: number;
    readonly range?: {
        start: number;
        end: number;
    } | null;
}
/** Program registration only. No model supplies a locator, header or filesystem path. */
export interface MediaSourceProvider {
    readonly id: string;
    describe(key: string): MediaSourceDescription | null;
    open(key: string, range: {
        start: number;
        end: number;
    } | null, signal: AbortSignal): Promise<MediaByteStream>;
}
export interface MediaPort {
    ready(): boolean;
    registerProvider(provider: MediaSourceProvider): () => void;
    acquire(context: ExecutionContextV3, owner: string, input: z.infer<typeof MediaAcquireSchema>): Promise<MediaAssetRef>;
    inspect(context: ExecutionContextV3, owner: string, ref: MediaAssetRef): unknown;
    read(context: ExecutionContextV3, owner: string, input: z.infer<typeof MediaReadSchema>): Promise<unknown>;
    imageOriginal?(context: ExecutionContextV3, owner: string, exposureId: string): Promise<{
        data: Uint8Array;
        mime: string;
        source: MediaSourceDescription;
    }>;
    prepareReply?(context: ExecutionContextV3, input: unknown, owner?: string): Promise<unknown>;
    voice?(context: ExecutionContextV3, owner: string, exposureId: string): {
        text: string;
        evidence: MediaVoiceEvidence;
    };
    voiceCurrent?(evidence: MediaVoiceEvidence): boolean;
    replyDraft?(runId: string): {
        id: string;
        version: number;
        selected: number;
        authority: MediaReplyAuthority;
    } | null;
    finalizeReply?(access: MediaReplyAccess): Promise<ReplyMediaManifest | null>;
    readReplyPart?(access: MediaReplyAccess, manifestId: string, position: number): Promise<Uint8Array>;
    validateReply?(access: MediaReplyAccess, manifestId: string): void;
    settleReply?(access: MediaReplyAccess, manifestId: string, state: 'sent' | 'unknown' | 'blocked'): void;
    releaseReply?(access: MediaReplyAccess): void;
    nativeMaterial?(access: NativeExpressionAccess): NativeMediaMaterial | null;
    observedMaterial?(access: PersonaAccess, source: import('./persona.js').PersonaSourceRef, target: import('./conversation.js').Conversation, view: string): {
        kind: 'reported' | 'inference';
        stamp: string;
    } | null;
}
