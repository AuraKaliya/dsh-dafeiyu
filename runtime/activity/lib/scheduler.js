import { z } from 'zod';
import { ContextItemSchema } from '#dafeiyu/contracts';
import { ActivityStore, activityHash } from './store.js';
export class ActivityScheduler {
    ctx;
    store;
    configHash;
    ready;
    now;
    monotonic;
    explore;
    maintain;
    unbindWake;
    unbindEvents;
    memory;
    disconnectMemory;
    memoryCursor = 0;
    timer;
    pending;
    started = false;
    closed = false;
    failure = null;
    runClocks = new Map();
    constructor(ctx, store, configHash, ready, now, monotonic = () => performance.now()) {
        this.ctx = ctx;
        this.store = store;
        this.configHash = configHash;
        this.ready = ready;
        this.now = now;
        this.monotonic = monotonic;
        this.explore = ctx.dafeiyu.executionProducer('activity', { motivation: { kind: 'self-exploration', basis: ['scheduled-autonomous-exploration'] } });
        this.maintain = ctx.dafeiyu.executionProducer('activity', { motivation: { kind: 'maintenance', basis: ['durable-memory-maintenance-request'] } });
        this.unbindWake = ctx.dafeiyu.bindWakeAuthority({ producerId: 'activity', validate: (origin, task) => this.authorized(origin, task), sourceAnchor: origin => this.store.snapshot(origin.scheduleId, origin.scheduleVersion).anchor,
            work: (origin, task) => {
                if (!this.authorized(origin, task))
                    return null;
                const plan = this.store.snapshot(origin.scheduleId, origin.scheduleVersion);
                return plan.purpose === 'maintenance' && plan.maintenanceId ? { kind: 'memory-maintenance', requestId: plan.maintenanceId, goal: plan.goal } : null;
            } });
        try {
            this.unbindEvents = ctx.dafeiyu.bindExecutionLifecycle('activity', event => this.receive(event));
        }
        catch (error) {
            this.unbindWake();
            throw error;
        }
    }
    bindMemory(port) { if (this.memory)
        throw new Error('DUPLICATE_PROVIDER'); this.disconnectMemory = port.connect(); this.memory = port; }
    dependenciesReady() { return !this.store.config.maintenance || !!this.memory?.ready(); }
    hasDependencies() { return !this.store.config.maintenance || !!this.memory; }
    port(plan) { return plan.body.purpose === 'maintenance' ? this.maintain : this.explore; }
    source(plan) {
        if (plan.body.configHash !== this.configHash)
            return { state: 'stale', code: 'ACTIVITY_CONFIG_CHANGED' };
        if (!plan.body.anchor)
            return { state: 'stale', code: 'ACTIVITY_SOURCE_REQUIRED' };
        return this.ctx.dafeiyu.activityAnchorStatus(plan.body.anchor);
    }
    authorized(origin, task) {
        try {
            if (this.closed || !this.ready() || !this.dependenciesReady() || origin.producerId !== 'activity')
                return false;
            const occurrence = this.store.occurrence(origin.occurrenceId), plan = this.store.get(origin.scheduleId), original = this.store.snapshot(origin.scheduleId, origin.scheduleVersion), body = occurrence.body;
            if (body.scheduleId !== origin.scheduleId || body.scheduleVersion !== origin.scheduleVersion || body.dueAt !== new Date(origin.dueAt).toISOString() || body.taskId !== task.id || body.taskEpoch !== task.epoch || task.status !== 'active')
                return false;
            if (['blocked', 'cancelled'].includes(occurrence.state) || ['blocked', 'cancelled'].includes(plan.status))
                return false;
            // A running activity may adjust its next schedule and still settle its current receipt.
            if (occurrence.startedAt === null && (plan.body.version !== origin.scheduleVersion || plan.body.state !== 'active'))
                return false;
            if (original.configHash !== this.configHash || !original.anchor || this.ctx.dafeiyu.activityAnchorStatus(original.anchor).state !== 'valid')
                return false;
            if (original.purpose === 'maintenance') {
                const item = original.maintenanceId ? this.memory?.inspect(original.maintenanceId) : null;
                if (!item || item.scope.kind !== 'task' || item.scope.taskId !== task.id || item.taskEpoch !== task.epoch)
                    return false;
                // Completion during this Run is legitimate; a new wake cannot reuse it.
                if (occurrence.startedAt === null && !['waiting-scheduler', 'ready'].includes(item.state))
                    return false;
            }
            return true;
        }
        catch {
            return false;
        }
    }
    occurrence(view) {
        if (view.origin.kind === 'wake' && view.origin.producerId === 'activity')
            return this.store.occurrence(view.origin.occurrenceId);
        return this.store.byRun(view.runId);
    }
    context(view) {
        const occurrence = this.occurrence(view);
        if (!occurrence || view.scope.kind !== 'task' || occurrence.body.taskId !== view.scope.taskId)
            return [];
        return this.contextFor(occurrence);
    }
    contextFor(occurrence) {
        const plan = this.store.snapshot(occurrence.body.scheduleId, occurrence.body.scheduleVersion);
        const text = JSON.stringify({ kind: 'activity-occurrence', purpose: plan.purpose, scheduleId: plan.id, scheduleVersion: plan.version, occurrenceId: occurrence.body.id,
            dueAt: occurrence.body.dueAt, reason: occurrence.body.reason, eventId: occurrence.body.eventId, goal: plan.goal, maintenanceId: plan.maintenanceId,
            instructionAuthority: false, note: plan.purpose === 'maintenance' ? '本轮整理固定记忆请求，不重做原任务；先核对请求再处理。' : '可以按当前判断探索、改期或休息；计划不授予额外平台权限。' });
        return [ContextItemSchema.parse({ id: `activity:${occurrence.body.id}`, version: '1', text, expiresAt: '9999-12-31T23:59:59.999Z', sources: [{ ref: `dafeiyu:activity:${occurrence.body.id}`, version: '1', hash: activityHash(text) }] })];
    }
    contextCurrent(view, item) {
        try {
            if (view.scope.kind !== 'task' || view.scope.agentId !== this.store.identity.agentId || !item.id.startsWith('activity:'))
                return false;
            const occurrence = this.store.occurrence(item.id.slice('activity:'.length));
            if (occurrence.body.taskId !== view.scope.taskId)
                return false;
            const plan = this.store.snapshot(occurrence.body.scheduleId, occurrence.body.scheduleVersion);
            // History keeps the immutable occurrence, while live wake authorization separately checks cancellation.
            return !!plan.anchor && this.ctx.dafeiyu.activityAnchorStatus(plan.anchor).state === 'valid' && this.contextFor(occurrence).some(value => activityHash(value) === activityHash(item));
        }
        catch {
            return false;
        }
    }
    receive(event) {
        if (this.closed)
            return;
        let occurrence = null;
        if (event.origin.kind === 'wake' && event.origin.producerId === 'activity')
            occurrence = this.store.occurrence(event.origin.occurrenceId);
        else if (event.origin.kind === 'continuation') {
            occurrence = this.store.byRun(event.runId) ?? this.store.byRun(event.origin.parentRunId);
            if (occurrence && occurrence.runId !== event.runId && event.type === 'run.running')
                this.store.attachResume(occurrence.body.id, event.origin.parentRunId, event.runId, Date.parse(event.at));
        }
        if (occurrence && event.type !== 'evidence.changed') {
            if (event.type === 'run.running') {
                if (!this.runClocks.has(event.runId))
                    this.runClocks.set(event.runId, this.monotonic());
            }
            else
                this.runClocks.delete(event.runId);
            this.store.runEvent({ id: event.id, occurrenceId: occurrence.body.id, runId: event.runId, state: event.type.slice(4), at: event.at,
                unknownEffects: event.operations.some(op => op.effects === 'unknown' || op.status === 'unknown') || event.omittedOperations > 0 });
            const plan = this.store.snapshot(occurrence.body.scheduleId, occurrence.body.scheduleVersion);
            if (event.type === 'run.completed' && plan.purpose === 'maintenance' && plan.maintenanceId && this.memory?.inspect(plan.maintenanceId)?.state !== 'completed')
                this.store.block(plan.id, 'MEMORY_MAINTENANCE_INCOMPLETE', Date.parse(event.at));
            return;
        }
        if (event.type !== 'run.running' && event.type !== 'evidence.changed' && event.scope.kind === 'task')
            this.store.event({ id: event.id, type: 'task-settled', key: `task:${event.scope.taskId}`,
                watermark: `${event.runId}:${event.type}`, occurredAt: event.at, origin: event.motivation.kind === 'maintenance' ? 'maintenance' : event.origin.kind === 'wake' && event.origin.producerId === 'activity' ? 'activity' : 'primary', causedBy: event.runId });
    }
    notify(event) { return this.store.event(event); }
    importMemory(now) {
        if (!this.store.config.maintenance || !this.memory?.ready())
            return;
        const page = this.memory.pending(this.memoryCursor, 32);
        this.memoryCursor = page.next ?? 0;
        for (const original of page.items) {
            const item = this.memory.coalesce(original.id);
            if (!item || !['waiting-scheduler', 'ready'].includes(item.state) || item.scope.kind !== 'task')
                continue;
            if (this.store.maintenancePlan(item.id))
                continue;
            const anchor = this.ctx.dafeiyu.createMaintenanceAnchor(item.runId, item.scope.taskId, item.taskEpoch), source = this.ctx.dafeiyu.activityAnchorStatus(anchor);
            if (source.state === 'pending')
                continue;
            if (source.state === 'valid' && Date.parse(item.expiresAt) > now && item.retainedSources === 0 && item.omittedSources === 0 && this.memory.settleMetadata(item.id))
                continue;
            const plan = this.store.create({ schemaVersion: 1, requestId: `maintenance:${item.id}`, agentId: this.store.identity.agentId, owner: item.scope, purpose: 'maintenance', goal: `按当前授权整理记忆请求 ${item.id}，保留反证和未知，不重演原任务。`, basis: [], anchor, maintenanceId: item.id,
                policyId: this.store.config.maintenancePolicy, configHash: this.configHash, trigger: { kind: 'once', at: new Date(now + this.store.config.minIntervalMs).toISOString() }, missed: 'coalesce', timeZone: this.store.config.timeZone, quiet: this.store.config.quiet, state: 'active' }, now);
            this.store.bindTask(plan.id, 1, item.scope.taskId, item.taskEpoch);
            if (source.state === 'stale' || Date.parse(item.expiresAt) <= now)
                this.store.block(plan.id, source.code ?? 'MAINTENANCE_EXPIRED', now);
        }
    }
    ensureTask(plan) {
        let binding = this.store.task(plan.body.id);
        if (binding)
            return binding;
        if (plan.body.purpose === 'maintenance')
            throw new Error('ACTIVITY_TASK_REQUIRED');
        const port = this.port(plan);
        const task = port.createTask({ requestId: `activity:${plan.body.id}:${plan.body.taskGeneration}`, title: Array.from(plan.body.goal).slice(0, 80).join(''), goal: plan.body.goal }), state = port.taskState(task);
        this.store.bindTask(plan.body.id, plan.body.taskGeneration, task.id, state.epoch);
        binding = this.store.task(plan.body.id);
        if (!binding)
            throw new Error('ACTIVITY_TASK_REQUIRED');
        return binding;
    }
    pressure() { const value = this.ctx.dafeiyu.activityPressure(); return value.foregroundWaiting + value.foregroundRuns > 0; }
    reconcile(occurrence, status) {
        if (!['completed', 'waiting', 'failed', 'cancelled', 'interrupted'].includes(status.state) || !occurrence.runId)
            return;
        const events = this.ctx.dafeiyu.journal.executionRunStates(this.store.identity.agentId, occurrence.body.taskId, occurrence.runId), terminal = events.findLast(event => event.type === `run.${status.state}`);
        if (!terminal)
            return;
        const start = events.find(event => event.type === 'run.running');
        if (start)
            this.store.runEvent({ id: start.id, occurrenceId: occurrence.body.id, runId: occurrence.runId, state: 'running', at: start.at, unknownEffects: false });
        this.store.runEvent({ id: terminal.id, occurrenceId: occurrence.body.id, runId: occurrence.runId, state: status.state, at: terminal.at,
            unknownEffects: status.operations.length > 256 || status.operations.some(op => op.effects === 'unknown' || op.state === 'unknown' || op.status === 'unknown') });
    }
    retireOwnedTask(plan) {
        if (plan.body.purpose !== 'exploration')
            return;
        const binding = this.store.task(plan.body.id, plan.body.taskGeneration);
        if (!binding)
            return;
        const port = this.port(plan), task = port.openTask(binding.taskId), state = port.taskState(task);
        if (state.status !== 'active')
            return;
        port.updateTask(task, { requestId: activityHash(['retire-activity-source', plan.body.id, state.id, state.version]), expectedVersion: state.version, status: 'paused' });
    }
    controlActive(now) {
        for (const occurrence of this.store.active()) {
            if (!occurrence.runId)
                continue;
            const current = this.store.get(occurrence.body.scheduleId), original = { ...current, body: this.store.snapshot(occurrence.body.scheduleId, occurrence.body.scheduleVersion) }, port = this.port(original), ref = port.restoreRun(occurrence.runId), status = port.status(ref);
            if (['completed', 'failed', 'cancelled', 'interrupted'].includes(status.state)) {
                this.reconcile(occurrence, status);
                continue;
            }
            if (status.state === 'waiting' && occurrence.state !== 'waiting') {
                this.reconcile(occurrence, status);
                continue;
            }
            const source = this.source(original);
            if (source.state === 'stale') {
                this.store.block(current.body.id, source.code ?? 'SOURCE_STALE', now);
                this.retireOwnedTask(original);
                current.status = 'blocked';
            }
            if (current.body.state === 'cancelled' || current.status === 'blocked') {
                if (['accepted', 'queued', 'running'].includes(status.state))
                    port.cancel(ref, { requestId: activityHash(['cancel', occurrence.body.id, occurrence.runId]), expectedVersion: status.version, reason: '活动计划取消或失效' });
                continue;
            }
            const monotonicStart = this.runClocks.get(occurrence.runId), elapsed = monotonicStart === undefined ? occurrence.startedAt === null ? 0 : Math.max(0, now - occurrence.startedAt) : Math.max(0, this.monotonic() - monotonicStart), used = this.store.occurrenceUsed(occurrence.body.id);
            const reason = used + elapsed >= this.store.config.maxActiveMs ? 'time-budget' : this.store.used(now) + elapsed >= this.store.config.dailyActiveMs ? 'daily-budget' : this.pressure() ? 'foreground' : null;
            if (status.state === 'running' && reason) {
                const pause = this.store.pauseIntent(occurrence.body.id, occurrence.runId, reason, status.version, now);
                port.pause(ref, { requestId: pause.requestId, expectedVersion: pause.expectedVersion, reason: `活动让出：${reason}` });
                continue;
            }
            if (status.state !== 'waiting')
                continue;
            if (status.error === 'TASK_CAPABILITY_CHANGE_PENDING')
                continue; // The installer/loading handoff owns this continuation; keep its wake authority live.
            const pause = this.store.pausedBy(occurrence.body.id, occurrence.runId);
            if (!pause) {
                this.store.block(current.body.id, 'ACTIVITY_WAITING_DISCUSSION', now);
                continue;
            }
            if (pause.reason === 'time-budget' || used >= this.store.config.maxActiveMs) {
                this.store.block(current.body.id, 'ACTIVITY_TIME_BUDGET', now);
                continue;
            }
            if (this.pressure() || this.store.used(now) >= this.store.config.dailyActiveMs || now < Math.max(pause.at, this.store.lastWake()) + this.store.config.minIntervalMs)
                continue;
            if (current.body.version !== occurrence.body.scheduleVersion || current.body.state !== 'active' || this.source(original).state !== 'valid') {
                this.store.block(current.body.id, 'ACTIVITY_RESUME_STALE', now);
                continue;
            }
            const checkpoint = status.checkpoints.at(-1);
            if (!checkpoint) {
                this.store.block(current.body.id, 'ACTIVITY_CHECKPOINT_MISSING', now);
                continue;
            }
            const task = port.openTask(occurrence.body.taskId), state = port.taskState(task), intent = this.store.resumeIntent(occurrence.body.id, occurrence.runId, checkpoint, state.version, now);
            const resumed = port.resume(task, { requestId: intent.requestId, taskId: task.id, expectedVersion: intent.taskVersion, policyId: original.body.policyId, parentRunId: intent.parentRunId, checkpointId: intent.checkpointId });
            this.store.attachResume(occurrence.body.id, intent.parentRunId, resumed.run.id, now);
        }
    }
    dispatch(now) {
        for (const occurrence of this.store.outbox()) {
            const current = this.store.get(occurrence.body.scheduleId), original = { ...current, body: this.store.snapshot(occurrence.body.scheduleId, occurrence.body.scheduleVersion) }, port = this.port(original);
            if (current.body.version !== occurrence.body.scheduleVersion || current.body.state !== 'active' || current.status === 'blocked') {
                this.store.reject(occurrence.body.id, 'SCHEDULE_CHANGED', now);
                continue;
            }
            const source = this.source(original);
            if (source.state === 'pending')
                continue;
            if (source.state === 'stale') {
                this.store.reject(occurrence.body.id, source.code ?? 'SOURCE_STALE', now);
                this.store.block(current.body.id, source.code ?? 'SOURCE_STALE', now);
                this.retireOwnedTask(original);
                continue;
            }
            const task = port.openTask(occurrence.body.taskId), state = port.taskState(task);
            let accepted;
            try {
                accepted = port.acceptWake({ requestId: occurrence.body.id, taskId: task.id, expectedVersion: state.version, policyId: original.body.policyId,
                    origin: { kind: 'wake', producerId: 'activity', scheduleId: occurrence.body.scheduleId, scheduleVersion: occurrence.body.scheduleVersion, occurrenceId: occurrence.body.id, dueAt: occurrence.body.dueAt } }, task);
            }
            catch (error) {
                const code = safeCode(error);
                if (code === 'CAPACITY_EXCEEDED')
                    continue;
                if (!['SCOPE_DENIED', 'WAKE_NOT_AUTHORIZED', 'TASK_NOT_ACTIVE', 'VERSION_CONFLICT', 'SOURCE_STALE'].includes(code))
                    throw new Error('ACTIVITY_ACCEPTANCE_UNCERTAIN');
                this.store.reject(occurrence.body.id, code, now);
                this.store.block(current.body.id, code, now);
                continue;
            }
            // An acknowledgement failure cannot be classified as a rejected or unexecuted wake.
            this.store.acknowledge(occurrence.body.id, accepted.run.id, now);
            this.reconcile(this.store.occurrence(occurrence.body.id), port.status(accepted.run));
        }
    }
    start(automatic = true) {
        if (this.started || this.closed)
            return;
        if (!this.hasDependencies())
            throw new Error('ACTIVITY_MEMORY_REQUIRED');
        this.failure = null;
        this.started = true;
        if (automatic) {
            this.timer = setInterval(() => { void this.tick(); }, this.store.config.tickMs);
            void this.tick();
        }
    }
    stop() { this.started = false; if (this.timer)
        clearInterval(this.timer); this.timer = undefined; }
    tick() {
        if (this.pending)
            return this.pending;
        if (!this.started || this.closed || !this.ready() || !this.dependenciesReady() || !this.ctx.dafeiyu.accepting)
            return Promise.resolve();
        const work = Promise.resolve().then(() => {
            if (!this.started || this.closed || !this.ready() || !this.ctx.dafeiyu.accepting)
                return;
            const now = this.now();
            this.importMemory(now);
            this.controlActive(now);
            if (this.pressure())
                return;
            this.dispatch(now);
            for (const id of this.store.due(now)) {
                const plan = this.store.get(id), source = this.source(plan);
                if (source.state === 'pending')
                    continue;
                if (source.state === 'stale') {
                    this.store.block(id, source.code ?? 'SOURCE_STALE', now);
                    this.retireOwnedTask(plan);
                    continue;
                }
                if (plan.body.purpose === 'maintenance') {
                    const item = plan.body.maintenanceId ? this.memory?.inspect(plan.body.maintenanceId) : null;
                    if (!item || !['waiting-scheduler', 'ready'].includes(item.state)) {
                        this.store.block(id, 'MAINTENANCE_NO_LONGER_PENDING', now);
                        continue;
                    }
                }
                this.ensureTask(plan);
                this.store.issue(id, now);
            }
            this.dispatch(now);
        }).catch(error => { this.failure = safeCode(error); this.stop(); }).finally(() => { if (this.pending === work)
            this.pending = undefined; });
        this.pending = work;
        return work;
    }
    async whenIdle() { await this.pending; }
    get health() { return { running: this.started, error: this.failure }; }
    async close() { if (this.closed)
        return; this.closed = true; this.stop(); await this.whenIdle(); this.unbindWake(); this.unbindEvents(); this.disconnectMemory?.(); }
}
function safeCode(error) { return error instanceof Error && /^[A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'ACTIVITY_FAILED'; }
