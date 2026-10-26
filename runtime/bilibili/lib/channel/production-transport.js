import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BiliOwnerBindingSchema, BiliOwnerIdSchema, BiliOwnerPageSchema, biliOwnerTextHash } from './types.js';
import { loadBiliOwnerProductionBinding, assertPinnedBiliOwnerProductionBinding } from './production-config.js';
import { acquireBiliOwnerConsumerLease, assertBiliOwnerProductionLease } from './production-lease.js';
const NAV = 'https://api.bilibili.com/x/web-interface/nav', READ = 'https://api.vc.bilibili.com/svr_sync/v1/svr_sync/fetch_session_msgs', SEND = 'https://api.vc.bilibili.com/web_im/v1/web_im/send_msg';
const RESPONSE_LIMIT = 1048576;
const apiId = z.union([BiliOwnerIdSchema, z.number().int().positive().safe().transform(String)]);
const messageSchema = z.object({ msg_key: apiId.optional(), msg_seqno: apiId, sender_uid: apiId, receiver_id: apiId, receiver_type: z.literal(1), msg_type: z.number().int().nonnegative(), timestamp: z.number().int().nonnegative().max(253402300799), content: z.string().max(131072) });
const replySchema = z.strictObject({ requestId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/), text: z.string().min(1).max(4000), wireHash: z.string().regex(/^[a-f0-9]{64}$/) });
const readSchema = z.strictObject({ beforeSeqno: BiliOwnerIdSchema.optional(), limit: z.number().int().min(1).max(30) });
function code(error) {
    const named = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (error instanceof z.ZodError)
        return 'BILI_OWNER_INVALID_INPUT';
    if (named === 'BILI_ACCOUNT_MISMATCH' || named === 'BILI_OWNER_MISMATCH')
        return 'BILI_OWNER_ACCOUNT_MISMATCH';
    if (['BILI_LOGIN_REQUIRED', 'BILI_LOGIN_EXPIRED', 'BILI_API_-101'].includes(String(named)))
        return 'BILI_OWNER_LOGIN_REQUIRED';
    if (named === 'BILI_RISK')
        return 'BILI_OWNER_PLATFORM_RISK';
    if (named === 'BILI_NETWORK')
        return 'BILI_OWNER_NETWORK_UNKNOWN';
    return error instanceof Error && /^BILI_OWNER_[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : 'BILI_OWNER_PLATFORM_FAILED';
}
function safeText(text) { return text === text.trim() && text.length > 0 && Array.from(text).length <= 1000 && ![...text].some(char => { const value = char.codePointAt(0); return value >= 0xd800 && value <= 0xdfff; }); }
function depthBounded(text) {
    let depth = 0, quoted = false, escaped = false;
    for (const char of text) {
        if (quoted) {
            if (escaped)
                escaped = false;
            else if (char === '\\')
                escaped = true;
            else if (char === '"')
                quoted = false;
            continue;
        }
        if (char === '"')
            quoted = true;
        else if (char === '{' || char === '[') {
            if (++depth > 32)
                throw new Error('BILI_OWNER_RESPONSE_LIMIT');
        }
        else if (char === '}' || char === ']')
            depth--;
    }
}
async function boundedResponse(response, signal) {
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || BigInt(length) > BigInt(RESPONSE_LIMIT))) {
        await response.body?.cancel();
        throw new Error('BILI_OWNER_RESPONSE_LIMIT');
    }
    const reader = response.body?.getReader(), chunks = [];
    let size = 0;
    const abort = () => { void reader?.cancel().catch(() => { }); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        if (reader)
            for (;;) {
                signal.throwIfAborted();
                const next = await reader.read();
                if (next.done)
                    break;
                size += next.value.byteLength;
                if (size > RESPONSE_LIMIT)
                    throw new Error('BILI_OWNER_RESPONSE_LIMIT');
                chunks.push(next.value);
            }
        signal.throwIfAborted();
    }
    catch (error) {
        await reader?.cancel().catch(() => { });
        throw error;
    }
    finally {
        signal.removeEventListener('abort', abort);
        reader?.releaseLock();
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    depthBounded(text);
    return new Response(text, { status: response.status, headers: { 'content-type': 'application/json' } });
}
function keysExact(actual, expected) { const names = [...actual]; return names.length === expected.length && new Set(names).size === names.length && names.every(name => expected.includes(name)); }
/** Uses only verified Auth bytes, with all platform requests passing this per-invocation guard. */
export async function createBiliOwnerProductionTransport(binding, lease, dependencies = {}) {
    assertPinnedBiliOwnerProductionBinding(binding);
    assertBiliOwnerProductionLease(lease, binding);
    if (Object.keys(dependencies).some(key => key !== 'fetch') || dependencies.fetch !== undefined && typeof dependencies.fetch !== 'function')
        throw new Error('BILI_OWNER_PRODUCTION_DEPENDENCY');
    const { accountUid, ownerUid } = binding.manifest;
    const fetchImpl = dependencies.fetch ?? globalThis.fetch, local = new AsyncLocalStorage(), controller = new AbortController();
    let closed = false, auth;
    const guard = () => { if (closed)
        throw new Error('BILI_OWNER_TRANSPORT_CLOSED'); binding.guard(); assertBiliOwnerProductionLease(lease, binding); };
    const credentials = () => { binding.credentialPathGuard(); const value = z.object({ mid: apiId }).safeParse(auth.session(false)); if (!value.success)
        throw new Error('BILI_OWNER_LOGIN_REQUIRED'); if (value.data.mid !== accountUid)
        throw new Error('BILI_OWNER_ACCOUNT_MISMATCH'); };
    const guardedFetch = async (input, init) => {
        const invocation = local.getStore();
        if (!invocation)
            throw new Error('BILI_OWNER_UNBOUND_REQUEST');
        try {
            guard();
            invocation.signal.throwIfAborted();
            invocation.guard();
            credentials();
            const url = new URL(input instanceof Request ? input.url : String(input)), endpoint = url.origin + url.pathname;
            if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || init?.redirect !== 'error')
                throw new Error('BILI_OWNER_ENDPOINT_DENIED');
            const method = init.method ?? 'GET', query = url.searchParams;
            if (endpoint === NAV) {
                if (method !== 'GET' || [...query].length || init.body !== undefined)
                    throw new Error('BILI_OWNER_ENDPOINT_DENIED');
            }
            else if (endpoint === READ && invocation.kind === 'read') {
                if (method !== 'GET' || init.body !== undefined || !keysExact(query.keys(), ['talker_id', 'session_type', 'size', 'begin_seqno', 'wts', 'w_rid']) || query.get('talker_id') !== ownerUid || query.get('session_type') !== '1' || query.get('size') !== String(invocation.limit) || query.get('begin_seqno') !== (invocation.before ?? '0'))
                    throw new Error('BILI_OWNER_ENDPOINT_DENIED');
            }
            else if (endpoint === SEND && invocation.kind === 'send') {
                if (method !== 'POST' || !(init.body instanceof URLSearchParams) || !keysExact(query.keys(), ['w_sender_uid', 'w_receiver_id', 'wts', 'w_rid']) || query.get('w_sender_uid') !== accountUid || query.get('w_receiver_id') !== ownerUid)
                    throw new Error('BILI_OWNER_ENDPOINT_DENIED');
                const body = init.body;
                if (!keysExact(body.keys(), ['msg[sender_uid]', 'msg[receiver_id]', 'msg[receiver_type]', 'msg[msg_type]', 'msg[msg_status]', 'msg[content]', 'msg[dev_id]', 'msg[new_face_version]', 'msg[timestamp]', 'from_filework', 'build', 'mobi_app', 'csrf', 'csrf_token'])
                    || body.get('msg[sender_uid]') !== accountUid || body.get('msg[receiver_id]') !== ownerUid || body.get('msg[receiver_type]') !== '1' || body.get('msg[msg_type]') !== '1' || body.get('msg[msg_status]') !== '0' || body.get('msg[new_face_version]') !== '0' || body.get('from_filework') !== '0' || body.get('build') !== '0' || body.get('mobi_app') !== 'web'
                    || body.get('msg[content]') !== JSON.stringify({ content: invocation.text }) || !body.get('csrf') || body.get('csrf') !== body.get('csrf_token') || !/^\d+$/.test(body.get('msg[timestamp]') ?? '') || !z.uuid().safeParse(body.get('msg[dev_id]')?.toLowerCase()).success)
                    throw new Error('BILI_OWNER_ENDPOINT_DENIED');
                if (process.env.DAFEIYU_BILI_READONLY === '1')
                    throw new Error('BILI_OWNER_READONLY');
            }
            else
                throw new Error('BILI_OWNER_ENDPOINT_DENIED');
            if (endpoint !== NAV && (!/^\d+$/.test(query.get('wts') ?? '') || !/^[a-f0-9]{32}$/.test(query.get('w_rid') ?? '')))
                throw new Error('BILI_OWNER_ENDPOINT_DENIED');
            const signal = AbortSignal.any([invocation.signal, controller.signal, ...(init.signal ? [init.signal] : [])]);
            signal.throwIfAborted();
            guard();
            invocation.guard();
            if (endpoint === SEND)
                invocation.dispatched = true;
            const response = await fetchImpl(url, { ...init, redirect: 'error', signal }), bounded = await boundedResponse(response, signal);
            if (endpoint === NAV && bounded.ok) {
                const body = z.object({ code: z.number(), data: z.object({ isLogin: z.boolean(), mid: apiId.optional() }).optional() }).safeParse(module.parseApiJson(await bounded.clone().text()));
                if (body.success && body.data.code === 0 && body.data.data?.isLogin && body.data.data.mid !== accountUid)
                    throw new Error('BILI_OWNER_ACCOUNT_MISMATCH');
            }
            return bounded;
        }
        catch (error) {
            invocation.failure = code(error);
            throw new Error(invocation.failure);
        }
    };
    // The approved source imports only builtins and performs no IO in its constructor. Execute the exact bytes already verified above.
    let module;
    try {
        const imported = await import('data:text/javascript;base64,' + Buffer.from(binding.authSource, 'utf8').toString('base64'));
        if (!imported || typeof imported !== 'object' || !('BiliAuth' in imported) || typeof imported.BiliAuth !== 'function' || !('parseApiJson' in imported) || typeof imported.parseApiJson !== 'function')
            throw new Error();
        module = imported;
        auth = new module.BiliAuth({ root: binding.config.installationRoot, ...(binding.config.credentialFile ? { credentialFile: binding.config.credentialFile } : {}), fetchImpl: guardedFetch, clock: Date.now });
    }
    catch {
        throw new Error('BILI_OWNER_AUTH_LOAD_FAILED');
    }
    guard();
    const invoke = async (invocation, work) => local.run(invocation, async () => { guard(); invocation.signal.throwIfAborted(); invocation.guard(); credentials(); return work(); });
    const bindingResult = () => ({ accountUid: accountUid, ownerUid: ownerUid, loggedIn: true, bindingStamp: binding.bindingStamp });
    return Object.freeze({ identityHash: binding.identityHash, guard,
        verify: async (signal, check) => {
            const current = { kind: 'verify', signal, guard: check, dispatched: false, failure: undefined };
            try {
                return await invoke(current, async () => {
                    const value = z.object({ loggedIn: z.literal(true), uid: apiId, ownerUid: apiId }).parse(await auth.status());
                    guard();
                    signal.throwIfAborted();
                    check();
                    if (value.uid !== accountUid || value.ownerUid !== ownerUid)
                        throw new Error('BILI_OWNER_ACCOUNT_MISMATCH');
                    return bindingResult();
                });
            }
            catch (error) {
                throw new Error(current.failure ?? code(error));
            }
        },
        readOwnerPage: async (raw, signal, check) => {
            const parsed = readSchema.safeParse(raw);
            if (!parsed.success)
                throw new Error('BILI_OWNER_INVALID_INPUT');
            const input = parsed.data, current = { kind: 'read', signal, guard: check, ...(input.beforeSeqno ? { before: input.beforeSeqno } : {}), limit: input.limit, dispatched: false, failure: undefined };
            try {
                return await invoke(current, async () => {
                    const raw = await auth.request(READ, { params: { talker_id: ownerUid, session_type: 1, size: input.limit, begin_seqno: input.beforeSeqno ?? '0' }, wbi: true });
                    const page = z.object({ data: z.object({ messages: z.array(messageSchema).max(input.limit), has_more: z.union([z.literal(0), z.literal(1), z.boolean()]) }) }).parse(raw), messages = page.data.messages.map(message => {
                        if (!(message.sender_uid === ownerUid && message.receiver_id === accountUid || message.sender_uid === accountUid && message.receiver_id === ownerUid))
                            throw new Error('BILI_OWNER_MESSAGE_PARTICIPANTS');
                        const text = message.msg_type === 1 ? z.strictObject({ content: z.string().max(32000) }).parse(JSON.parse(message.content)).content : '';
                        return { id: message.msg_key ?? message.msg_seqno, seqno: message.msg_seqno, senderUid: message.sender_uid, receiverUid: message.receiver_id, type: message.msg_type, timestamp: message.timestamp, text };
                    });
                    const hasMore = Boolean(page.data.has_more), smallest = messages.reduce((value, message) => value === null || BigInt(message.seqno) < BigInt(value) ? message.seqno : value, null);
                    guard();
                    signal.throwIfAborted();
                    check();
                    return BiliOwnerPageSchema.parse({ ...bindingResult(), messages, hasMore, nextBeforeSeqno: hasMore ? smallest : null });
                });
            }
            catch (error) {
                throw new Error(current.failure ?? code(error));
            }
        },
        sendOwnerText: async (raw, signal, check) => {
            const current = { kind: 'send', signal, guard: check, dispatched: false, failure: undefined };
            try {
                const input = replySchema.parse(raw);
                if (!safeText(input.text) || biliOwnerTextHash(input.text) !== input.wireHash)
                    throw new Error('BILI_OWNER_TEXT_INVALID');
                const invocation = { ...current, text: input.text };
                try {
                    return await invoke(invocation, async () => {
                        const result = await auth.request(SEND, { wbi: true, params: { w_sender_uid: accountUid, w_receiver_id: ownerUid }, data: { 'msg[sender_uid]': accountUid, 'msg[receiver_id]': ownerUid, 'msg[receiver_type]': 1, 'msg[msg_type]': 1, 'msg[msg_status]': 0, 'msg[content]': JSON.stringify({ content: input.text }), 'msg[dev_id]': randomUUID().toUpperCase(), 'msg[new_face_version]': 0, 'msg[timestamp]': Math.floor(Date.now() / 1000), from_filework: 0, build: 0, mobi_app: 'web' } });
                        const receipt = z.object({ data: z.object({ msg_key: apiId }) }).parse(result);
                        return { status: 'sent', receiptId: receipt.data.msg_key, accountUid: accountUid, ownerUid: ownerUid, requestId: input.requestId, wireHash: input.wireHash };
                    });
                }
                catch (error) {
                    return { status: invocation.dispatched ? 'unknown' : 'not-dispatched', code: invocation.failure ?? code(error) };
                }
            }
            catch (error) {
                return { status: 'not-dispatched', code: code(error) };
            }
        },
        close: () => { if (closed)
            return; closed = true; controller.abort(new Error('BILI_OWNER_TRANSPORT_CLOSED')); }, });
}
/** Complete production acquisition. A failed construction releases only the newly acquired consumer lease. */
export async function createBiliOwnerProductionPorts(raw, dependencies = {}) {
    const binding = loadBiliOwnerProductionBinding(raw), lease = await acquireBiliOwnerConsumerLease(binding);
    try {
        const transport = await createBiliOwnerProductionTransport(binding, lease, dependencies);
        return Object.freeze({ transport, lease });
    }
    catch (error) {
        await lease.release();
        throw error;
    }
}
