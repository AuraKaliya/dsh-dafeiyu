import { z } from 'zod';
import { parseSnowLumaGroups, SNOWLUMA_GROUP_LIST_REQUEST } from './snowluma-groups.js';
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
    call(action, params, signal) { return this.request(action, params, signal); }
    async request(action, params, signal) {
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
        const maxResponse = action === 'get_record' ? 32 * 1024 ** 2 : 2 * 1024 ** 2;
        try {
            while (true) {
                const part = await reader.read();
                if (part.done)
                    break;
                bytes += part.value.byteLength;
                if (bytes > maxResponse) {
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
        let response;
        try {
            response = await this.request('send_packet', SNOWLUMA_GROUP_LIST_REQUEST, signal);
        }
        catch (error) {
            signal.throwIfAborted();
            throw new Error('GROUP_SETTINGS_UNAVAILABLE');
        }
        const list = parseSnowLumaGroups(response);
        await this.verify(signal);
        return list;
    }
    async history(scene, anchor, signal) {
        if (scene.account !== this.botId || !['private', 'group'].includes(scene.kind) || !/^[1-9]\d{4,14}$/.test(scene.id))
            throw new Error('TARGET_NOT_ALLOWED');
        const messageId = anchor === null ? 0 : Number(anchor);
        if (!Number.isSafeInteger(messageId))
            throw new Error('HISTORY_INVALID_ANCHOR');
        await this.verify(signal);
        const data = await this.request(scene.kind === 'group' ? 'get_group_msg_history' : 'get_friend_msg_history', { [scene.kind === 'group' ? 'group_id' : 'user_id']: Number(scene.id), message_id: messageId, count: 20, reverse_order: true }, signal);
        await this.verify(signal);
        return data;
    }
}
