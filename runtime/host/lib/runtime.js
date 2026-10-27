import { Context } from '@deepseek-ai/cordis';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionStore from '@deepseek-ai/dsh-session';
import Projection from '@deepseek-ai/dsh-session-projection';
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Query from '@deepseek-ai/dsh-session-query-sqlite';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import LlmRuntime, { LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import Credentials from '@deepseek-ai/dsh-credentials-local';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key';
import * as Core from '#dafeiyu/core';
import { RUNTIME_SCHEMA_VERSION } from '#dafeiyu/core/runtime-store';
import * as Memory from '#dafeiyu/memory';
import { MEMORY_SCHEMA_VERSION } from '#dafeiyu/memory/store';
import * as Activity from '#dafeiyu/activity';
import * as Media from '#dafeiyu/media';
import * as Bili from '#dafeiyu/bilibili';
import { ServerExecutorService, EXECUTOR_SCHEMA_VERSION } from '#dafeiyu/server-executor';
import { reconcileMedia } from './media-recovery.js';
import { installAccountModel } from './account-model.js';
import * as Timeline from '#dafeiyu/timeline';
import * as QQ from '#dafeiyu/qq';
import { openBiliOwnerChannel, BILI_OWNER_SCHEMA_VERSION, BILI_OWNER_TASK_ACTIONS } from '#dafeiyu/bilibili/channel';
import * as Simulator from '#dafeiyu/channel-simulator';
import { ExecutionRequestSchema, TaskAssessmentSchema } from '#dafeiyu/contracts';
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { loadHostConfig, assertPaths, pluginConfig } from './configuration.js';
import { inspectHost, bindMigratedProfile, packageVersion } from './profile.js';
import { claim } from './coordination.js';
import { installInlineDeepSeek } from './inline-model.js';
import { bindDshTools } from './dsh-tools.js';
const importedHome = process.env.DSH_HOME;
class FixedModel extends LlmAdapter {
    response;
    constructor(response) {
        super();
        this.response = response;
    }
    async resolveModel(provider, model) { return { provider, id: model, name: model, systemPromptUpdate: 'in-history', toolUpdate: 'in-history', reasoning: { efforts: [{ id: ReasoningEffortId('max'), name: 'Max' }] } }; }
    async *stream(options) {
        options.signal?.throwIfAborted();
        const text = String(options.sessionId).startsWith('dafeiyu-assessment-') ? JSON.stringify(TaskAssessmentSchema.parse({ goalStatus: 'uncertain', summary: '离线脚本模型的固定阶段评价，仅验证程序流程。', evidenceIds: [], limitations: ['未作真实模型质量验收'], unfinished: [], next: 'deliver' })) : this.response;
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text };
        yield { type: 'block-end', index: 0, block: { type: 'text', text } };
        yield { type: 'finish', reason: { kind: 'stop' } };
    }
}
const stableCode = (error, fallback = 'HOST_FAILED') => error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.message) ? error.message : fallback;
const hashFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/** One local profile, one DSH owner. CLI bootstrap binds DSH_HOME before loading this module. */
export class ManagedHost {
    options;
    ctx = new Context();
    config;
    mode;
    phase = 'created';
    error = null;
    lease;
    instanceId = '00000000-0000-4000-8000-000000000000';
    timer;
    closing;
    coreValue;
    memoryValue;
    qqValue;
    activityValue;
    mediaValue;
    biliValue;
    executorValue;
    biliOwnerValue;
    credentials;
    health;
    jobs = new Set();
    finishClose;
    finished = new Promise(resolve => { this.finishClose = resolve; });
    constructor(config, options) {
        this.options = options;
        this.config = config;
        this.mode = options.mode ?? 'daemon';
        this.health = config.plugins.map(p => ({ id: p.id, required: p.required, state: p.enabled ? 'configured' : 'disabled', version: packageVersion(p.id), code: null }));
        for (const id of ['activity', 'media', 'bilibili'])
            if (!this.health.some(p => p.id === id))
                this.health.push({ id, required: false, state: 'not-configured', version: null, code: null });
    }
    get core() { if (!this.coreValue)
        throw new Error('HOST_NOT_OPEN'); return this.coreValue; }
    static async start(config, options = {}) {
        const expected = resolve(config.paths.core, 'dsh-home');
        if (!importedHome || resolve(importedHome) !== expected || !process.env.DSH_HOME || resolve(process.env.DSH_HOME) !== expected)
            throw new Error('HOST_DSH_HOME_NOT_BOUND_BEFORE_IMPORT');
        if ((options.adapter || options.activityClock || options.biliTransport) && (config.config.persona.kind !== 'test' || !pluginConfig(config, 'model-scripted')))
            throw new Error('HOST_TEST_ADAPTER_FORBIDDEN');
        const host = new ManagedHost(config, options);
        try {
            await host.open();
            return host;
        }
        catch (error) {
            host.error = options.signal?.aborted ? 'HOST_START_CANCELLED' : stableCode(error);
            host.phase = 'failed';
            await host.close('startup-failed').catch(() => { });
            throw new Error(host.error);
        }
    }
    mark(phase) { this.options.signal?.throwIfAborted(); this.phase = phase; this.options.onPhase?.(phase, this); }
    plugin(id, state, code = null) { const health = this.health.find(p => p.id === id); if (health) {
        health.state = state;
        health.code = code;
    } }
    async open() {
        const check = inspectHost(this.config, this.options.coordination);
        if (!check.ready)
            throw new Error(check.codes[0] ?? 'HOST_INSPECTION_FAILED');
        this.mark('inspected');
        this.lease = claim(this.config.resources, { profileId: this.config.config.profileId, agentId: this.config.config.agent.id }, this.options.coordination);
        this.instanceId = this.lease.owner.instanceId;
        const second = inspectHost(this.config, this.options.coordination, this.lease.owner.instanceId);
        if (!second.ready)
            throw new Error(second.codes[0] ?? 'HOST_INSPECTION_FAILED');
        if (loadHostConfig(this.config.file).hash !== this.config.hash)
            throw new Error('HOST_CONFIG_CHANGED');
        assertPaths(this.config);
        bindMigratedProfile(this.config);
        this.mark('opening');
        const ctx = this.ctx;
        await ctx.plugin(LlmRuntime);
        await ctx.plugin(SessionStore);
        await ctx.plugin(Projection);
        await ctx.plugin(Prompt);
        await ctx.plugin(Tools);
        await ctx.plugin(AgentRegistry);
        await ctx.plugin(Persistence, { root: this.config.paths.sessions, compression: 'none' });
        await ctx.plugin(AgentLoop, { agents: [] });
        const deepseek = pluginConfig(this.config, 'model-deepseek'), scripted = pluginConfig(this.config, 'model-scripted');
        if (deepseek) {
            const doc = parseDocument(readFileSync(deepseek.credentialStore, 'utf8'), { logLevel: 'silent' });
            if (doc.errors.length || doc.get('version') !== 1)
                throw new Error('HOST_CREDENTIAL_STORE_UNSUPPORTED');
            await ctx.plugin(Credentials, { path: deepseek.credentialStore, watch: deepseek.auth === 'dsh-account' });
            if (deepseek.auth === 'dsh-account')
                await installAccountModel(ctx, { baseURL: deepseek.baseURL, route: this.config.config.modelRoutes.chat, ...(deepseek.inlineTransport ? { inlineTransport: deepseek.inlineTransport } : {}), guard: () => assertPaths(this.config) });
            else {
                this.credentials = { file: deepseek.credentialStore, hash: hashFile(deepseek.credentialStore) };
                if (!(await ctx.credentials.describe(credentialRef(deepseek.credentialName))).configured)
                    throw new Error('HOST_CREDENTIAL_REFERENCE_MISSING');
                if (deepseek.inlineTransport)
                    await installInlineDeepSeek(ctx, { baseURL: deepseek.baseURL, credentialName: deepseek.credentialName, route: this.config.config.modelRoutes.chat, settings: deepseek.inlineTransport,
                        credentialGuard: () => { if (!this.credentials || hashFile(this.credentials.file) !== this.credentials.hash)
                            throw new Error('HOST_CREDENTIAL_STORE_CHANGED'); } });
                else
                    await ctx.plugin(DeepSeek, { baseURL: deepseek.baseURL, apiKeyEnv: deepseek.credentialName });
            }
            this.plugin('model-deepseek', 'ready');
        }
        else if (scripted) {
            ctx.llm.registerAdapter(['local-test'], this.options.adapter ?? new FixedModel(scripted.response));
            this.plugin('model-scripted', 'ready');
        }
        await this.options.installModelAdmission?.(ctx, this.config);
        this.options.signal?.throwIfAborted();
        const observe = this.options.onModelCall;
        ctx.on('llm/stream', async function* (options, next) {
            const call = { provider: options.provider ?? '', model: options.model ?? '', purpose: options.purpose ?? 'task' };
            observe?.({ ...call, status: 'started' });
            let okay = true;
            try {
                for await (const chunk of next()) {
                    if (chunk.type === 'finish' && ['error', 'aborted', 'max-tokens'].includes(chunk.reason.kind))
                        okay = false;
                    yield chunk;
                }
                observe?.({ ...call, status: okay ? 'completed' : 'failed' });
            }
            catch (error) {
                observe?.({ ...call, status: 'failed' });
                throw error;
            }
        });
        const route = this.config.config.modelRoutes.chat, modelInfo = await ctx.llm.resolveModelInfo(route.provider, route.model, this.options.signal);
        if (route.reasoningEffort && !modelInfo.reasoning?.efforts.some(e => e.id === route.reasoningEffort))
            throw new Error('HOST_REASONING_ROUTE_UNSUPPORTED');
        await ctx.plugin(Query, { path: this.config.paths.query, openAt: 'first-search' });
        const { compactionInputTokens: inputTokens, ...context } = this.config.config.context;
        await ctx.plugin(Core, { agentId: this.config.config.agent.id, dataDir: this.config.paths.core, personaFile: this.config.paths.foundation, ...route, lifecycleMode: 'managed', turnTimeoutMs: this.config.config.runtime.turnTimeoutMs, phaseTimeouts: this.config.config.runtime.phaseTimeouts,
            context: { ...context, regions: { ...context.regions, 'memory:growth': { ...this.config.config.persona.growthRegion, required: false } } } });
        this.coreValue = ctx.dafeiyu;
        this.mark('binding');
        const timeline = pluginConfig(this.config, 'timeline');
        if (timeline) {
            await ctx.plugin(Timeline, { agentId: this.config.config.agent.id, ...timeline });
            this.plugin('timeline', 'ready');
        }
        const memory = pluginConfig(this.config, 'memory');
        if (memory) {
            await ctx.plugin(Memory, { agentId: this.config.config.agent.id, dataDir: this.config.paths.memory, lifecycleMode: 'managed', ...memory, ...(inputTokens ? { compaction: { inputTokens } } : {}) });
            this.memoryValue = ctx.dafeiyuMemory;
            this.plugin('memory', 'ready');
            this.core.configureExecution({ profileId: this.config.config.profileId, policies: this.config.config.authorityPolicies, createStore: false, maxPendingRuns: this.config.config.runtime.maxPendingRuns, maxConcurrentRuns: this.config.config.runtime.maxConcurrentRuns });
        }
        if (this.options.dshTools) {
            await this.options.dshTools.catalog(this.options.signal ?? new AbortController().signal);
            const handle = bindDshTools(ctx, this.config.config.agent.id, this.options.dshTools, join(this.config.paths.core, 'dsh-tool-receipts'));
            ctx.effect(() => () => handle.dispose());
        }
        const executor = pluginConfig(this.config, 'server-executor');
        if (executor) {
            const dependencies = this.options.serverExecutorDependencies;
            if (!dependencies)
                throw new Error('HOST_EXECUTOR_RUNTIME_PORT_REQUIRED');
            const offline = this.config.config.persona.kind === 'test' && !!pluginConfig(this.config, 'model-scripted');
            this.executorValue = new ServerExecutorService(ctx, { agentId: this.config.config.agent.id, profileId: this.config.config.profileId, dataDir: this.config.paths.core, createStore: false, mode: offline ? 'offline' : 'production', settings: executor }, dependencies);
            this.plugin('server-executor', 'starting');
        }
        const activity = pluginConfig(this.config, 'activity');
        if (activity) {
            this.activityValue = new Activity.ActivityService(ctx, { agentId: this.config.config.agent.id, profileId: this.config.config.profileId, dataDir: this.config.paths.core, settings: activity }, this.options.activityClock?.now ?? Date.now, this.options.activityClock?.monotonic ?? (() => performance.now()));
            if (activity.maintenance) {
                const port = this.memoryValue?.maintenance?.schedulingPort();
                if (!port)
                    throw new Error('HOST_ACTIVITY_MAINTENANCE_REQUIRED');
                this.activityValue.bindMaintenance(port);
            }
            this.plugin('activity', 'ready', this.mode === 'single-run' ? 'HOST_SINGLE_RUN' : undefined);
        }
        const media = pluginConfig(this.config, 'media');
        if (media) {
            await ctx.plugin(Media, { ...media, agentId: this.config.config.agent.id, profileId: this.config.config.profileId, dataDir: this.config.paths.core, createStore: false });
            this.mediaValue = ctx.dafeiyuMedia;
            this.plugin('media', 'ready');
        }
        const bili = pluginConfig(this.config, 'bilibili');
        if (bili) {
            this.biliValue = new Bili.BiliService(ctx, { agentId: this.config.config.agent.id, profileId: this.config.config.profileId, dataDir: this.config.paths.core, createStore: false, settings: bili }, this.options.biliTransport);
            this.plugin('bilibili', 'ready');
        }
        const simulator = pluginConfig(this.config, 'channel-simulator');
        if (simulator) {
            await ctx.plugin(Simulator, { agentId: this.config.config.agent.id, ...simulator });
            this.plugin('channel-simulator', this.mode === 'single-run' ? 'disabled' : 'ready');
        }
        const qq = pluginConfig(this.config, 'channel-qq');
        if (qq && this.mode === 'daemon') {
            if (!existsSync(qq.tokenFile)) {
                if (this.health.find(p => p.id === 'channel-qq')?.required)
                    throw new Error('HOST_QQ_CREDENTIAL_FILE_MISSING');
                this.plugin('channel-qq', 'degraded', 'HOST_QQ_CREDENTIAL_FILE_MISSING');
            }
            else {
                await ctx.plugin(QQ, { agentId: this.config.config.agent.id, dataDir: this.config.paths.channels['channel-qq'], lifecycleMode: 'managed', ...qq });
                this.qqValue = ctx.dafeiyuQQ;
                this.qqValue.holdIngress();
                this.plugin('channel-qq', 'starting');
            }
        }
        else if (qq)
            this.plugin('channel-qq', 'disabled', 'HOST_SINGLE_RUN');
        const biliOwner = pluginConfig(this.config, 'channel-bili-owner');
        if (biliOwner && this.mode === 'daemon') {
            if (!this.options.createBiliOwnerPorts) {
                if (this.health.find(plugin => plugin.id === 'channel-bili-owner')?.required)
                    throw new Error('HOST_BILI_OWNER_RUNTIME_PORT_REQUIRED');
                this.plugin('channel-bili-owner', 'degraded', 'HOST_BILI_OWNER_RUNTIME_PORT_REQUIRED');
            }
            else {
                try {
                    const ports = await this.options.createBiliOwnerPorts();
                    this.biliOwnerValue = await openBiliOwnerChannel(ctx, { agentId: this.config.config.agent.id, profileId: this.config.config.profileId, dataDir: this.config.paths.core, createStore: false, settings: biliOwner }, ports);
                    this.biliOwnerValue.holdIngress();
                    this.plugin('channel-bili-owner', 'starting');
                }
                catch (error) {
                    if (this.health.find(plugin => plugin.id === 'channel-bili-owner')?.required)
                        throw error;
                    this.biliOwnerValue = undefined;
                    this.plugin('channel-bili-owner', 'degraded', stableCode(error, 'HOST_BILI_OWNER_UNAVAILABLE'));
                }
            }
        }
        else if (biliOwner)
            this.plugin('channel-bili-owner', 'disabled', 'HOST_SINGLE_RUN');
        if (this.mode === 'daemon' && biliOwner && !this.biliOwnerValue && this.biliOwnerPendingWork())
            throw new Error('HOST_BILI_OWNER_PENDING_WORK_REQUIRES_CHANNEL');
        const producerActive = (producer) => producer === 'activity' ? !!this.activityValue && this.mode === 'daemon' : producer === 'channel-qq' ? !!this.qqValue : producer === 'qq-tasks' ? !!this.qqValue?.getStatus().tasks.registered : producer === 'channel-bili-owner' ? !!this.biliOwnerValue : producer === 'bili-owner-tasks' ? !!this.biliOwnerValue && !!biliOwner?.tasks.enabled : producer === 'channel-simulator' ? !!simulator && this.mode === 'daemon' : true;
        const absentChannelActions = new Set([...(!this.qqValue && qq ? [...QQ.QQ_ACTIONS, ...QQ.QQ_TASK_ACTIONS, ...QQ.QQ_MEDIA_ACTIONS, ...QQ.QQ_PROGRESS_ACTIONS] : []), ...(!this.biliOwnerValue && biliOwner ? [...BILI_OWNER_TASK_ACTIONS] : [])]);
        if (this.config.config.authorityPolicies.filter(policy => policy.producers.some(producerActive)).some(policy => policy.actions.some(action => !this.core.capabilityManifest().actions.some(actual => actual.id === action) && !absentChannelActions.has(action))))
            throw new Error('HOST_POLICY_ACTION_UNAVAILABLE');
        this.mark('recovering');
        this.memoryValue?.recover();
        this.memoryValue?.activate();
        this.executorValue?.recover();
        this.executorValue?.activate();
        this.executorHealth();
        this.activityValue?.recover();
        this.activityValue?.activate();
        await this.mediaValue?.recover();
        this.mediaValue?.activate();
        this.biliValue?.recover();
        this.biliValue?.activate();
        this.biliOwnerValue?.recover();
        this.biliOwnerValue?.activate();
        if (memory)
            await this.core.recoverExecutions();
        this.core.recover();
        if (this.mediaValue) {
            const recovered = reconcileMedia(this.core, this.mediaValue, this.config.paths.channels['channel-qq']);
            if (recovered.conflicts)
                this.plugin('media', 'degraded', 'HOST_MEDIA_SETTLEMENT_CONFLICT');
        }
        const resume = { resumeMessages: this.mode === 'daemon', resumeExecutions: this.mode === 'daemon' };
        if (this.mode === 'single-run')
            this.memoryValue?.stopBackground();
        this.core.activate({ deferWork: true, ...resume });
        if (this.qqValue) {
            await this.qqValue.start();
            const deadline = Date.now() + 6000;
            while (this.qqValue.getStatus().state === 'starting' && Date.now() < deadline)
                await delay(20);
            const state = this.qqValue.getStatus();
            if (state.state !== 'online') {
                if (this.health.find(p => p.id === 'channel-qq')?.required)
                    throw new Error('HOST_REQUIRED_QQ_UNAVAILABLE');
                this.qqValue.quiesce();
                await this.qqValue.close();
                this.qqValue = undefined;
                this.plugin('channel-qq', 'degraded', state.error ?? 'HOST_QQ_UNAVAILABLE');
            }
            else
                this.qqHealth();
        }
        if (this.biliOwnerValue) {
            try {
                await this.biliOwnerValue.start();
                this.biliOwnerHealth();
            }
            catch (error) {
                if (this.health.find(plugin => plugin.id === 'channel-bili-owner')?.required || this.biliOwnerPendingWork())
                    throw error;
                await this.biliOwnerValue.close();
                this.biliOwnerValue = undefined;
                this.plugin('channel-bili-owner', 'degraded', stableCode(error, 'HOST_BILI_OWNER_UNAVAILABLE'));
            }
        }
        this.options.signal?.throwIfAborted();
        this.core.activate(resume);
        this.qqValue?.releaseIngress();
        this.biliOwnerValue?.releaseIngress();
        this.biliHealth();
        this.mark(this.health.some(p => p.state === 'degraded') ? 'degraded' : 'ready');
        if (this.mode === 'daemon')
            this.activityValue?.start();
        this.publish();
        this.timer = setInterval(() => { try {
            this.refresh();
            this.publish();
        }
        catch (error) {
            this.error = stableCode(error, 'HOST_DIAGNOSTICS_FAILED');
            void this.close('diagnostics-failed').catch(() => { });
        } }, this.config.config.diagnostics.snapshotIntervalMs);
        if (this.mode === 'single-run')
            this.timer.unref();
    }
    refresh() {
        if (!['ready', 'degraded'].includes(this.phase))
            return;
        const qq = this.qqValue?.getStatus();
        if (qq && qq.state !== 'online') {
            if (this.health.find(p => p.id === 'channel-qq')?.required) {
                this.error = 'HOST_REQUIRED_QQ_UNAVAILABLE';
                this.core.quiesce();
                void this.close('required-channel-failed').catch(() => { });
                return;
            }
            this.plugin('channel-qq', 'degraded', qq.error ?? 'HOST_QQ_UNAVAILABLE');
        }
        else if (qq)
            this.qqHealth();
        if (!this.core.accepting) {
            this.error = 'HOST_CORE_UNAVAILABLE';
            void this.close('core-unavailable').catch(() => { });
            return;
        }
        if (this.memoryValue?.runtimeHealth().analysis.state === 'failed')
            this.plugin('memory', 'degraded', 'HOST_ANALYSIS_WORKER_FAILED');
        if (this.activityValue?.health.error)
            this.plugin('activity', 'degraded', this.activityValue.health.error);
        if (this.mediaValue?.health.reconciliation.conflicts)
            this.plugin('media', 'degraded', 'HOST_MEDIA_SETTLEMENT_CONFLICT');
        this.executorHealth();
        this.biliOwnerHealth();
        this.biliHealth();
        this.phase = this.health.some(p => p.state === 'degraded') ? 'degraded' : 'ready';
    }
    biliHealth() { if (this.biliValue) {
        const blocked = (this.biliValue.health.backoffUntil ?? 0) > Date.now();
        this.plugin('bilibili', blocked ? 'degraded' : 'ready', blocked ? 'HOST_BILI_BACKOFF' : null);
    } }
    /** Missing optional IO must not turn retained private work into stale-source failures during global recovery. */
    biliOwnerPendingWork() {
        if (this.core.journal.list(['accepted', 'processing', 'reply-ready', 'sending']).some(item => item.extensionId === 'channel-bili-owner'))
            return true;
        const db = new DatabaseSync(join(this.config.paths.core, 'runtime.sqlite'), { readOnly: true });
        try {
            return !!db.prepare("SELECT 1 FROM runs r JOIN execution_requests q ON q.id=r.request_key LEFT JOIN native_deliveries d ON d.run_id=r.id WHERE q.producer='bili-owner-tasks' AND (r.state IN ('accepted','queued','running','cancelling') OR d.state IN ('accepted','rendering','verifying','ready','sending') OR (r.state IN ('completed','waiting') AND d.id IS NULL AND ?=1)) LIMIT 1").get(pluginConfig(this.config, 'channel-bili-owner')?.tasks.deliverResults ? 1 : 0);
        }
        finally {
            db.close();
        }
    }
    biliOwnerHealth() {
        if (!this.biliOwnerValue)
            return;
        const status = this.biliOwnerValue.getStatus(), unknown = (status.counts.deliveries.unknown ?? 0);
        const code = !status.bindingReady ? 'HOST_BILI_OWNER_HANDOVER_REQUIRED' : status.bindingFault ?? (!status.verified ? 'HOST_BILI_OWNER_UNAVAILABLE' : status.error ?? (unknown ? 'HOST_BILI_OWNER_UNCERTAIN' : status.backoffUntil > Date.now() ? 'HOST_BILI_OWNER_BACKOFF' : null));
        this.plugin('channel-bili-owner', code ? 'degraded' : 'ready', code);
    }
    executorHealth() { if (this.executorValue) {
        const unknown = (this.executorValue.health.counts.unknown ?? 0) > 0;
        this.plugin('server-executor', unknown ? 'degraded' : 'ready', unknown ? 'HOST_EXECUTOR_UNCERTAIN' : null);
    } }
    qqHealth() {
        const status = this.qqValue?.getStatus().groupSync;
        if (!status)
            return;
        if (status.enabled && (status.state !== 'current' || status.error))
            this.plugin('channel-qq', 'degraded', status.error ?? 'GROUP_SYNC_UNAVAILABLE');
        else
            this.plugin('channel-qq', 'ready');
    }
    outbox() {
        let count = 0;
        for (const [file, tables] of [[join(this.config.paths.core, 'runtime.sqlite'), ['runtime_outbox']], [join(this.config.paths.core, 'delivery.sqlite'), ['events']],
            [join(this.config.paths.memory, 'memory.sqlite'), ['outbox', 'persona_outbox', 'execution_memory_outbox']], [join(this.config.paths.memory, 'analysis.sqlite'), ['audit_outbox']],
            [join(this.config.paths.memory, 'working.sqlite'), ['outbox']], [join(this.config.paths.memory, 'feedback.sqlite'), ['outbox']]]) {
            if (!existsSync(file))
                continue;
            const db = new DatabaseSync(file, { readOnly: true });
            try {
                for (const table of tables)
                    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
                        count += Number(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE delivered=0`).get()?.n);
            }
            finally {
                db.close();
            }
        }
        const activityFile = join(this.config.paths.core, 'activity.sqlite');
        if (existsSync(activityFile)) {
            const db = new DatabaseSync(activityFile, { readOnly: true });
            try {
                count += Number(db.prepare('SELECT count(*) AS n FROM activity_outbox WHERE acknowledged=0').get()?.n);
            }
            finally {
                db.close();
            }
        }
        const biliFile = join(this.config.paths.core, 'bilibili.sqlite');
        if (existsSync(biliFile)) {
            const db = new DatabaseSync(biliFile, { readOnly: true });
            try {
                count += Number(db.prepare('SELECT count(*) AS n FROM bili_outbox WHERE delivered=0').get()?.n);
            }
            finally {
                db.close();
            }
        }
        const mediaFile = join(this.config.paths.core, 'media.sqlite');
        if (existsSync(mediaFile)) {
            const db = new DatabaseSync(mediaFile, { readOnly: true });
            try {
                count += Number(db.prepare('SELECT count(*) AS n FROM media_outbox WHERE delivered=0').get()?.n);
            }
            finally {
                db.close();
            }
        }
        return count;
    }
    snapshot() {
        const core = this.coreValue?.getStatus(), qq = this.qqValue?.getStatus();
        return { schemaVersion: 1, profileId: this.config.config.profileId, agentId: this.config.config.agent.id, instanceId: this.instanceId, pid: process.pid, at: new Date().toISOString(), configHash: this.config.hash, foundationHash: this.config.foundation.hash,
            phase: this.phase, mode: this.mode, accepting: ['ready', 'degraded'].includes(this.phase) && !!this.coreValue?.accepting, error: this.error, plugins: this.health.map(p => ({ ...p })), features: this.coreValue?.capabilityManifest().features ?? [],
            services: { memory: this.memoryValue?.runtimeHealth() ?? null, activity: this.activityValue?.health ?? null, media: this.mediaValue?.health ?? null, bilibili: this.biliValue?.health ?? null, ...(this.executorValue ? { executor: this.executorValue.health } : {}), ...(this.biliOwnerValue ? { biliOwner: this.biliOwnerValue.getStatus() } : {}), taskDelivery: core?.nativeDelivery ?? null, qq: qq ? { state: qq.state, groupSync: qq.groupSync.state, groupError: qq.groupSync.error, effectiveGroups: qq.groupSync.effectiveIds.length, lastGroupSync: qq.groupSync.lastSuccessAt, capabilities: qq.capabilities.registered, tasks: { enabled: qq.tasks.enabled, registered: qq.tasks.registered, deliverResults: qq.tasks.deliverResults }, delivery: qq.delivery } : null },
            counts: { activeRuns: core?.execution?.active ?? 0, queuedRuns: core?.execution?.queued ?? 0, queuedRoutes: core?.queuedRoutes ?? 0, pendingMessages: core?.messages.filter(m => ['accepted', 'processing', 'reply-ready', 'sending'].includes(m.state)).length ?? 0, outbox: this.lease ? this.outbox() : 0 }, schemas: { journal: 2, memory: MEMORY_SCHEMA_VERSION, runtime: RUNTIME_SCHEMA_VERSION, activity: existsSync(join(this.config.paths.core, 'activity.sqlite')) ? 1 : null, media: existsSync(join(this.config.paths.core, 'media.sqlite')) ? Media.MEDIA_SCHEMA_VERSION : null, bilibili: existsSync(join(this.config.paths.core, 'bilibili.sqlite')) ? 1 : null, ...(this.executorValue ? { executor: EXECUTOR_SCHEMA_VERSION } : {}), ...(this.biliOwnerValue ? { biliOwner: BILI_OWNER_SCHEMA_VERSION } : {}) } };
    }
    publish() { if (!this.lease)
        return; const file = join(this.config.paths.core, 'host-status.json'), temp = file + '.' + randomUUID() + '.tmp'; writeFileSync(temp, JSON.stringify(this.snapshot(), null, 2) + '\n', { flag: 'wx' }); renameSync(temp, file); }
    run(raw) {
        if (!['ready', 'degraded'].includes(this.phase))
            throw new Error('HOST_NOT_READY');
        if (!this.memoryValue)
            throw new Error('HOST_TASK_REPOSITORY_REQUIRED');
        const work = this.performRun(raw).finally(() => this.jobs.delete(work));
        this.jobs.add(work);
        return work;
    }
    async performRun(raw) {
        const request = ExecutionRequestSchema.parse(raw), port = this.core.executionProducer('host-cli');
        const accepted = port.submitTask(request, 'taskId' in request ? port.openTask(request.taskId) : undefined);
        await this.core.whenIdle();
        const status = port.status(accepted.run), text = await port.readResult(accepted.run);
        this.publish();
        return { taskId: accepted.task.id, runId: accepted.run.id, state: status.state, error: status.error, result: text };
    }
    whenClosed() { return this.finished; }
    close(_reason = 'requested') { if (this.closing)
        return this.closing; this.closing = this.shutdown().finally(() => this.finishClose()); return this.closing; }
    async shutdown() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = undefined;
        const failed = !!this.error;
        this.phase = 'draining';
        this.activityValue?.stopBackground();
        this.coreValue?.quiesce();
        this.qqValue?.quiesce();
        this.biliOwnerValue?.quiesce();
        this.memoryValue?.stopBackground();
        this.executorValue?.quiesce();
        let drained = false;
        const settled = Promise.allSettled([this.coreValue?.whenIdle(), this.memoryValue?.whenIdle(), this.qqValue?.whenIdle(), this.biliOwnerValue?.whenIdle(), this.activityValue?.whenIdle(), this.mediaValue?.whenIdle(), this.biliValue?.whenIdle(), this.executorValue?.whenIdle(), ...this.jobs]).then(results => { drained = true; if (results.some(r => r.status === 'rejected'))
            this.error ??= 'HOST_DRAIN_FAILED'; });
        let deadline;
        await Promise.race([settled, new Promise(resolve => { deadline = setTimeout(resolve, this.config.config.runtime.shutdownGraceMs); })]);
        if (deadline)
            clearTimeout(deadline);
        if (!drained) {
            this.coreValue?.cancelRunning();
            this.memoryValue?.cancelRunning();
            this.mediaValue?.cancelRunning();
            this.biliValue?.cancelRunning();
            this.biliOwnerValue?.cancelRunning();
            this.executorValue?.cancelRunning();
            this.error ??= 'HOST_DRAIN_CANCELLED';
            await settled;
        }
        let disposed = false;
        try {
            await this.qqValue?.close();
            await this.biliOwnerValue?.close();
            await this.activityValue?.close();
            await this.biliValue?.close();
            await this.mediaValue?.close();
            await this.executorValue?.close();
            await this.memoryValue?.close();
            await this.coreValue?.close();
            await this.ctx.fiber.dispose();
            disposed = true;
            if (this.credentials && hashFile(this.credentials.file) !== this.credentials.hash)
                this.error ??= 'HOST_CREDENTIAL_STORE_CHANGED';
            for (const item of this.health)
                if (['ready', 'starting', 'configured'].includes(item.state))
                    item.state = 'stopped';
            this.phase = failed || this.error && this.error !== 'HOST_DRAIN_CANCELLED' ? 'failed' : 'stopped';
            this.publish();
        }
        catch (error) {
            this.error ??= stableCode(error, 'HOST_CLOSE_FAILED');
            this.phase = 'failed';
            try {
                await this.ctx.fiber.dispose();
                disposed = true;
            }
            finally {
                this.publish();
            }
            throw new Error(this.error);
        }
        finally {
            if (disposed) {
                this.lease?.release();
                this.lease = undefined;
            }
        }
    }
}
