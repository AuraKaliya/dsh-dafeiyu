import { z } from 'zod';
import { GroupListSchema, QqAccountIdSchema } from './groups.js';
/** No remote OneBot endpoints or credential-bearing URLs in this local development connector. */
export function loopbackURL(value, protocol) {
    const url = new URL(value);
    if (url.protocol !== protocol || !['127.0.0.1', '[::1]'].includes(url.hostname)
        || url.username || url.password || url.search || url.hash || url.pathname !== '/')
        throw new Error('Expected a plain loopback endpoint');
    return url.href;
}
export const platformId = z.union([z.string().regex(/^-?\d+$/), z.number().int().safe()]).transform(String);
const responseSchema = z.object({ status: z.string(), retcode: z.number(), data: z.unknown() });
export class OneBot {
    base;
    token;
    botId;
    timeoutMs;
    constructor(base, token, botId, timeoutMs) {
        this.base = base;
        this.token = token;
        this.botId = botId;
        this.timeoutMs = timeoutMs;
    }
    async call(action, params, signal) {
        const timeout = AbortSignal.timeout(this.timeoutMs);
        const response = await fetch(new URL(action, this.base), { method: 'POST', redirect: 'error',
            // Local processing can outlast an idle socket's server timeout. Avoid reusing that socket;
            // never repair an ambiguous send by automatically issuing the POST again.
            headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify(params),
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
        if (!response.ok)
            throw new Error('ONEBOT_HTTP_FAILURE');
        const reader = response.body?.getReader();
        if (!reader)
            throw new Error('ONEBOT_INVALID_RESPONSE');
        const chunks = [];
        let bytes = 0;
        try {
            while (true) {
                const part = await reader.read();
                if (part.done)
                    break;
                bytes += part.value.byteLength;
                if (bytes > 2 * 1024 ** 2) {
                    await reader.cancel();
                    throw new Error('ONEBOT_RESPONSE_LIMIT');
                }
                chunks.push(part.value);
            }
        }
        finally {
            reader.releaseLock();
        }
        let raw;
        try {
            raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        }
        catch {
            throw new Error('ONEBOT_INVALID_RESPONSE');
        }
        const body = responseSchema.parse(raw);
        if (body.status !== 'ok' || body.retcode !== 0)
            throw new Error('ONEBOT_REJECTED_OR_UNKNOWN');
        return body.data;
    }
    async verify(signal) {
        const info = z.object({ user_id: platformId }).parse(await this.call('get_login_info', {}, signal));
        if (info.user_id !== this.botId)
            throw new Error('ACCOUNT_MISMATCH');
        const status = z.object({ online: z.boolean() }).parse(await this.call('get_status', {}, signal));
        if (!status.online)
            throw new Error('QQ_OFFLINE');
    }
    async groups(signal) {
        await this.verify(signal);
        const response = await this.call('get_group_list', {}, signal);
        const list = z.array(z.object({ group_id: platformId.pipe(QqAccountIdSchema), group_name: z.string().max(200) })).max(2000).parse(response);
        await this.verify(signal);
        return GroupListSchema.parse(list.map(group => ({ id: group.group_id, name: group.group_name })));
    }
}
