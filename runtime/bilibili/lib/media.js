import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { biliUrl, boundedBytes } from './http.js';
import { BiliStore, biliHash } from './store.js';
const track = z.object({ id: z.number().int().nonnegative(), baseUrl: z.string().max(8192).optional(), base_url: z.string().max(8192).optional(), codecs: z.string().max(100), mimeType: z.string().max(100).optional(), mime_type: z.string().max(100).optional(), bandwidth: z.number().nonnegative().finite() });
const locatorSchema = z.strictObject({ url: z.string().max(8192), bytes: z.number().int().positive().safe().nullable(), etag: z.string().max(220).nullable(), range: z.boolean(), accountStamp: z.string().length(64) });
const length = (raw) => { if (raw === undefined)
    return null; const n = Number(raw); if (!Number.isSafeInteger(n) || n < 1)
    throw new Error('BILI_MEDIA_LENGTH_INVALID'); return n; };
export function rejectRestricted(raw) { const value = z.record(z.string(), z.unknown()).parse(raw); for (const key of ['is_drm', 'drm_tech_type', 'is_upower_exclusive', 'is_chargeable_season', 'need_login', 'pay']) {
    const v = value[key];
    if (v !== undefined && v !== null && v !== 0 && v !== false && v !== '0')
        throw new Error('BILI_RESTRICTED_MEDIA');
} if (value.rights)
    rejectRestricted(value.rights); }
/** Platform locators stay private. Media receives versioned public descriptors and verified byte streams. */
export class BiliMedia {
    store;
    client;
    ready;
    id = 'bilibili';
    constructor(store, client, ready) {
        this.store = store;
        this.client = client;
        this.ready = ready;
    }
    describe(key) { try {
        if (!this.ready())
            return null;
        const media = this.store.media(key, Date.now(), true);
        return media && this.store.current(media.description.origin) ? media.description : null;
    }
    catch {
        return null;
    } }
    async probe(urlValue, signal, guard) {
        const url = biliUrl(urlValue, 'media'), opened = await this.client.external(url.href, 'media', { start: 0, end: 0 }, signal, guard, { allowWhole: true }), response = opened.response;
        try {
            const etag = response.headers.etag && /^"[^"\x00-\x1f]{1,200}"$/.test(response.headers.etag) ? response.headers.etag : null;
            let bytes, range = false;
            if (response.status === 206) {
                const found = /^bytes 0-0\/(\d+)$/.exec(response.headers['content-range'] ?? '');
                if (!found || response.headers['content-length'] !== '1')
                    throw new Error('BILI_RANGE_UNCONFIRMED');
                bytes = length(found[1]);
                await boundedBytes(response, 1, opened.signal, guard);
                range = !!etag;
            }
            else
                bytes = length(response.headers['content-length']);
            if (!range && bytes !== null && bytes > this.client.config.maxMediaReadBytes)
                throw new Error('BILI_RANGE_REQUIRED');
            guard();
            const deadline = Number(url.searchParams.get('deadline')), expiresAt = Math.min(Date.now() + 900000, Number.isFinite(deadline) && deadline > 0 ? deadline * 1000 - 1000 : Number.MAX_SAFE_INTEGER);
            if (expiresAt <= Date.now())
                throw new Error('BILI_MEDIA_EXPIRED');
            return { locator: locatorSchema.parse({ url: url.href, bytes, etag, range, accountStamp: this.client.accountStamp() }), expiresAt };
        }
        finally {
            response.close();
        }
    }
    async prepare(raw, part, signal, guard) {
        rejectRestricted(raw);
        rejectRestricted(z.object({ dash: z.unknown() }).parse(raw).dash);
        const value = z.object({ dash: z.object({ video: z.array(track).max(128), audio: z.array(track).max(128).nullable().optional() }), timelength: z.number().positive().finite().optional() }).parse(raw);
        const choose = (tracks, codec) => tracks.filter(t => codec.test(t.codecs)).sort((a, b) => a.bandwidth - b.bandwidth)[0], video = choose(value.dash.video, /^avc1\./), audio = choose(value.dash.audio ?? [], /^mp4a\./);
        if (!video)
            throw new Error('BILI_VIDEO_CODEC_UNAVAILABLE');
        const available = [{ kind: 'video', value: video }, ...(audio ? [{ kind: 'audio', value: audio }] : [])], pending = [];
        for (const t of available) {
            guard();
            const url = t.value.baseUrl ?? t.value.base_url;
            if (!url)
                throw new Error('BILI_MEDIA_URL_MISSING');
            const probe = await this.probe(url, signal, guard);
            pending.push({ key: 'stream:' + randomUUID(), kind: t.kind, codec: t.value.codecs, quality: t.value.id, ...probe });
        }
        const coverage = ['仅登记实际播放轨道和字节身份；尚未观看／听取', ...(audio ? [] : ['未取得可用AAC音轨，不能声称完成声音理解']), ...(pending.some(p => !p.locator.range) ? ['部分轨道不具备强ETag区间证据，仅允许有界整文件读取'] : [])];
        return { data: { bvid: part.bvid, cid: part.cid, durationMs: part.durationMs, streams: pending.map(p => ({ source: { provider: 'bilibili', key: p.key }, kind: p.kind, codec: p.codec, quality: p.quality, bytes: p.locator.bytes, rangeReadable: p.locator.range })) }, fields: [], coverage,
            register: (page) => { for (const p of pending) {
                const description = { ref: { provider: 'bilibili', key: p.key }, origin: this.store.proof(page), kind: p.kind, name: `bilibili-${part.cid}-${p.kind}.${p.kind === 'video' ? 'mp4' : 'm4a'}`, mimeHint: p.kind === 'video' ? 'video/mp4' : 'audio/mp4', bytesHint: p.locator.bytes, durationMsHint: part.durationMs, rangeReadable: p.locator.range, publicContent: true };
                this.store.registerMedia(p.key, description, p.locator, p.expiresAt);
            } } };
    }
    async open(key, range, signal) {
        const saved = this.store.media(key);
        if (!saved || !this.describe(key))
            throw new Error('BILI_MEDIA_EXPIRED');
        const locator = locatorSchema.parse(saved.locator), hash = biliHash(saved.description), guard = () => { signal.throwIfAborted(); if (!this.ready() || biliHash(this.describe(key)) !== hash || !this.store.media(key))
            throw new Error('MEDIA_SOURCE_STALE'); if (this.client.accountStamp() !== locator.accountStamp)
            throw new Error('BILI_SESSION_CHANGED'); };
        guard();
        if (range && (!locator.range || locator.bytes === null || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start || range.end >= locator.bytes))
            throw new Error('BILI_RANGE_DENIED');
        const maximum = this.client.config.maxMediaReadBytes;
        if (range && range.end - range.start + 1 > maximum || !range && locator.bytes !== null && locator.bytes > maximum)
            throw new Error('BILI_MEDIA_SIZE_LIMIT');
        const opened = await this.client.external(locator.url, 'media', range, signal, guard, locator.etag ? { etag: locator.etag } : {}), response = opened.response;
        try {
            const count = length(response.headers['content-length']);
            if (count !== null && count > maximum)
                throw new Error('BILI_MEDIA_SIZE_LIMIT');
            if (locator.etag && response.headers.etag !== locator.etag)
                throw new Error('BILI_MEDIA_ENTITY_CHANGED');
            if (range) {
                const found = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range'] ?? '');
                if (!found || Number(found[1]) !== range.start || Number(found[2]) !== range.end || Number(found[3]) !== locator.bytes || count !== range.end - range.start + 1)
                    throw new Error('BILI_RANGE_UNCONFIRMED');
            }
            else if (locator.bytes !== null && count !== locator.bytes)
                throw new Error('BILI_MEDIA_ENTITY_CHANGED');
            const stream = (async function* () { let received = 0; try {
                for await (const bytes of response.body) {
                    guard();
                    opened.signal.throwIfAborted();
                    if (!(bytes instanceof Uint8Array))
                        throw new Error('BILI_INVALID_BYTES');
                    received += bytes.length;
                    if (received > maximum || count !== null && received > count)
                        throw new Error('BILI_MEDIA_SIZE_LIMIT');
                    yield Buffer.from(bytes);
                }
                guard();
                if (count !== null && received !== count)
                    throw new Error('BILI_RESPONSE_TRUNCATED');
            }
            finally {
                response.close();
            } })();
            const total = locator.bytes ?? count;
            return { bytes: count, ...(total === null ? {} : { totalBytes: total }), range, mime: saved.description.mimeHint, stream };
        }
        catch (e) {
            response.close();
            throw e;
        }
    }
}
