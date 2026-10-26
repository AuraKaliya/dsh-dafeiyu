import { AttachmentStore, AttachmentId } from '@deepseek-ai/dsh-attachment';
import type { ImageAttachmentRef, ImageAttachmentLimits, SaveImageAttachment, ImageRequestTarget, RequestImageAttachment } from '@deepseek-ai/dsh-attachment';
import type { Context } from '@deepseek-ai/cordis';
import type { DecodedImage } from './decoder.js';
/** Only the isolated transport can open its current lease. No generic file or upload service. */
export declare class ScopedImages extends AttachmentStore {
    readonly imageLimits: ImageAttachmentLimits;
    private readonly active;
    private readonly leases;
    constructor(ctx: Context);
    grant(images: readonly DecodedImage[], guard: () => void): {
        id: `${string}-${string}-${string}-${string}-${string}`;
        refs: {
            attachmentId: AttachmentId;
            mediaType: import("@deepseek-ai/dsh-attachment").ImageMediaType;
            bytes: number;
            width: number;
            height: number;
            name?: string;
            originalDimensions?: {
                width: number;
                height: number;
            };
        }[];
        exposure: () => {
            sha256: string;
            bytes: number;
            width: number;
            height: number;
            reads: number;
        }[];
        close: () => void;
    };
    run<T>(id: string, work: () => T): T;
    private lookup;
    validateImage(_input: SaveImageAttachment): Promise<void>;
    saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef>;
    readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<{
        ref: {
            attachmentId: AttachmentId;
            mediaType: import("@deepseek-ai/dsh-attachment").ImageMediaType;
            bytes: number;
            width: number;
            height: number;
            name?: string;
            originalDimensions?: {
                width: number;
                height: number;
            };
        };
        data: Buffer<ArrayBuffer>;
    }>;
    readImageRequest(ref: ImageAttachmentRef, target: ImageRequestTarget, signal?: AbortSignal): Promise<RequestImageAttachment>;
    close(): void;
}
