import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
export function publicAddress(value) { if (isIP(value) !== 4)
    return false; const [a, b, c] = value.split('.').map(Number); return a !== 0 && a !== 10 && a !== 127 && a >= 1 && a < 224 && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99)) && !(a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) && !(a === 203 && b === 0 && c === 113); }
export function biliUrl(value, kind) {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value), suffixes = kind === 'media' ? ['bilivideo.com', 'bilivideo.cn', 'bilivideo.net'] : ['hdslb.com'];
    if (url.protocol !== 'https:' || url.port && url.port !== '443' || url.username || url.password || url.hash || isIP(url.hostname) || !(kind === 'api' ? url.hostname === 'api.bilibili.com' : suffixes.some(s => url.hostname === s || url.hostname.endsWith('.' + s))))
        throw new Error('BILI_URL_DENIED');
    return url;
}
/** Pinned public IPv4, fixed HTTPS origin, no automatic redirect or ambient credentials. */
export const nativeTransport = async (url, headers, signal) => {
    signal.throwIfAborted();
    const addresses = await lookup(url.hostname, { all: true });
    signal.throwIfAborted();
    const address = addresses.find(a => a.family === 4 && publicAddress(a.address));
    if (!address || addresses.some(a => a.family === 4 && !publicAddress(a.address) || a.family === 6 && !/^[23][0-9a-f]{3}:/i.test(a.address)))
        throw new Error('BILI_ADDRESS_DENIED');
    const pinned = (_host, options, callback) => { if (options.all)
        callback(null, [address]);
    else
        callback(null, address.address, 4); };
    const response = await new Promise((done, reject) => { const req = request(url, { method: 'GET', lookup: pinned, headers: { ...headers, 'Accept-Encoding': 'identity', Connection: 'close' }, signal }, done); req.on('error', () => reject(new Error(signal.aborted ? 'BILI_CANCELLED' : 'BILI_HTTP_FAILED'))); req.end(); });
    response.on('error', () => { });
    return { status: response.statusCode ?? 0, headers: Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v])), body: response, close: () => response.destroy() };
};
export async function boundedBytes(response, maximum, signal, guard) {
    const chunks = [];
    let length = 0;
    try {
        guard();
        signal.throwIfAborted();
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')
            throw new Error('BILI_ENCODING_UNSUPPORTED');
        const declared = response.headers['content-length'] === undefined ? null : Number(response.headers['content-length']);
        if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0 || declared > maximum))
            throw new Error('BILI_RESPONSE_LIMIT');
        for await (const chunk of response.body) {
            signal.throwIfAborted();
            guard();
            if (!(chunk instanceof Uint8Array))
                throw new Error('BILI_INVALID_BYTES');
            length += chunk.length;
            if (length > maximum)
                throw new Error('BILI_RESPONSE_LIMIT');
            chunks.push(Buffer.from(chunk));
        }
        if (declared !== null && declared !== length)
            throw new Error('BILI_RESPONSE_TRUNCATED');
        guard();
        signal.throwIfAborted();
        return Buffer.concat(chunks, length);
    }
    finally {
        response.close();
    }
}
export function boundedJson(bytes) {
    let root;
    try {
        root = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }
    catch {
        throw new Error('BILI_INVALID_JSON');
    }
    const queue = [[root, 0]];
    let count = 0;
    while (queue.length) {
        const [value, depth] = queue.pop();
        if (++count > 100000 || depth > 32)
            throw new Error('BILI_RESPONSE_COMPLEXITY');
        if (value && typeof value === 'object') {
            const values = Object.values(value);
            if (values.length > 20000)
                throw new Error('BILI_RESPONSE_COMPLEXITY');
            for (const child of values)
                queue.push([child, depth + 1]);
        }
    }
    return root;
}
