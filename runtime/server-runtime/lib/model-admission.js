import { createHash, randomUUID } from 'node:crypto';
import { normalizeExecutorUsage } from '#dafeiyu/server-executor/protocol';
import { SharedModelBudget } from './shared-budget.js';
import { RuntimeIdentitySchema, runtimeCode } from './types.js';
const installed = new WeakSet();
const hash = (text) => createHash('sha256').update(text).digest('hex');
/** Await before Core activation: a provider's oversized default must fail startup, not the first user Run. */
export async function validateParentModelAdmission(ctx, budget, signal) {
    signal?.throwIfAborted();
    budget.assertReady();
    const route = budget.route;
    const model = await ctx.llm.resolveModelInfo(route.provider, route.model, signal), output = model.defaultMaxTokens ?? model.context?.contextWindow;
    if (model.context?.contextWindow !== route.contextWindow || output === undefined || !Number.isSafeInteger(output) || output < 1 || output > route.maxOutputTokens)
        throw new Error('RUNTIME_PROVIDER_DEFAULT_MISMATCH');
    if (route.reasoningEffort === null ? model.reasoning?.defaultEffort !== undefined : !model.reasoning?.efforts.some(effort => effort.id === route.reasoningEffort))
        throw new Error('RUNTIME_PROVIDER_REASONING_MISMATCH');
    signal?.throwIfAborted();
    budget.assertReady();
}
/** The official frozen request and prepared adapter binding are preserved; next() is invoked once. */
export function installParentModelAdmission(ctx, budget, options) {
    const profileId = RuntimeIdentitySchema.parse(options.profileId);
    if (!Number.isSafeInteger(options.maximumCallMs) || options.maximumCallMs < 1 || options.maximumCallMs > 3600000)
        throw new Error('RUNTIME_CALL_TIMEOUT_INVALID');
    // Cordis may return a new traced proxy for each ctx.llm read. The public application root
    // is stable across those proxies and child contexts; this listener is application-global.
    const application = ctx.root;
    if (installed.has(application))
        throw new Error('RUNTIME_MODEL_ADMISSION_ALREADY_INSTALLED');
    budget.assertReady();
    options.guard?.();
    installed.add(application);
    const removeCancellation = budget.onInterrupt(options.cancelActive);
    const remove = ctx.on('llm/stream', async function* (request, next) {
        request.signal?.throwIfAborted();
        options.guard?.();
        if (!request.signal)
            throw new Error('RUNTIME_MODEL_SIGNAL_REQUIRED');
        const route = budget.route;
        if (request.provider !== route.provider || request.model !== route.model)
            throw new Error('RUNTIME_ROUTE_CHANGED');
        const model = await ctx.llm.resolveModelInfo(request.provider, request.model, request.signal);
        const output = request.maxTokens ?? model.defaultMaxTokens ?? route.contextWindow, effort = request.reasoningEffort ?? model.reasoning?.defaultEffort ?? null;
        if (model.context?.contextWindow !== route.contextWindow || effort !== route.reasoningEffort || !Number.isSafeInteger(output) || output < 1 || output > route.maxOutputTokens)
            throw new Error('RUNTIME_ROUTE_CHANGED');
        const body = JSON.stringify({ provider: request.provider, model: request.model, system: request.system ?? null, messages: request.messages, tools: request.tools ?? [], maxTokens: output, purpose: request.purpose ?? null, reasoningEffort: effort, temperature: request.temperature ?? null, stop: request.stop ?? null });
        const bytes = Buffer.byteLength(body);
        if (bytes > route.maxRequestBytes)
            throw new Error('RUNTIME_REQUEST_TOO_LARGE');
        const callId = randomUUID(), started = Date.now(), owner = { kind: 'host', profileId };
        const permit = await budget.reserve({ authorizationId: budget.authorizationId, owner, deadline: started + options.maximumCallMs, callId, provider: request.provider, model: request.model,
            reasoningEffort: effort, requestHash: hash(body), sessionHash: hash(String(request.sessionId ?? '')), inputBound: route.contextWindow, outputBound: output, requestBytes: bytes, purpose: request.purpose ?? 'task' }, request.signal);
        let usage = null, finish = 'interrupted', error = null, complete = false, invalid = false;
        let iterator, drained = false;
        try {
            request.signal.throwIfAborted();
            options.guard?.();
            iterator = budget.dispatchStep(callId, () => next()[Symbol.asyncIterator]());
            while (true) {
                const item = await budget.dispatchStep(callId, () => iterator.next());
                if (item.done) {
                    drained = true;
                    break;
                }
                const chunk = item.value;
                if (chunk.type === 'usage') {
                    try {
                        usage = normalizeExecutorUsage(chunk.usage);
                    }
                    catch {
                        usage = null;
                        invalid = true;
                        error = 'RUNTIME_USAGE_INVALID';
                    }
                }
                if (chunk.type === 'finish') {
                    complete = true;
                    finish = chunk.reason.kind;
                    if (finish === 'error' || finish === 'aborted')
                        error = 'RUNTIME_MODEL_FAILED';
                }
                yield chunk;
            }
        }
        catch (caught) {
            error ??= runtimeCode(caught, 'RUNTIME_STREAM_FAILED');
            throw new Error(error);
        }
        finally {
            try {
                if (!drained)
                    await iterator?.return?.();
            }
            finally {
                if (!complete || invalid || finish === 'error' || finish === 'aborted')
                    usage = null;
                await budget.settle({ authorizationId: budget.authorizationId, owner, callId, reservationId: permit.reservationId, usage, finish, durationMs: Math.max(0, Date.now() - started), error });
            }
        }
    }, { global: true });
    let disposed = false;
    const dispose = () => { if (disposed)
        return; disposed = true; budget.quiesce('RUNTIME_HOST_DISPOSED'); remove(); removeCancellation(); installed.delete(application); };
    ctx.effect(() => dispose, 'dafeiyu.server-runtime.model-admission');
    return dispose;
}
