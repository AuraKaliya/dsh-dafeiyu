import { AttachmentStore, AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { mediaHash } from './store.js';
/** Only the isolated transport can open its current lease. No generic file or upload service. */
export class ScopedImages extends AttachmentStore {
    imageLimits = { maxImageBytes: 16 * 1024 ** 2, maxImagesPerMessage: 8, maxMessageImageBytes: 32 * 1024 ** 2, maxImagePixels: 16000000, maxImageDimension: 1024, mediaTypes: ['image/png'] };
    active = new AsyncLocalStorage();
    leases = new Map();
    constructor(ctx) { if (ctx.get('attachments'))
        throw new Error('MEDIA_ATTACHMENTS_CONFLICT'); super(ctx); }
    grant(images, guard) {
        guard();
        if (!images.length || images.length > 8 || images.reduce((n, i) => n + i.data.length, 0) > this.imageLimits.maxMessageImageBytes)
            throw new Error('MEDIA_IMAGE_LIMIT');
        const id = randomUUID(), lease = { guard, images: images.map(image => {
                if (image.data.length > this.imageLimits.maxImageBytes || image.data.readUInt32BE(16) !== image.width || image.data.readUInt32BE(20) !== image.height || image.data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
                    throw new Error('MEDIA_IMAGE_INVALID');
                const data = Buffer.from(image.data);
                return { ref: { attachmentId: AttachmentId(mediaHash([id, randomUUID()])), mediaType: 'image/png', bytes: data.length, width: image.width, height: image.height }, data, hasAlpha: image.hasAlpha, reads: 0, sha256: createHash('sha256').update(data).digest('hex') };
            }) };
        this.leases.set(id, lease);
        return { id, refs: lease.images.map(i => ({ ...i.ref })), exposure: () => { guard(); if (!this.leases.has(id) || lease.images.some(i => i.reads < 1))
                throw new Error('MEDIA_IMAGE_NOT_EXPOSED'); return lease.images.map(i => ({ sha256: i.sha256, bytes: i.data.length, width: i.ref.width, height: i.ref.height, reads: i.reads })); }, close: () => { this.leases.delete(id); } };
    }
    run(id, work) { const lease = this.leases.get(id); if (!lease)
        throw new Error('MEDIA_LEASE_EXPIRED'); lease.guard(); return this.active.run(id, work); }
    lookup(ref) {
        const id = this.active.getStore(), lease = id ? this.leases.get(id) : undefined;
        if (!lease)
            throw new Error('MEDIA_ATTACHMENT_SCOPE_DENIED');
        lease.guard();
        const image = lease.images.find(i => i.ref.attachmentId === ref.attachmentId);
        if (!image || mediaHash(image.ref) !== mediaHash(ref))
            throw new Error('MEDIA_ATTACHMENT_SCOPE_DENIED');
        return { image, guard: lease.guard };
    }
    async validateImage(_input) { throw new Error('MEDIA_ATTACHMENT_UPLOAD_DISABLED'); }
    async saveImage(_input) { throw new Error('MEDIA_ATTACHMENT_UPLOAD_DISABLED'); }
    async readImage(ref, signal) { signal?.throwIfAborted(); const { image, guard } = this.lookup(ref); guard(); return { ref: { ...image.ref }, data: Buffer.from(image.data) }; }
    async readImageRequest(ref, target, signal) {
        signal?.throwIfAborted();
        const { image, guard } = this.lookup(ref);
        if (!Number.isSafeInteger(target.width) || !Number.isSafeInteger(target.height) || !Number.isSafeInteger(target.maxBytes) || target.width < ref.width || target.height < ref.height || target.maxBytes < ref.bytes)
            throw new Error('MEDIA_IMAGE_TARGET_TOO_SMALL');
        guard();
        image.reads++;
        return { variantId: ImageVariantId(mediaHash([ref, target])), attachment: { ...ref }, data: Buffer.from(image.data), mediaType: 'image/png', bytes: ref.bytes, width: ref.width, height: ref.height, depth: 'uchar', space: 'srgb', hasAlpha: image.hasAlpha };
    }
    close() { this.leases.clear(); this.active.disable(); }
}
