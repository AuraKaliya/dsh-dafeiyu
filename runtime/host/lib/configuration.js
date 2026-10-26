import { readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { HostConfigSchema, dependencyOrder, redactJson } from '#dafeiyu/contracts';
import { MemoryPluginConfigSchema } from '#dafeiyu/memory';
import { ActivityPluginConfigSchema, ACTIVITY_ACTIONS, validateQuiet } from '#dafeiyu/activity';
import { MediaPluginConfigSchema } from '#dafeiyu/media';
import { BiliPluginConfigSchema } from '#dafeiyu/bilibili';
import { ServerExecutorPluginConfigSchema, serverExecutorScene } from '#dafeiyu/server-executor';
import { QqPluginConfigSchema, QQ_ACTIONS, QQ_TASK_ACTIONS } from '#dafeiyu/qq';
import { BiliOwnerPluginConfigSchema, BILI_OWNER_TASK_ACTIONS, biliOwnerScene, BILI_PUBLIC_SCENE } from '#dafeiyu/bilibili/channel';
import { TimelinePluginConfigSchema } from '#dafeiyu/timeline';
import { runtimeHash } from '#dafeiyu/core/runtime-store';
import { readFoundation } from '#dafeiyu/core';
import { physicalPath, resource, overlap, pathIdentity, within } from './paths.js';
import { InlineModelSettingsSchema } from './inline-model.js';
import { normalizeHostPlugins } from './plugin-assembly.js';
const endpoint = z.url().refine(raw => { const url = new URL(raw); return (url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) && !url.username && !url.password && !url.search && !url.hash; });
export const DeepSeekConfigSchema = z.strictObject({ credentialStore: z.string().min(1).default(join(homedir(), '.dsh', '.credentials.yaml')), credentialName: z.literal('DEEPSEEK_API_KEY').default('DEEPSEEK_API_KEY'), baseURL: endpoint.default('https://api.deepseek.com/anthropic'), inlineTransport: InlineModelSettingsSchema.optional() });
export const ScriptedConfigSchema = z.strictObject({ response: z.string().trim().min(1).max(8000).default('这是本机虚构样例；模拟模型已完成任务。') });
export const TimelineConfigSchema = TimelinePluginConfigSchema;
export const SimulatorConfigSchema = z.strictObject({ account: z.string().min(1).max(100).default('local-test') });
export const pluginSchemas = { timeline: TimelineConfigSchema, memory: MemoryPluginConfigSchema, activity: ActivityPluginConfigSchema, media: MediaPluginConfigSchema, bilibili: BiliPluginConfigSchema, 'server-executor': ServerExecutorPluginConfigSchema, 'channel-qq': QqPluginConfigSchema, 'channel-bili-owner': BiliOwnerPluginConfigSchema, 'channel-simulator': SimulatorConfigSchema, 'model-deepseek': DeepSeekConfigSchema, 'model-scripted': ScriptedConfigSchema };
export const BILI_OWNER_NATIVE_ACTIONS = ['bili_discover', 'bili_search_sources', 'bili_search', 'bili_video', 'bili_comments', 'bili_subtitles', 'bili_danmaku', 'bili_media', 'bili_observe_select',
    'dafeiyu_media_acquire', 'dafeiyu_media_inspect', 'dafeiyu_media_read', 'dafeiyu_media_select', 'dafeiyu_execution_source_open', 'dafeiyu_execution_contribute', 'dafeiyu_execution_select', 'dafeiyu_execution_source_state', 'dafeiyu_task_intent', 'dafeiyu_task_object'];
function readJSON(file) { const stat = statSync(file); if (!stat.isFile() || stat.size > 262144)
    throw new Error('HOST_CONFIG_INVALID'); return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file))); }
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
} }
export function assertPaths(prepared) { if (prepared.declarations.some(value => pathIdentity(value.path) !== value.identity))
    throw new Error('HOST_PATH_CHANGED'); }
export function loadHostConfig(input) {
    try {
        const file = physicalPath(input), base = dirname(file), config = normalizeHostPlugins(readJSON(file));
        if (redactJson(z.json().parse(config)).redacted)
            throw new Error('HOST_PRIVATE_CONFIG_REJECTED');
        const resolvePath = (path) => physicalPath(resolve(base, path));
        const paths = { core: resolvePath(config.paths.core), memory: resolvePath(config.paths.memory), sessions: resolvePath(config.paths.sessions), query: resolvePath(config.paths.query),
            channels: Object.fromEntries(Object.entries(config.paths.channels).map(([id, path]) => [id, resolvePath(path)])), foundation: resolvePath(config.persona.fixedFile) };
        if (Object.keys(paths.channels).some(id => id !== 'channel-qq'))
            throw new Error('HOST_UNKNOWN_CHANNEL_STORAGE');
        const resources = [resource(paths.core, 'directory'), resource(paths.memory, 'directory'), resource(paths.sessions, 'directory'), resource(paths.query, 'file'), ...Object.values(paths.channels).map(path => resource(path, 'directory'))];
        if (resources.some((a, index) => resources.slice(index + 1).some(b => overlap(a, b))))
            throw new Error('HOST_PATH_OVERLAP');
        if (resources.some(item => within(file, item.path) || within(paths.foundation, item.path)))
            throw new Error('HOST_CONFIG_INSIDE_DATA');
        const plugins = config.plugins.map(plugin => {
            if (!Object.hasOwn(pluginSchemas, plugin.id))
                throw new Error('HOST_UNKNOWN_PLUGIN');
            const id = plugin.id;
            const parsed = pluginSchemas[id].parse(plugin.config);
            if (id === 'model-deepseek')
                parsed.credentialStore = resolvePath(String(parsed.credentialStore));
            if (id === 'server-executor') {
                const settings = ServerExecutorPluginConfigSchema.parse(parsed);
                for (const key of ['nodePath', 'entryPath', 'profilePath', 'cwd']) {
                    if (/^\\\\|^\/\//.test(settings.command[key]))
                        throw new Error('HOST_EXECUTOR_LOCAL_PATH_REQUIRED');
                    settings.command[key] = resolvePath(settings.command[key]);
                }
                if (settings.standingAuthority) {
                    settings.standingAuthority.path = resolvePath(settings.standingAuthority.path);
                    settings.standingAuthority.configurationRoot = resolvePath(settings.standingAuthority.configurationRoot);
                    if (resources.some(item => within(settings.standingAuthority.path, item.path)))
                        throw new Error('HOST_EXECUTOR_AUTHORITY_INSIDE_DATA');
                }
                Object.assign(parsed, settings);
            }
            if (id === 'bilibili') {
                const settings = BiliPluginConfigSchema.parse(parsed);
                if (settings.session) {
                    if (/^\\\\|^\/\//.test(settings.session.file))
                        throw new Error('HOST_BILI_LOCAL_SESSION_REQUIRED');
                    settings.session.file = resolvePath(settings.session.file);
                }
                Object.assign(parsed, settings);
            }
            if (id === 'channel-qq') {
                parsed.tokenFile = resolvePath(String(parsed.tokenFile));
                if (plugin.enabled && !paths.channels['channel-qq'])
                    throw new Error('HOST_CHANNEL_PATH_REQUIRED');
                for (const key of ['httpURL', 'wsURL']) {
                    const url = new URL(String(parsed[key]));
                    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.protocol !== (key === 'httpURL' ? 'http:' : 'ws:'))
                        throw new Error('HOST_QQ_LOOPBACK_REQUIRED');
                }
            }
            if (id === 'memory' && parsed.retrieval) {
                const retrieval = z.record(z.string(), z.unknown()).parse(parsed.retrieval);
                for (const key of ['python', 'modelDir', 'serviceFile', 'pythonPackages', 'profileFile'])
                    if (typeof retrieval[key] === 'string')
                        retrieval[key] = resolvePath(retrieval[key]);
                parsed.retrieval = retrieval;
            }
            if (id === 'media') {
                const settings = MediaPluginConfigSchema.parse(parsed);
                settings.ffmpeg = resolvePath(settings.ffmpeg);
                settings.ffprobe = resolvePath(settings.ffprobe);
                if (settings.documents)
                    settings.documents.python = resolvePath(settings.documents.python);
                if (settings.tts)
                    settings.tts.powershell = resolvePath(settings.tts.powershell);
                if (settings.audio?.whisper) {
                    const audio = settings.audio.whisper;
                    audio.node = resolvePath(audio.node);
                    audio.moduleDirectory = resolvePath(audio.moduleDirectory);
                    audio.model.path = resolvePath(audio.model.path);
                }
                if (settings.audio?.events) {
                    const audio = settings.audio.events;
                    audio.python = resolvePath(audio.python);
                    audio.model.path = resolvePath(audio.model.path);
                    audio.labels.path = resolvePath(audio.labels.path);
                }
                Object.assign(parsed, settings);
            }
            if (id === 'channel-qq') {
                const media = QqPluginConfigSchema.parse(parsed).media;
                media.cacheRoots = media.cacheRoots.map(resolvePath);
                parsed.media = media;
            }
            return { id, enabled: plugin.enabled, required: plugin.required, requires: plugin.requires, config: parsed };
        });
        if (plugins.some(p => p.required && !p.enabled))
            throw new Error('HOST_REQUIRED_PLUGIN_DISABLED');
        const enabled = plugins.filter(p => p.enabled), models = enabled.filter(p => p.id.startsWith('model-'));
        if (models.length !== 1)
            throw new Error('HOST_MODEL_PROVIDER_REQUIRED');
        if (config.modelRoutes.chat.provider !== (models[0].id === 'model-deepseek' ? 'deepseek-official' : 'local-test'))
            throw new Error('HOST_MODEL_ROUTE_MISMATCH');
        if (models[0].config.inlineTransport && !['off', 'low', 'high', 'max'].includes(config.modelRoutes.chat.reasoningEffort ?? ''))
            throw new Error('HOST_INLINE_REASONING_REQUIRED');
        if (models[0].id === 'model-scripted' && (config.persona.kind !== 'test' || config.modelRoutes.chat.model !== 'scripted'))
            throw new Error('HOST_TEST_MODEL_REQUIRES_TEST_PROFILE');
        const hasMemory = enabled.some(p => p.id === 'memory');
        if (!hasMemory && enabled.some(p => p.id === 'timeline' && p.config.execution === true))
            throw new Error('HOST_TASK_REPOSITORY_REQUIRED');
        if (config.context.compactionInputTokens !== undefined && !hasMemory)
            throw new Error('HOST_COMPACTION_REQUIRES_MEMORY');
        const memory = enabled.find(p => p.id === 'memory');
        if (memory?.config.compaction && config.context.compactionInputTokens !== undefined)
            throw new Error('HOST_DUPLICATE_COMPACTION_CONFIG');
        if (memory?.config.maintenance && !memory.config.sourceTracking && !memory.config.compaction && config.context.compactionInputTokens === undefined)
            throw new Error('HOST_MAINTENANCE_SOURCE_TRACKING_REQUIRED');
        const activity = enabled.find(p => p.id === 'activity'), activityConfig = activity ? ActivityPluginConfigSchema.parse(activity.config) : null;
        if (activityConfig) {
            if (!memory)
                throw new Error('HOST_ACTIVITY_MEMORY_REQUIRED');
            try {
                validateQuiet(activityConfig.quiet);
            }
            catch {
                throw new Error('HOST_ACTIVITY_QUIET_INVALID');
            }
            if (!memory.config.sourceTracking && !memory.config.compaction && config.context.compactionInputTokens === undefined)
                throw new Error('HOST_ACTIVITY_SOURCE_TRACKING_REQUIRED');
            const exploration = config.authorityPolicies.find(p => p.id === activityConfig.explorationPolicy && p.producers.includes('activity'));
            if (!exploration?.allowLocalWrite || ACTIVITY_ACTIONS.some(id => !exploration.actions.includes(id)))
                throw new Error('HOST_ACTIVITY_POLICY_REQUIRED');
            if (activityConfig.maintenance) {
                if (!memory.config.maintenance)
                    throw new Error('HOST_ACTIVITY_MAINTENANCE_REQUIRED');
                const maintenance = config.authorityPolicies.find(p => p.id === activityConfig.maintenancePolicy && p.producers.includes('activity'));
                if (!maintenance?.allowLocalWrite || !maintenance.actions.includes('dafeiyu_memory_consolidate'))
                    throw new Error('HOST_ACTIVITY_MAINTENANCE_POLICY_REQUIRED');
            }
        }
        const qq = enabled.find(p => p.id === 'channel-qq'), qqCapabilities = qq && QqPluginConfigSchema.parse(qq.config).capabilities.enabled;
        const biliOwner = enabled.find(p => p.id === 'channel-bili-owner'), biliOwnerConfig = biliOwner ? BiliOwnerPluginConfigSchema.parse(biliOwner.config) : undefined;
        if (biliOwnerConfig) {
            if (!memory)
                throw new Error('HOST_BILI_OWNER_MEMORY_REQUIRED');
            if (!memory.config.sourceTracking && !memory.config.compaction && config.context.compactionInputTokens === undefined)
                throw new Error('HOST_BILI_OWNER_SOURCE_TRACKING_REQUIRED');
            if (biliOwnerConfig.tasks.enabled) {
                if (!enabled.some(plugin => plugin.id === 'bilibili') || !enabled.some(plugin => plugin.id === 'media'))
                    throw new Error('HOST_BILI_OWNER_EXPLORATION_REQUIRED');
                const conversation = config.authorityPolicies.find(policy => policy.id === 'conversation' && policy.producers.includes('channel-bili-owner'));
                const native = config.authorityPolicies.find(policy => policy.id === biliOwnerConfig.tasks.policyId && policy.producers.includes('bili-owner-tasks'));
                if (!conversation?.allowLocalWrite || BILI_OWNER_TASK_ACTIONS.some(action => !conversation.actions.includes(action)) || !native?.allowLocalWrite || native.producers.length !== 1 || native.externalActions?.length
                    || BILI_OWNER_NATIVE_ACTIONS.some(action => !native.actions.includes(action)) || native.actions.some(action => !BILI_OWNER_NATIVE_ACTIONS.some(allowed => allowed === action)))
                    throw new Error('HOST_BILI_OWNER_TASK_POLICY_REQUIRED');
                if (!native.resources.some(scene => runtimeHash(scene) === runtimeHash(BILI_PUBLIC_SCENE)) || native.resources.some(scene => ![BILI_PUBLIC_SCENE, biliOwnerScene(biliOwnerConfig)].some(allowed => runtimeHash(allowed) === runtimeHash(scene))))
                    throw new Error('HOST_BILI_OWNER_RESOURCE_DENIED');
            }
        }
        const executor = enabled.find(p => p.id === 'server-executor');
        if (executor) {
            const settings = ServerExecutorPluginConfigSchema.parse(executor.config), route = config.modelRoutes.chat;
            if (!memory)
                throw new Error('HOST_EXECUTOR_MEMORY_REQUIRED');
            if (!memory.config.sourceTracking && !memory.config.compaction && config.context.compactionInputTokens === undefined)
                throw new Error('HOST_EXECUTOR_SOURCE_TRACKING_REQUIRED');
            if (settings.route.provider !== route.provider || settings.route.model !== route.model || settings.route.reasoningEffort !== (route.reasoningEffort ?? null))
                throw new Error('HOST_EXECUTOR_MODEL_ROUTE_MISMATCH');
            if (qq) {
                const binding = QqPluginConfigSchema.parse(qq.config);
                if (settings.resultOwner.account !== binding.botId || settings.resultOwner.ownerId !== binding.ownerId)
                    throw new Error('HOST_EXECUTOR_OWNER_MISMATCH');
            }
            const scene = serverExecutorScene(config.profileId), actions = ['dafeiyu_server_execute_owner', 'dafeiyu_server_execute_autonomous', 'dafeiyu_server_execution_status', 'dafeiyu_server_execution_result'];
            for (const policy of config.authorityPolicies) {
                const actual = policy.actions.filter(id => actions.includes(id));
                if (!actual.length)
                    continue;
                if (policy.id === 'conversation' || !policy.resources.some(resource => runtimeHash(resource) === runtimeHash(scene)))
                    throw new Error('HOST_EXECUTOR_RESOURCE_POLICY_REQUIRED');
                for (const id of actual.filter(id => id === 'dafeiyu_server_execute_owner' || id === 'dafeiyu_server_execute_autonomous')) {
                    if (!policy.externalActions?.some(grant => grant.extensionId === 'server-executor' && grant.actionId === id && grant.actionVersion === '1'))
                        throw new Error('HOST_EXECUTOR_EXTERNAL_POLICY_REQUIRED');
                    if (id === 'dafeiyu_server_execute_autonomous' && !settings.standingAuthority)
                        throw new Error('HOST_EXECUTOR_STANDING_AUTHORITY_REQUIRED');
                }
            }
        }
        const media = enabled.find(p => p.id === 'media'), mediaConfig = media ? MediaPluginConfigSchema.parse(media.config) : undefined;
        if (media) {
            if (!memory)
                throw new Error('HOST_MEDIA_MEMORY_REQUIRED');
            if (!memory.config.sourceTracking && !memory.config.compaction && config.context.compactionInputTokens === undefined)
                throw new Error('HOST_MEDIA_SOURCE_TRACKING_REQUIRED');
            if (mediaConfig?.vision && mediaConfig.vision.provider !== config.modelRoutes.chat.provider)
                throw new Error('HOST_MEDIA_MODEL_ROUTE_UNAVAILABLE');
        }
        if (enabled.some(p => p.id === 'bilibili') && !media)
            throw new Error('HOST_BILI_MEDIA_REQUIRED');
        const qqMedia = qq ? QqPluginConfigSchema.parse(qq.config).media : undefined;
        if (qqMedia?.enabled && !media)
            throw new Error('HOST_QQ_MEDIA_REQUIRED');
        if (qqMedia?.voiceDirectives && (!qqMedia.enabled || !QqPluginConfigSchema.parse(qq.config).tasks.enabled || !mediaConfig?.audio?.whisper || !mediaConfig.audio.events))
            throw new Error('HOST_QQ_VOICE_DEPENDENCY_REQUIRED');
        if (qqCapabilities) {
            if (!memory)
                throw new Error('HOST_QQ_MEMORY_REQUIRED');
            if (!memory.config.sourceTracking && !memory.config.compaction && config.context.compactionInputTokens === undefined)
                throw new Error('HOST_QQ_SOURCE_TRACKING_REQUIRED');
            const policy = config.authorityPolicies.find(policy => policy.id === 'conversation' && policy.producers.includes('channel-qq'));
            if (!policy || !policy.allowLocalWrite || QQ_ACTIONS.some(action => !policy.actions.includes(action)))
                throw new Error('HOST_QQ_CAPABILITY_POLICY_REQUIRED');
        }
        const qqTasks = qq && QqPluginConfigSchema.parse(qq.config).tasks;
        if (qqTasks?.enabled) {
            if (!qqCapabilities)
                throw new Error('HOST_QQ_TASK_DEPENDENCY_REQUIRED');
            const conversation = config.authorityPolicies.find(policy => policy.id === 'conversation' && policy.producers.includes('channel-qq'));
            const native = config.authorityPolicies.find(policy => policy.id === qqTasks.policyId && policy.producers.includes('qq-tasks'));
            if (!conversation || QQ_TASK_ACTIONS.some(action => !conversation.actions.includes(action)) || !native?.allowLocalWrite || ['dafeiyu_task_intent', 'dafeiyu_task_object'].some(action => !native.actions.includes(action)))
                throw new Error('HOST_QQ_TASK_POLICY_REQUIRED');
            if (qqTasks.explorationResources?.some(scene => !native.resources.some(allowed => runtimeHash(scene) === runtimeHash(allowed))))
                throw new Error('HOST_QQ_EXPLORATION_RESOURCE_DENIED');
        }
        if (config.context.regions['memory:growth'])
            throw new Error('HOST_GROWTH_CONFIG_CONFLICT');
        if (!hasMemory && config.authorityPolicies.length)
            throw new Error('HOST_TASK_REPOSITORY_REQUIRED');
        const descriptors = [{ id: 'core', provides: ['core.registration.v1', 'lifecycle.managed.v1', 'context.conversation.v1'], requires: ['llm.route.v1'] },
            ...enabled.map(plugin => ({ id: plugin.id, provides: plugin.id.startsWith('model-') ? ['llm.route.v1'] : plugin.id === 'timeline' ? ['timeline.history.v1'] : plugin.id === 'bilibili' ? ['bilibili.read.v1'] : plugin.id === 'server-executor' ? ['server.execution.v1'] : plugin.id === 'media' ? ['media.assets.v1', 'media.processing.v1'] : plugin.id === 'activity' ? ['activity.plan.v1', 'activity.wakeup.v1'] : plugin.id === 'memory' ? ['task.repository.v1', 'memory.execution.v1', 'persona.stage-state.v1', 'persona.growth-selection.v1', 'continuity.checkpoint.v1', 'task.intent.v1', 'memory.capability-observation.v1', 'memory.native-expression.v1', ...(memory?.config.maintenance ? ['memory.maintenance.v1'] : [])] : [`channel.${plugin.id === 'channel-qq' ? 'qq' : plugin.id === 'channel-bili-owner' ? 'bilibili-owner' : 'simulator'}.v1`],
                requires: [...(plugin.id.startsWith('model-') ? [] : ['core.registration.v1']), ...(plugin.id === 'memory' ? ['timeline.history.v1'] : []), ...(plugin.id === 'server-executor' ? ['execution.task.v1', 'memory.capability-observation.v1'] : []), ...(plugin.id === 'media' ? ['execution.task.v1', 'memory.capability-observation.v1'] : []), ...(plugin.id === 'bilibili' ? ['media.assets.v1', 'execution.task.v1', 'memory.capability-observation.v1'] : []), ...(plugin.id === 'activity' ? ['execution.task.v1', 'execution.source-anchor.v1', 'memory.execution.v1', ...(activityConfig?.maintenance ? ['memory.maintenance.v1'] : [])] : []), ...(plugin.id === 'channel-bili-owner' ? ['memory.capability-observation.v1', ...(biliOwnerConfig?.tasks.enabled ? ['bilibili.read.v1', 'media.assets.v1', 'execution.message-task.v1', ...(biliOwnerConfig.tasks.deliverResults ? ['memory.native-expression.v1', 'delivery.task-result.v1'] : [])] : [])] : []), ...(plugin.id === 'channel-qq' && qqCapabilities ? ['memory.capability-observation.v1', 'execution.resource-scope.v1'] : []), ...(plugin.id === 'channel-qq' && qqMedia?.enabled ? ['media.assets.v1'] : []), ...(plugin.id === 'channel-qq' && qqTasks?.enabled ? ['execution.message-task.v1', ...(qqTasks.deliverResults ? ['memory.native-expression.v1', 'delivery.task-result.v1'] : [])] : []), ...plugin.requires] })),
            ...(hasMemory ? [{ id: 'core-execution', provides: ['execution.task.v1', 'execution.source-anchor.v1', 'execution.wake-ingress.v1', 'context.task.v1', 'execution.resource-scope.v1', 'execution.message-task.v1', 'delivery.task-result.v1'], requires: ['task.repository.v1'] }] : [])];
        const order = dependencyOrder(descriptors);
        const foundation = readFoundation(paths.foundation);
        const declared = [file, ...[config.paths.core, config.paths.memory, config.paths.sessions, config.paths.query, ...Object.values(config.paths.channels), config.persona.fixedFile].map(path => resolve(base, path))];
        const prepared = { file, config, hash: runtimeHash({ config, paths, plugins }), foundation: { hash: foundation.version, identity: foundation.fileIdentity }, paths, plugins, order, resources,
            declarations: declared.map(path => ({ path, identity: pathIdentity(path) })) };
        freeze(prepared);
        return prepared;
    }
    catch (error) {
        if (error instanceof Error && /^HOST_[A-Z0-9_]+$/.test(error.message))
            throw error;
        if (error instanceof Error && error.message === 'FOUNDATION_INVALID')
            throw new Error('HOST_FOUNDATION_INVALID');
        if (error instanceof Error && /^DEPENDENCY_[A-Z0-9_]+$/.test(error.message))
            throw new Error('HOST_' + error.message);
        throw new Error('HOST_CONFIG_INVALID');
    }
}
export function pluginConfig(prepared, id) {
    // The key selects both the schema and the result; TypeScript cannot retain that generic correlation.
    const plugin = prepared.plugins.find(plugin => plugin.id === id && plugin.enabled);
    return plugin ? pluginSchemas[id].parse(plugin.config) : undefined;
}
