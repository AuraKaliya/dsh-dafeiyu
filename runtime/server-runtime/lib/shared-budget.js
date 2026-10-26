import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ExecutorPermitSchema, ExecutorRouteSchema, ExecutorSettlementSchema, ExecutorCallSchema } from '#dafeiyu/server-executor/protocol';
import { ModelCallGate } from './call-gate.js';
import { ModelBudgetRequestSchema, ModelBudgetSettlementSchema, RuntimeIdentitySchema, runtimeCode } from './types.js';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Shared parent/child admission, never a second balance, authorization, lease or execution clock. */
export class SharedModelBudget {
    authorizationId;
    route;
    authority;
    gate = new ModelCallGate();
    dispatch = new AsyncLocalStorage();
    seen = new Set();
    reservations = new Set();
    calls = new Map();
    cancellations = new Set();
    interrupted;
    constructor(authority) {
        this.authority = authority;
        this.authorizationId = RuntimeIdentitySchema.parse(authority.authorizationId);
        this.route = Object.freeze(ExecutorRouteSchema.parse(authority.route));
        if (!['acceptance', 'operations', 'offline-test'].includes(authority.kind) || typeof authority.guard !== 'function' || typeof authority.remainingMs !== 'function' || typeof authority.reserve !== 'function' || typeof authority.settle !== 'function')
            throw new Error('RUNTIME_BUDGET_AUTHORITY_REQUIRED');
        authority.onStop?.(code => this.cancel(code));
    }
    assertReady() { if (this.gate.stopped)
        throw new Error(this.gate.stopped); this.authority.guard(); this.remainingMs(); }
    remainingMs() { const value = this.authority.remainingMs(); if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER)
        throw new Error('RUNTIME_AUTHORIZATION_EXPIRED'); return Math.floor(value); }
    onInterrupt(listener) { this.cancellations.add(listener); if (this.interrupted)
        listener(this.interrupted); return () => { this.cancellations.delete(listener); }; }
    quiesce(code = 'RUNTIME_ADMISSION_CLOSED') { this.gate.close(code); }
    cancel(code = 'RUNTIME_CALL_CANCELLED') {
        this.gate.close(code);
        if (this.interrupted)
            return;
        this.interrupted = code;
        for (const record of this.calls.values())
            if (record.state === 'reserved')
                record.abort.abort(new Error(code));
        for (const listener of this.cancellations) {
            try {
                listener(code);
            }
            catch { /* All remaining cancellation ports must still be notified. */ }
        }
    }
    get status() { return { pending: this.gate.pending, stopped: this.gate.stopped, interrupted: this.interrupted ?? null }; }
    snapshot() { return structuredClone([...this.calls.values()].map(({ request, permit, state, settlement }) => ({ request, permit, state, settlement }))); }
    whenIdle(timeoutMs = 10000) { return this.gate.whenIdle(timeoutMs); }
    async reserve(raw, signal) {
        const request = ModelBudgetRequestSchema.parse(raw);
        signal.throwIfAborted();
        const inherited = this.dispatch.getStore();
        if (inherited && this.calls.get(inherited)?.state === 'reserved')
            throw new Error('RUNTIME_NESTED_MODEL_CALL');
        if (request.authorizationId !== this.authorizationId)
            throw new Error('RUNTIME_AUTHORIZATION_MISMATCH');
        const route = this.route;
        if (request.provider !== route.provider || request.model !== route.model || request.reasoningEffort !== route.reasoningEffort || request.inputBound !== route.contextWindow || request.outputBound > route.maxOutputTokens || request.requestBytes > route.maxRequestBytes)
            throw new Error('RUNTIME_ROUTE_CHANGED');
        if (this.seen.has(request.callId))
            throw new Error('RUNTIME_CALL_REPLAY');
        this.seen.add(request.callId);
        const deadline = Math.min(request.deadline, Date.now() + this.remainingMs()), release = await this.gate.acquire(signal, deadline);
        let owned = false;
        try {
            signal.throwIfAborted();
            this.assertReady();
            const actualDeadline = Math.min(deadline, Date.now() + this.remainingMs());
            if (actualDeadline <= Date.now())
                throw new Error('RUNTIME_CALL_DEADLINE');
            const abort = new AbortController(), cancelled = () => { abort.abort(new Error('RUNTIME_CALL_CANCELLED')); this.cancel('RUNTIME_CALL_CANCELLED'); };
            const timer = setTimeout(() => { abort.abort(new Error('RUNTIME_CALL_DEADLINE')); this.cancel('RUNTIME_CALL_DEADLINE'); }, Math.max(1, Math.min(2147483647, actualDeadline - Date.now())));
            signal.addEventListener('abort', cancelled, { once: true });
            const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', cancelled); };
            const bounded = ModelBudgetRequestSchema.parse({ ...request, deadline: actualDeadline });
            Object.freeze(bounded.owner);
            Object.freeze(bounded);
            let permit;
            try {
                permit = ExecutorPermitSchema.parse(await this.authority.reserve(bounded, AbortSignal.any([signal, abort.signal])));
            }
            catch (error) {
                cleanup();
                this.cancel('RUNTIME_RESERVATION_UNCERTAIN');
                throw error;
            }
            if (this.reservations.has(permit.reservationId)) {
                cleanup();
                this.cancel('RUNTIME_RESERVATION_REUSED');
                throw new Error('RUNTIME_RESERVATION_REUSED');
            }
            this.reservations.add(permit.reservationId);
            Object.freeze(permit);
            const record = { request: bounded, permit, release, cleanup, abort, state: 'reserved', settlement: null, completed: null };
            this.calls.set(request.callId, record);
            owned = true;
            if (signal.aborted || abort.signal.aborted || this.gate.stopped || actualDeadline <= Date.now()) {
                await this.settle({ authorizationId: this.authorizationId, owner: request.owner, callId: request.callId, reservationId: permit.reservationId, usage: null, finish: 'interrupted', durationMs: 0, error: 'RUNTIME_CALL_CANCELLED' });
                throw new Error('RUNTIME_CALL_CANCELLED');
            }
            return { ...permit };
        }
        finally {
            if (!owned)
                release();
        }
    }
    /** Scope only the actual iterator step, so a later tool round may obtain its own permit. */
    dispatchStep(callId, operation) {
        const record = this.calls.get(callId);
        if (!record || record.state !== 'reserved')
            throw new Error('RUNTIME_CALL_NOT_RESERVED');
        record.abort.signal.throwIfAborted();
        return this.dispatch.run(callId, operation);
    }
    settle(raw) {
        const input = ModelBudgetSettlementSchema.parse(raw), record = this.calls.get(input.callId);
        if (!record || input.authorizationId !== this.authorizationId || input.reservationId !== record.permit.reservationId || digest(input.owner) !== digest(record.request.owner))
            return Promise.reject(new Error('RUNTIME_RESERVATION_MISMATCH'));
        // Equality is based on the caller's receipt, before cancellation normalization.
        const hash = digest(input);
        if (record.completed) {
            if (record.completed.hash !== hash)
                return Promise.reject(new Error('RUNTIME_SETTLEMENT_CONFLICT'));
            return record.completed.promise;
        }
        const promise = this.complete(record, input);
        record.completed = { hash, promise };
        return promise;
    }
    async complete(record, input) {
        const cancelled = record.abort.signal.aborted;
        // A terminal receipt ends the dispatch deadline. Slow accounting is still owed and is not another model call.
        record.cleanup();
        const settlement = ModelBudgetSettlementSchema.parse({ ...input, usage: cancelled || ['error', 'aborted', 'interrupted'].includes(input.finish) ? null : input.usage,
            ...(cancelled ? { finish: 'interrupted', error: 'RUNTIME_CALL_CANCELLED' } : {}) });
        Object.freeze(settlement.owner);
        if (settlement.usage)
            Object.freeze(settlement.usage);
        Object.freeze(settlement);
        record.settlement = settlement;
        try {
            // No admission guard, deadline check or caller abort signal may prevent this accounting operation.
            const result = z.strictObject({ unknown: z.boolean() }).parse(await this.authority.settle(settlement));
            const unknown = result.unknown || settlement.usage === null || settlement.usage.inputTokens > record.request.inputBound || settlement.usage.outputTokens > record.request.outputBound;
            record.state = unknown ? 'unknown' : 'settled';
            if (unknown)
                this.cancel('RUNTIME_USAGE_UNKNOWN');
            return { unknown };
        }
        catch (error) {
            record.state = 'unknown';
            this.cancel('RUNTIME_SETTLEMENT_UNCERTAIN');
            throw new Error(runtimeCode(error));
        }
        finally {
            record.cleanup();
            record.release();
        }
    }
    /** Called only by ServerExecutorService's job-bound, live-grant port; IPC is not an authorization source. */
    executorPort() {
        return {
            reserve: async (raw, signal) => {
                const { authorizationId, jobId, deadline, ...call } = raw;
                ExecutorCallSchema.parse(call);
                return this.reserve({ ...call, authorizationId, owner: { kind: 'executor', jobId }, deadline }, signal);
            },
            settle: async (raw, _signal) => {
                const { authorizationId, jobId, ...settlement } = raw;
                ExecutorSettlementSchema.parse(settlement);
                return this.settle({ ...settlement, authorizationId, owner: { kind: 'executor', jobId } });
            },
        };
    }
}
