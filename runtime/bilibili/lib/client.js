import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { BvidSchema, NumberIdSchema } from './config.js';
import { biliUrl, nativeTransport, boundedBytes, boundedJson } from './http.js';
const page = z.number().int().min(1).max(1000), size = z.number().int().min(1).max(20);
const endpoints = {
    nav: { path: '/x/web-interface/nav', schema: z.strictObject({}), signed: false },
    discover: { path: '/x/web-interface/popular', schema: z.strictObject({ pn: page, ps: size }), signed: false },
    search: { path: '/x/web-interface/search/type', schema: z.strictObject({ search_type: z.literal('video'), keyword: z.string().trim().min(1).max(100), page, page_size: size, order: z.enum(['totalrank', 'pubdate', 'click']) }), signed: false },
    video: { path: '/x/web-interface/view', schema: z.strictObject({ bvid: BvidSchema }), signed: false },
    comments: { path: '/x/v2/reply', schema: z.strictObject({ type: z.literal(1), oid: NumberIdSchema, pn: page, ps: size, sort: z.union([z.literal(0), z.literal(2)]) }), signed: false },
    replies: { path: '/x/v2/reply/reply', schema: z.strictObject({ type: z.literal(1), oid: NumberIdSchema, root: NumberIdSchema, pn: page, ps: size }), signed: false },
    player: { path: '/x/player/wbi/v2', schema: z.strictObject({ bvid: BvidSchema, cid: NumberIdSchema }), signed: true },
    play: { path: '/x/player/wbi/playurl', schema: z.strictObject({ bvid: BvidSchema, cid: NumberIdSchema, qn: z.literal(64), fnval: z.literal(4048), fourk: z.literal(0) }), signed: true },
    danmaku: { path: '/x/v2/dm/web/seg.so', schema: z.strictObject({ type: z.literal(1), oid: NumberIdSchema, segment_index: page }), signed: false }
};
const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
export function wbiQuery(params, img, sub, seconds) {
    const stem = (raw) => { const part = new URL(raw).pathname.split('/').at(-1)?.split('.')[0]; if (!part || !/^[a-f0-9]{32}$/i.test(part))
        throw new Error('BILI_WBI_UNAVAILABLE'); return part; };
    const raw = stem(img) + stem(sub), key = MIXIN.map(n => raw[n]).join('').slice(0, 32), all = { ...params, wts: seconds }, query = Object.entries(all).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v).replace(/[!'()*]/g, ''))).join('&');
    return query + '&w_rid=' + createHash('md5').update(query + key).digest('hex');
}
const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', Referer: 'https://www.bilibili.com/', Accept: 'application/json' };
const id = z.union([NumberIdSchema, z.number().int().positive().safe().transform(String)]);
export class BiliClient {
    config;
    store;
    transport;
    constructor(config, store, transport = nativeTransport) {
        this.config = config;
        this.store = store;
        this.transport = transport;
    }
    accountStamp() { return createHash('sha256').update(this.session()?.hash ?? 'anonymous').digest('hex'); }
    session() {
        const setting = this.config.session;
        if (!setting)
            return null;
        try {
            if (!/^[a-zA-Z]:[\\/][^:\x00]+$/.test(setting.file))
                throw new Error('BILI_SESSION_INVALID');
            const stat = lstatSync(setting.file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
                throw new Error('BILI_SESSION_INVALID');
            const bytes = readFileSync(setting.file);
            if (bytes.length > 16384)
                throw new Error('BILI_SESSION_INVALID');
            const value = z.strictObject({ uid: NumberIdSchema, SESSDATA: z.string().min(1).max(4096).regex(/^[^;\s\x00-\x1f\x7f]+$/), bili_jct: z.string().regex(/^[a-fA-F0-9]{32}$/).optional(), buvid3: z.string().max(200).regex(/^[a-zA-Z0-9_-]+$/).optional() }).parse(boundedJson(bytes));
            if (value.uid !== setting.expectedUid)
                throw new Error('BILI_ACCOUNT_MISMATCH');
            return { hash: createHash('sha256').update(bytes).digest('hex'), cookie: 'SESSDATA=' + value.SESSDATA + (value.buvid3 ? '; buvid3=' + value.buvid3 : '') };
        }
        catch (e) {
            throw new Error(e instanceof Error && e.message === 'BILI_ACCOUNT_MISMATCH' ? e.message : 'BILI_SESSION_INVALID');
        }
    }
    async slot(signal, guard) { guard(); signal.throwIfAborted(); const wait = this.store.reserveRequest(Date.now(), this.config.minIntervalMs, this.config.timeoutMs); if (wait)
        await setTimeout(wait, undefined, { signal }); guard(); signal.throwIfAborted(); if (this.store.clock.blockedUntil > Date.now())
        throw new Error('BILI_BACKOFF'); }
    async get(url, cookie, signal, guard) {
        await this.slot(signal, guard);
        const response = await this.transport(url, { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, signal);
        try {
            guard();
            signal.throwIfAborted();
            if (response.status === 412 || response.status === 429) {
                const retry = Number(response.headers['retry-after']), duration = Number.isFinite(retry) ? Math.max(this.config.backoffMs, Math.min(86400000, retry * 1000)) : this.config.backoffMs;
                this.store.backoff(Date.now(), duration);
                throw new Error('BILI_BACKOFF');
            }
            if (response.status !== 200)
                throw new Error(response.status === 401 || response.status === 403 ? 'BILI_ACCESS_DENIED' : response.status >= 300 && response.status < 400 ? 'BILI_REDIRECT_DENIED' : 'BILI_HTTP_FAILED');
            return response;
        }
        catch (e) {
            response.close();
            throw e;
        }
    }
    async json(url, cookie, signal, guard, anonymousNav = false) {
        const raw = boundedJson(await boundedBytes(await this.get(url, cookie, signal, guard), this.config.maxResponseBytes, signal, guard)), envelope = z.object({ code: z.number().int(), data: z.unknown().optional() }).parse(raw);
        if ([-352, -412, -509, -799].includes(envelope.code)) {
            this.store.backoff(Date.now(), this.config.backoffMs);
            throw new Error('BILI_BACKOFF');
        }
        if (envelope.code !== 0 && !(anonymousNav && envelope.code === -101))
            throw new Error(envelope.code === -101 ? 'BILI_LOGIN_REQUIRED' : envelope.code === -404 || envelope.code === 62002 ? 'BILI_NOT_FOUND' : 'BILI_PLATFORM_ERROR');
        return envelope.data;
    }
    async read(endpoint, input, caller, guard) {
        if (!Object.hasOwn(endpoints, endpoint))
            throw new Error('BILI_ENDPOINT_DENIED');
        const spec = endpoints[endpoint], params = z.record(z.string(), z.union([z.string(), z.number()])).parse(spec.schema.parse(input)), session = this.session(), signal = AbortSignal.any([caller, AbortSignal.timeout(this.config.timeoutMs)]);
        const checked = () => { guard(); signal.throwIfAborted(); if (this.session()?.hash !== session?.hash)
            throw new Error('BILI_SESSION_CHANGED'); };
        checked();
        let nav;
        if (session || spec.signed || endpoint === 'nav') {
            nav = await this.json(biliUrl('https://api.bilibili.com' + endpoints.nav.path, 'api'), session?.cookie ?? null, signal, checked, !session);
            if (session) {
                const account = z.object({ isLogin: z.literal(true), mid: id }).parse(nav);
                if (account.mid !== this.config.session.expectedUid)
                    throw new Error('BILI_ACCOUNT_MISMATCH');
            }
        }
        if (endpoint === 'nav')
            return nav;
        const url = biliUrl('https://api.bilibili.com' + spec.path, 'api');
        if (spec.signed) {
            const keys = z.object({ wbi_img: z.object({ img_url: z.string(), sub_url: z.string() }) }).parse(nav).wbi_img;
            url.search = wbiQuery(params, keys.img_url, keys.sub_url, Math.floor(Date.now() / 1000));
        }
        else
            url.search = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
        if (endpoint === 'danmaku')
            return boundedBytes(await this.get(url, session?.cookie ?? null, signal, checked), this.config.maxResponseBytes, signal, checked);
        return this.json(url, session?.cookie ?? null, signal, checked);
    }
    async external(urlValue, kind, range, caller, guard, options = {}) {
        const url = biliUrl(urlValue, kind), signal = AbortSignal.any([caller, AbortSignal.timeout(this.config.timeoutMs)]);
        await this.slot(signal, guard);
        const response = await this.transport(url, { ...headers, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}), ...(options.etag ? { 'If-Match': options.etag } : {}) }, signal);
        try {
            guard();
            signal.throwIfAborted();
            if (response.status === 412 || response.status === 429) {
                this.store.backoff(Date.now(), this.config.backoffMs);
                throw new Error('BILI_BACKOFF');
            }
            if (response.status !== (range ? 206 : 200) && !(options.allowWhole && response.status === 200))
                throw new Error('BILI_EXTERNAL_HTTP_FAILED');
            if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')
                throw new Error('BILI_ENCODING_UNSUPPORTED');
            return { response, signal };
        }
        catch (e) {
            response.close();
            throw e;
        }
    }
}
