import { z } from 'zod';
import type { MediaAssetRef, MediaAssetRecord, MediaSourceDescription, MediaAccess, MediaCoverage, ResourceProof } from '#dafeiyu/contracts';
import { MediaReplyStore } from './reply-store.js';
export declare const MEDIA_APPLICATION_ID = 1145457973;
export declare const MEDIA_SCHEMA_VERSION = 2;
export declare const MEDIA_TABLES: readonly ["media_metadata", "media_sources", "media_source_revisions", "media_assets", "media_asset_revisions", "media_blobs", "media_requests", "media_leases", "media_jobs", "media_exposures", "media_outbox", "media_reply_drafts", "media_reply_heads", "media_reply_exports"];
declare const identity: z.ZodObject<{
    agentId: z.ZodString;
    profileId: z.ZodString;
}, z.core.$strict>;
export declare const mediaHash: (value: unknown) => string;
declare const sourceRecord: z.ZodObject<{
    id: z.ZodUUID;
    version: z.ZodNumber;
    deleted: z.ZodBoolean;
    description: z.ZodObject<{
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
}, z.core.$strict>;
export type StoredMediaSource = z.infer<typeof sourceRecord>;
declare const exposureSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
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
    assets: z.ZodArray<z.ZodObject<{
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
    text: z.ZodString;
    occurredAt: z.ZodISODateTime;
    detail: z.ZodJSONSchema;
}, z.core.$strict>;
export type MediaExposure = z.infer<typeof exposureSchema>;
export declare class MediaStore {
    private readonly db;
    private closed;
    readonly identity: z.infer<typeof identity>;
    readonly replies: MediaReplyStore;
    constructor(file: string, who: z.infer<typeof identity>, create?: boolean, migrate?: boolean);
    private initialize;
    private atomic;
    private check;
    private request;
    private audit;
    source(id: string): StoredMediaSource;
    rememberSource(access: MediaAccess, raw: MediaSourceDescription): {
        id: string;
        version: number;
        deleted: boolean;
        description: {
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
        };
    };
    changeSource(access: MediaAccess, id: string, expectedVersion: number, deleted: boolean): {
        id: string;
        version: number;
        deleted: boolean;
        description: {
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
        };
    };
    private asset;
    private writeAsset;
    read(access: MediaAccess, id: string): {
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
        state: "ready" | "failed" | "deleted" | "staging" | "evicted";
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
    reserve(access: MediaAccess, key: string, source: StoredMediaSource, processingHash?: string | null, parent?: MediaAssetRef | null): {
        id: string;
    };
    publish(access: MediaAccess, id: string, input: {
        sha256: string;
        bytes: number;
        mime: string;
        kind: MediaAssetRecord['kind'];
        coverage: MediaCoverage;
    }, verify: () => boolean): {
        schemaVersion: 1;
        id: string;
        version: number;
        kind: "image" | "audio" | "video" | "document";
        sha256: string;
        bytes: number;
        mime: string;
    };
    ref(record: MediaAssetRecord): MediaAssetRef;
    reserveBlob(access: MediaAccess, assetId: string, sha256: string, bytes: number): boolean;
    private blobOwner;
    abandonBlob(assetId: string, hash: string): void;
    requireRef(access: MediaAccess, raw: MediaAssetRef): {
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
        state: "ready" | "failed" | "deleted" | "staging" | "evicted";
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
    abandon(access: MediaAccess, id: string, code: string): void;
    deleteAsset(access: MediaAccess, id: string, expectedVersion: number): {
        id: string;
        version: number;
    };
    lease(access: MediaAccess, ref: MediaAssetRef, owner: string, expiresAt: number): `${string}-${string}-${string}-${string}-${string}`;
    releaseLease(id: string, owner: string): boolean;
    releaseLeases(owner: string): number;
    ensureLease(access: MediaAccess, ref: MediaAssetRef, owner: string, expiresAt: number): string;
    reclaimable(now: number): {
        sha256: string;
        bytes: number;
    }[];
    beginEviction(hash: string, now: number): void;
    evict(hash: string, now: number, remove: () => void): void;
    pendingRemoval(): {
        sha256: string;
        bytes: number;
    }[];
    completeRemoval(hash: string, remove: () => void): void;
    beginJob(access: MediaAccess, id: string, input: unknown): void;
    finishJob(access: MediaAccess, id: string, result: unknown, error: string | null): void;
    sourceForAsset(id: string): {
        id: string;
        version: number;
        deleted: boolean;
        description: {
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
        };
    };
    readReceipt(access: MediaAccess, key: string, input: unknown): string | null;
    recordExposure(access: MediaAccess, key: string, input: unknown, source: StoredMediaSource, value: Omit<MediaExposure, 'schemaVersion' | 'id' | 'scope' | 'taskEpoch' | 'sourceId' | 'sourceVersion'>): {
        schemaVersion: 1;
        id: string;
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
        assets: {
            schemaVersion: 1;
            id: string;
            version: number;
            kind: "image" | "audio" | "video" | "document";
            sha256: string;
            bytes: number;
            mime: string;
        }[];
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
        text: string;
        occurredAt: string;
        detail: z.core.util.JSONType;
    };
    private exposureRow;
    exposure(access: MediaAccess, id: string): {
        schemaVersion: 1;
        id: string;
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
        assets: {
            schemaVersion: 1;
            id: string;
            version: number;
            kind: "image" | "audio" | "video" | "document";
            sha256: string;
            bytes: number;
            mime: string;
        }[];
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
        text: string;
        occurredAt: string;
        detail: z.core.util.JSONType;
    };
    exposureProof(body: MediaExposure): ResourceProof;
    exposureOrigin(id: string): {
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
    };
    /** Program-only immutable witness lookup; public reads must first pass exposure(access, id). */
    exposureWitness(id: string): {
        schemaVersion: 1;
        id: string;
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
        assets: {
            schemaVersion: 1;
            id: string;
            version: number;
            kind: "image" | "audio" | "video" | "document";
            sha256: string;
            bytes: number;
            mime: string;
        }[];
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
        text: string;
        occurredAt: string;
        detail: z.core.util.JSONType;
    };
    assetWitness(ref: MediaAssetRef): {
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
        state: "ready" | "failed" | "deleted" | "staging" | "evicted";
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
    bindObservation(access: MediaAccess, id: string, source: unknown): {
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
    observation(id: string): {
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
    exposureByObservation(raw: unknown): {
        schemaVersion: 1;
        id: string;
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
        assets: {
            schemaVersion: 1;
            id: string;
            version: number;
            kind: "image" | "audio" | "video" | "document";
            sha256: string;
            bytes: number;
            mime: string;
        }[];
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
        text: string;
        occurredAt: string;
        detail: z.core.util.JSONType;
    } | null;
    epoch(): string;
    private contentCurrent;
    exposureCurrent(id: string): boolean;
    validateExposure(proof: ResourceProof, current: (source: MediaSourceDescription) => boolean): boolean;
    abortJob(access: MediaAccess, id: string, code: string): void;
    recover(): number;
    counts(): {
        sources: number;
        assets: number;
        bytes: number;
    };
    jobs(): {
        [k: string]: number;
    };
    drain(publish: (body: unknown, id: string) => void): void;
    close(): void;
}
export {};
