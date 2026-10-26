/** Owns only the borrowed runtime's teardown order; it never closes an authorization/ledger. */
export class RuntimeResourceLifetime {
    budget;
    closeProof;
    isHostDisposed;
    timeoutMs;
    closing;
    closed = false;
    constructor(options) {
        this.budget = options.budget;
        this.closeProof = options.closeProof;
        this.isHostDisposed = options.isHostDisposed;
        this.timeoutMs = options.timeoutMs;
        if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 3600000)
            throw new Error('RUNTIME_DRAIN_TIMEOUT_INVALID');
    }
    close(host) {
        if (this.closed)
            return Promise.resolve();
        if (this.closing)
            return this.closing;
        this.closing = this.drain(host).then(() => { this.closed = true; }, error => { this.closing = undefined; throw error; });
        return this.closing;
    }
    async drain(host) {
        this.budget.quiesce();
        if (host) {
            let timer;
            try {
                await Promise.race([host.close('budget-runtime-close'), new Promise((_, reject) => { timer = setTimeout(() => { this.budget.cancel('RUNTIME_HOST_DRAIN_TIMEOUT'); reject(new Error('RUNTIME_HOST_NOT_DRAINED')); }, this.timeoutMs); })]);
            }
            finally {
                if (timer)
                    clearTimeout(timer);
            }
        }
        if (!this.isHostDisposed()) {
            this.budget.cancel('RUNTIME_HOST_NOT_DISPOSED');
            throw new Error('RUNTIME_HOST_NOT_DISPOSED');
        }
        await this.budget.whenIdle(this.timeoutMs);
        // On a failed/unconfirmed drain this point is deliberately never reached.
        await this.closeProof();
    }
}
