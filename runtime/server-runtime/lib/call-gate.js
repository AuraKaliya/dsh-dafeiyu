/** One actual call at a time. A job/Run never owns this queue across tool execution. */
export class ModelCallGate {
    queue = [];
    idleWaiters = new Set();
    busy = false;
    closed;
    acquire(signal, deadline) {
        signal.throwIfAborted();
        if (this.closed)
            return Promise.reject(new Error(this.closed));
        if (deadline <= Date.now())
            return Promise.reject(new Error('RUNTIME_CALL_DEADLINE'));
        return new Promise((resolve, reject) => {
            let timer;
            const cancel = (code) => { const index = this.queue.indexOf(waiter); if (index < 0)
                return; this.queue.splice(index, 1); waiter.cleanup(); reject(new Error(code)); this.pump(); };
            const aborted = () => cancel('RUNTIME_CALL_CANCELLED');
            const waiter = { resolve, reject, signal, deadline, cleanup: () => { if (timer)
                    clearTimeout(timer); signal.removeEventListener('abort', aborted); } };
            timer = setTimeout(() => cancel('RUNTIME_CALL_DEADLINE'), Math.min(2147483647, Math.max(1, deadline - Date.now())));
            signal.addEventListener('abort', aborted, { once: true });
            this.queue.push(waiter);
            if (signal.aborted)
                aborted();
            else
                this.pump();
        });
    }
    pump() {
        if (this.busy)
            return;
        while (this.queue.length) {
            const item = this.queue.shift();
            item.cleanup();
            if (this.closed || item.signal.aborted || item.deadline <= Date.now()) {
                item.reject(new Error(this.closed ?? (item.signal.aborted ? 'RUNTIME_CALL_CANCELLED' : 'RUNTIME_CALL_DEADLINE')));
                continue;
            }
            this.busy = true;
            let released = false;
            item.resolve(() => { if (released)
                return; released = true; this.busy = false; this.pump(); });
            return;
        }
        for (const ready of this.idleWaiters)
            ready();
        this.idleWaiters.clear();
    }
    close(code = 'RUNTIME_ADMISSION_CLOSED') {
        this.closed ??= code;
        for (const item of this.queue.splice(0)) {
            item.cleanup();
            item.reject(new Error(this.closed));
        }
        this.pump();
    }
    get idle() { return !this.busy && this.queue.length === 0; }
    get pending() { return this.queue.length + (this.busy ? 1 : 0); }
    get stopped() { return this.closed ?? null; }
    async whenIdle(timeoutMs) {
        if (this.idle)
            return;
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
            throw new Error('RUNTIME_DRAIN_TIMEOUT_INVALID');
        await new Promise((resolve, reject) => {
            const done = () => { clearTimeout(timer); this.idleWaiters.delete(done); resolve(); };
            const timer = setTimeout(() => { this.idleWaiters.delete(done); reject(new Error('RUNTIME_ACCOUNTING_NOT_DRAINED')); }, timeoutMs);
            this.idleWaiters.add(done);
            if (this.idle)
                done();
        });
    }
}
