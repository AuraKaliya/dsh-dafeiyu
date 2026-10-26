import type { MediaAccess, MediaAssetRef, MediaAssetRecord, MediaByteStream, MediaCoverage } from '#dafeiyu/contracts';
import { MediaStore } from './store.js';
import type { StoredMediaSource } from './store.js';
export declare function hashFile(file: string, maxBytes?: number): Promise<{
    sha256: string;
    bytes: number;
}>;
export declare function nextWithAbort<T>(iterator: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>>;
export declare function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T>;
export declare class MediaFiles {
    readonly store: MediaStore;
    readonly maxBytes: number;
    readonly maxAssetBytes: number;
    readonly root: string;
    readonly objects: string;
    readonly work: string;
    private initialized;
    constructor(directory: string, store: MediaStore, maxBytes?: number, maxAssetBytes?: number);
    initialize(): Promise<void>;
    private rootCurrent;
    path(hash: string): Promise<string>;
    verified(ref: MediaAssetRef): Promise<string>;
    bytes(ref: MediaAssetRef, signal: AbortSignal, guard: () => void, maximum?: number): Promise<Buffer<ArrayBuffer>>;
    private remove;
    cleanPending(): Promise<void>;
    capacity(required: number): Promise<void>;
    ingest(access: MediaAccess, requestId: string, source: StoredMediaSource, stream: MediaByteStream, signal: AbortSignal, options?: {
        kind?: MediaAssetRecord['kind'];
        processingHash?: string;
        parent?: MediaAssetRef;
        coverage?: MediaCoverage;
    }): Promise<MediaAssetRef>;
    cleanWork(): Promise<void>;
}
