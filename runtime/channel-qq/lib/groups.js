import { performance } from 'node:perf_hooks';
import { z } from 'zod';
export const QqAccountIdSchema = z.string().regex(/^[1-9]\d{4,14}$/);
export const GroupSyncConfigSchema = z.strictObject({
    enabled: z.boolean().default(false),
    mode: z.enum(['allowlist', 'joined']).default('allowlist'),
    intervalMs: z.number().int().min(5000).max(3600000).default(30000),
    maxStaleMs: z.number().int().min(5000).max(7200000).default(120000),
}).superRefine((value, ctx) => {
    if (value.maxStaleMs < value.intervalMs || value.mode === 'joined' && !value.enabled) {
        ctx.addIssue({ code: 'custom', message: 'Group sync requires a valid freshness window and explicit joined-mode activation' });
    }
});
export const GroupListSchema = z.array(z.strictObject({ id: QqAccountIdSchema, name: z.string().max(200) })).max(2000)
    .refine(groups => new Set(groups.map(group => group.id)).size === groups.length, 'Duplicate group IDs');
export const GroupSnapshotSchema = z.strictObject({ account: QqAccountIdSchema, at: z.iso.datetime(), revision: z.number().int().positive(), groups: GroupListSchema });
export const GroupSyncStateSchema = z.enum(['disabled', 'unavailable', 'current', 'stale']);
/** A remembered membership snapshot is history; only a fresh response in this process grants access. */
export class GroupDirectory {
    options;
    clock;
    controller = new AbortController();
    timer = null;
    pending = null;
    running = false;
    snapshot;
    verifiedAt = null;
    error = null;
    constructor(options) {
        this.options = options;
        this.clock = options.clock ?? (() => performance.now());
        this.snapshot = options.store.groupSnapshot(options.account);
    }
    state() {
        if (!this.options.config.enabled)
            return 'disabled';
        if (this.verifiedAt === null)
            return 'unavailable';
        const age = this.clock() - this.verifiedAt;
        return age >= 0 && age < this.options.config.maxStaleMs ? 'current' : 'stale';
    }
    effective() {
        if (!this.options.config.enabled)
            return [...this.options.allowed];
        if (this.state() !== 'current')
            return [];
        return (this.snapshot?.groups ?? []).map(group => group.id).filter(id => this.options.config.mode === 'joined' || this.options.allowed.includes(id));
    }
    info(id) { const group = this.snapshot?.groups.find(group => group.id === id); return group ? { ...group } : null; }
    status() {
        return { enabled: this.options.config.enabled, mode: this.options.config.mode, state: this.state(), paused: !this.running,
            lastSuccessAt: this.snapshot?.at ?? null, verifiedThisProcess: this.verifiedAt !== null, revision: this.snapshot?.revision ?? null,
            joinedIds: this.snapshot?.groups.map(group => group.id) ?? [], effectiveIds: this.effective(), error: this.error };
    }
    async start() {
        if (!this.options.config.enabled || this.controller.signal.aborted)
            return;
        if (this.running) {
            await this.refresh();
            return;
        }
        this.running = true;
        await this.refresh();
        this.schedule();
    }
    refresh() {
        if (!this.running || this.controller.signal.aborted)
            return Promise.resolve();
        if (this.pending)
            return this.pending;
        this.pending = this.performRefresh().finally(() => { this.pending = null; });
        return this.pending;
    }
    async performRefresh() {
        let persisting = false;
        try {
            const groups = GroupListSchema.parse(await this.options.fetchGroups(this.controller.signal));
            this.controller.signal.throwIfAborted();
            persisting = true;
            const snapshot = this.options.store.saveGroups(this.options.account, groups, new Date().toISOString());
            this.snapshot = snapshot;
            this.verifiedAt = this.clock();
            this.error = null;
        }
        catch (error) {
            if (this.controller.signal.aborted)
                return;
            if (error instanceof Error && error.message === 'ACCOUNT_MISMATCH') {
                this.verifiedAt = null;
                this.error = 'ACCOUNT_MISMATCH';
                this.options.rejectIdentity();
            }
            else {
                if (persisting)
                    this.verifiedAt = null; // A newly observed removal must not leave an older grant usable.
                this.error = persisting ? 'GROUP_SNAPSHOT_FAILED' : 'GROUP_SYNC_FAILED';
            }
        }
    }
    schedule() {
        if (!this.running || this.controller.signal.aborted || this.timer)
            return;
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.refresh().finally(() => this.schedule());
        }, this.options.config.intervalMs);
        this.timer.unref();
    }
    pause() {
        this.running = false;
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = null;
        this.controller.abort();
    }
    async whenIdle() { await this.pending; }
}
