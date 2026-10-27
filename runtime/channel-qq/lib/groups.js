import { performance } from 'node:perf_hooks';
import { z } from 'zod';
export const QqAccountIdSchema = z.string().regex(/^[1-9]\d{4,14}$/);
export const GroupSyncConfigSchema = z.strictObject({
    enabled: z.boolean().default(true),
    mode: z.enum(['allowlist', 'joined']).default('allowlist'),
    intervalMs: z.number().int().min(5000).max(3600000).default(30000),
    maxStaleMs: z.number().int().min(5000).max(7200000).default(120000),
}).superRefine((value, ctx) => {
    if (value.maxStaleMs < value.intervalMs || value.mode === 'joined' && !value.enabled) {
        ctx.addIssue({ code: 'custom', message: 'Group sync requires a valid freshness window and explicit joined-mode activation' });
    }
});
const GroupInfoSchema = z.strictObject({ id: QqAccountIdSchema, name: z.string().max(200),
    msgMask: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.null()]).default(null) });
export const GroupListSchema = z.array(GroupInfoSchema).max(2000)
    .refine(groups => new Set(groups.map(group => group.id)).size === groups.length, 'Duplicate group IDs');
export const groupReceivesMessages = (group) => group.msgMask === 1 || group.msgMask === 4;
const SnapshotGroupsSchema = z.array(GroupInfoSchema.extend({ acceptedAfter: z.number().int().nonnegative().default(0), generation: z.number().int().nonnegative().default(0) })).max(2000)
    .refine(groups => new Set(groups.map(group => group.id)).size === groups.length, 'Duplicate group IDs');
export const GroupSnapshotSchema = z.strictObject({ account: QqAccountIdSchema, at: z.iso.datetime(), revision: z.number().int().positive(), groups: SnapshotGroupsSchema });
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
    signals = new Map();
    ingressAfter = new Map();
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
        if (!this.options.config.enabled || this.state() !== 'current') {
            this.revokeAll();
            return [];
        }
        return (this.snapshot?.groups ?? []).filter(group => groupReceivesMessages(group)
            && (this.options.config.mode === 'joined' || this.options.allowed.includes(group.id))).map(group => group.id);
    }
    info(id) { const group = this.snapshot?.groups.find(group => group.id === id); return group ? { id: group.id, name: group.name, msgMask: group.msgMask } : null; }
    accepts(id, occurredAt) {
        return Number.isFinite(occurredAt) && this.effective().includes(id) && occurredAt >= (this.ingressAfter.get(id) ?? Infinity);
    }
    generation(id) {
        const group = this.snapshot?.groups.find(group => group.id === id);
        if (!group || !this.effective().includes(id))
            throw new Error('GROUP_ACCESS_REVOKED');
        return group.generation;
    }
    /** Existing accepted work uses the durable activation boundary, not the reconnect ingress cutoff. */
    processingSignal(id, occurredAt) {
        const group = this.snapshot?.groups.find(group => group.id === id), controller = this.signals.get(id);
        if (!Number.isFinite(occurredAt) || !this.effective().includes(id) || !group || occurredAt < group.acceptedAfter || !controller || controller.signal.aborted)
            throw new Error('GROUP_ACCESS_REVOKED');
        return controller.signal;
    }
    revokeAll() { for (const controller of this.signals.values())
        controller.abort(); this.signals.clear(); }
    status() {
        return { enabled: this.options.config.enabled, mode: this.options.config.mode, state: this.state(), paused: !this.running,
            lastSuccessAt: this.snapshot?.at ?? null, verifiedThisProcess: this.verifiedAt !== null, revision: this.snapshot?.revision ?? null,
            joinedIds: this.snapshot?.groups.map(group => group.id) ?? [], effectiveIds: this.effective(),
            assistantIds: this.snapshot?.groups.filter(group => group.msgMask === 2).map(group => group.id) ?? [],
            unknownIds: this.snapshot?.groups.filter(group => group.msgMask === null).map(group => group.id) ?? [], error: this.error };
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
            const before = new Set(this.effective());
            const groups = GroupListSchema.parse(await this.options.fetchGroups(this.controller.signal));
            this.controller.signal.throwIfAborted();
            persisting = true;
            const now = this.options.wallClock?.() ?? Date.now();
            const snapshot = this.options.store.saveGroups(this.options.account, groups, new Date(now).toISOString());
            this.snapshot = snapshot;
            this.verifiedAt = this.clock();
            this.error = groups.some(group => group.msgMask === null) ? 'GROUP_SETTINGS_UNKNOWN' : null;
            const effective = new Set(this.effective());
            for (const [id, controller] of this.signals)
                if (!effective.has(id)) {
                    controller.abort();
                    this.signals.delete(id);
                    this.ingressAfter.delete(id);
                }
            for (const id of effective) {
                if (!this.signals.has(id))
                    this.signals.set(id, new AbortController());
                if (!before.has(id))
                    this.ingressAfter.set(id, Math.ceil(now / 1000) * 1000);
            }
        }
        catch (error) {
            if (this.controller.signal.aborted)
                return;
            if (error instanceof Error && error.message === 'ACCOUNT_MISMATCH') {
                this.verifiedAt = null;
                this.revokeAll();
                this.error = 'ACCOUNT_MISMATCH';
                this.options.rejectIdentity();
            }
            else {
                if (persisting)
                    this.verifiedAt = null; // A newly observed removal must not leave an older grant usable.
                this.error = persisting ? 'GROUP_SNAPSHOT_FAILED' : error instanceof Error && ['GROUP_SETTINGS_UNAVAILABLE', 'GROUP_RESPONSE_INVALID'].includes(error.message) ? error.message : 'GROUP_SYNC_FAILED';
                this.effective();
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
        this.revokeAll();
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = null;
        this.controller.abort();
    }
    async whenIdle() { await this.pending; }
}
