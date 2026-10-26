import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { nextWithAbort, abortable } from './files.js';
const live = new WeakSet();
export class MediaRangeBroker {
    bytes;
    maximum;
    read;
    guard;
    caller;
    token = randomUUID();
    abort = new AbortController();
    server;
    addressValue = null;
    transferred = 0;
    ranges = [];
    pending = new Set();
    constructor(bytes, maximum, read, guard, caller) {
        this.bytes = bytes;
        this.maximum = maximum;
        this.read = read;
        this.guard = guard;
        this.caller = caller;
        this.server = createServer((request, response) => {
            const work = (async () => {
                if (request.url !== `/${this.token}` || !['GET', 'HEAD'].includes(request.method ?? '')) {
                    response.writeHead(404).end();
                    return;
                }
                this.guard();
                this.caller.throwIfAborted();
                this.abort.signal.throwIfAborted();
                const value = request.headers.range, match = value === undefined ? null : /^bytes=(\d+)-(\d*)$/.exec(value);
                if (value !== undefined && !match) {
                    response.writeHead(416).end();
                    return;
                }
                const start = match ? Number(match[1]) : 0, end = match && match[2] ? Number(match[2]) : bytes - 1;
                if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= bytes) {
                    response.writeHead(416).end();
                    return;
                }
                const cancel = new AbortController(), signal = AbortSignal.any([caller, this.abort.signal, cancel.signal]);
                response.on('close', () => { if (!response.writableEnded)
                    cancel.abort(); });
                const headers = { 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Content-Type': 'application/octet-stream', ...(match ? { 'Content-Range': `bytes ${start}-${end}/${bytes}` } : {}) };
                if (request.method === 'HEAD') {
                    response.writeHead(match ? 206 : 200, headers).end();
                    return;
                }
                let iterator;
                const hash = createHash('sha256');
                let count = 0;
                try {
                    if (this.transferred >= this.maximum)
                        throw new Error('MEDIA_RANGE_LIMIT');
                    const opened = await abortable(this.read({ start, end }, signal), signal);
                    this.guard();
                    iterator = opened.stream[Symbol.asyncIterator]();
                    if (opened.totalBytes !== bytes || opened.range?.start !== start || opened.range.end !== end)
                        throw new Error('MEDIA_RANGE_UNCONFIRMED');
                    response.writeHead(match ? 206 : 200, headers);
                    while (true) {
                        const next = await nextWithAbort(iterator, signal);
                        if (next.done)
                            break;
                        this.guard();
                        if (!(next.value instanceof Uint8Array))
                            throw new Error('MEDIA_BYTES_INVALID');
                        const chunk = Buffer.from(next.value);
                        this.transferred += chunk.length;
                        if (count + chunk.length > end - start + 1 || this.transferred > this.maximum)
                            throw new Error('MEDIA_RANGE_LIMIT');
                        hash.update(chunk);
                        count += chunk.length;
                        if (!response.write(chunk))
                            await new Promise((resolve, reject) => {
                                const cancelled = () => { cleanup(); reject(new Error('MEDIA_CANCELLED')); }, drained = () => { cleanup(); resolve(); };
                                const cleanup = () => { signal.removeEventListener('abort', cancelled); response.off('drain', drained); };
                                signal.addEventListener('abort', cancelled, { once: true });
                                response.once('drain', drained);
                                if (signal.aborted)
                                    cancelled();
                            });
                    }
                    if (count !== end - start + 1)
                        throw new Error('MEDIA_SOURCE_TRUNCATED');
                    this.guard();
                    response.end();
                }
                finally {
                    cancel.abort();
                    void iterator?.return?.().catch(() => { });
                    if (count)
                        this.ranges.push({ start, end: start + count - 1, sha256: hash.digest('hex') });
                }
            })().catch(() => { response.destroy(); }).finally(() => this.pending.delete(work));
            this.pending.add(work);
        });
    }
    static async open(options) {
        if (!Number.isSafeInteger(options.bytes) || options.bytes < 1 || !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)
            throw new Error('MEDIA_RANGE_INVALID');
        options.guard();
        const broker = new MediaRangeBroker(options.bytes, options.maxBytes, options.read, options.guard, options.signal);
        await new Promise((resolve, reject) => { broker.server.once('error', reject); broker.server.listen(0, '127.0.0.1', resolve); });
        const address = broker.server.address();
        if (!address || typeof address === 'string')
            throw new Error('MEDIA_BROKER_FAILED');
        broker.addressValue = `http://127.0.0.1:${address.port}/${broker.token}`;
        live.add(broker);
        return broker;
    }
    url() { if (!live.has(this) || !this.addressValue || this.abort.signal.aborted)
        throw new Error('MEDIA_LEASE_EXPIRED'); this.guard(); return this.addressValue; }
    get coverage() { return { transferredBytes: this.transferred, ranges: [...this.ranges] }; }
    async close() { if (!live.has(this))
        return; live.delete(this); this.abort.abort(); this.server.closeAllConnections(); await new Promise(resolve => this.server.close(() => resolve())); await Promise.allSettled([...this.pending]); }
}
