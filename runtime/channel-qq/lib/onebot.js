import { z } from 'zod';
import { redactContent } from '#dafeiyu/contracts';
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
const responseSchema = z.object({ status: z.string(), retcode: z.number(), data: z.unknown(), wording: z.unknown().optional(), message: z.unknown().optional() });
const diagnosticSchema = z.strictObject({ kind: z.literal('onebot-call'), action: z.string().max(80), phase: z.enum(['before-fetch', 'fetch', 'body', 'response']), elapsedMs: z.number().nonnegative(), fetchInvoked: z.boolean(), callerAborted: z.boolean(), requestTimedOut: z.boolean(), httpStatus: z.number().int().optional(), retcode: z.number().optional(), status: z.enum(['ok', 'failed', 'async', 'other']).optional(), wording: z.string().max(200).optional(), errorName: z.string().max(40).optional() });
class OneBotFailure extends Error {
    diagnostic;
    constructor(message, diagnostic) {
        super(message);
        this.diagnostic = diagnostic;
    }
}
export function oneBotDiagnostic(error) { return error instanceof OneBotFailure ? error.diagnostic : { kind: 'local-call', errorName: error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error' }; }
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
        const started = Date.now();
        let fetchInvoked = false, phase = 'before-fetch';
        const failure = (message, extra = {}) => new OneBotFailure(message, diagnosticSchema.parse({ kind: 'onebot-call', action, phase, elapsedMs: Math.max(0, Date.now() - started), fetchInvoked, callerAborted: signal?.aborted ?? false, requestTimedOut: timeout.aborted, ...extra }));
        try {
            signal?.throwIfAborted();
            fetchInvoked = true;
            phase = 'fetch';
            const response = await fetch(new URL(action, this.base), { method: 'POST', redirect: 'error',
                // Local processing can outlast an idle socket's server timeout. Avoid reusing that socket;
                // never repair an ambiguous send by automatically issuing the POST again.
                headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify(params),
                signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
            phase = 'body';
            if (!response.ok)
                throw failure('ONEBOT_HTTP_FAILURE', { httpStatus: response.status });
            const reader = response.body?.getReader();
            if (!reader)
                throw failure('ONEBOT_INVALID_RESPONSE');
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
                        throw failure('ONEBOT_RESPONSE_LIMIT');
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
                throw failure('ONEBOT_INVALID_RESPONSE');
            }
            const body = responseSchema.parse(raw);
            phase = 'response';
            if (body.status !== 'ok' || body.retcode !== 0) {
                const rawWording = typeof body.wording === 'string' ? body.wording : typeof body.message === 'string' ? body.message : '';
                const wording = redactContent(this.token ? rawWording.replaceAll(this.token, '[REDACTED]') : rawWording).value.replace(/[A-Za-z0-9+/_=-]{40,}/g, '[REDACTED]').slice(0, 200);
                throw failure('ONEBOT_REJECTED_OR_UNKNOWN', { httpStatus: response.status, retcode: body.retcode, status: body.status === 'failed' ? 'failed' : body.status === 'async' ? 'async' : 'other', wording });
            }
            return body.data;
        }
        catch (error) {
            if (error instanceof OneBotFailure)
                throw error;
            throw failure('ONEBOT_CALL_UNCERTAIN', { errorName: error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error' });
        }
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
