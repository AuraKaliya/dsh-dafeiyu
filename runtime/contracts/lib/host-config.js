import { z } from 'zod';
import { FeatureSchema, ExtensionIdSchema } from './execution.js';
import { ConversationSchema } from './conversation.js';
import { ExternalActionPoliciesSchema } from './external-execution.js';
const path = z.string().trim().min(1).max(4096);
const route = z.strictObject({ provider: z.string().min(1).max(120), model: z.string().min(1).max(160), reasoningEffort: z.string().min(1).max(40).optional() });
export const HostConfigSchema = z.strictObject({
    schemaVersion: z.literal(1), profileId: ExtensionIdSchema,
    agent: z.strictObject({ id: z.string().min(1).max(100) }),
    paths: z.strictObject({ core: path, memory: path, sessions: path, query: path, channels: z.record(ExtensionIdSchema, path).default({}) }),
    modelRoutes: z.strictObject({ chat: route, probes: z.partialRecord(z.enum(['vision', 'asr', 'audio-events']), route).optional() }),
    plugins: z.array(z.strictObject({ id: ExtensionIdSchema, enabled: z.boolean().default(true), required: z.boolean().default(false),
        requires: z.array(FeatureSchema).max(64).default([]), config: z.record(z.string(), z.json()).default({}) })).max(64),
    runtime: z.strictObject({ maxConcurrentRuns: z.number().int().min(1).max(16).default(2), maxConcurrentPerTask: z.literal(1).default(1),
        maxConcurrentPerSession: z.literal(1).default(1), maxPendingRuns: z.number().int().min(1).max(1000).default(100),
        turnTimeoutMs: z.number().int().min(50).max(3600000).default(600000), shutdownGraceMs: z.number().int().min(50).max(300000).default(30000) }).prefault({}),
    persona: z.strictObject({ fixedFile: path, kind: z.enum(['test', 'formal']),
        growthRegion: z.strictObject({ maxBytes: z.number().int().min(0).max(32000).default(4000), priority: z.number().int().min(0).max(1000).default(400) }).prefault({}) }),
    context: z.strictObject({ maxBytes: z.number().int().min(0).max(256000).default(16000),
        requestMaxBytes: z.number().int().min(1000).max(2000000).default(1000000), prepareTimeoutMs: z.number().int().min(50).max(30000).default(5000),
        outputReserveBytes: z.number().int().min(0).max(256000).default(16000),
        regions: z.record(z.string().min(1).max(160), z.strictObject({ maxBytes: z.number().int().min(0).max(128000).default(4000),
            priority: z.number().int().min(0).max(1000).default(100), required: z.boolean().default(false) })).default({}),
        compactionInputTokens: z.number().int().min(2048).max(1000000).optional() }).prefault({}),
    authorityPolicies: z.array(z.strictObject({ id: ExtensionIdSchema, producers: z.array(ExtensionIdSchema).min(1).max(64),
        actions: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(128), allowLocalWrite: z.boolean().default(false),
        externalActions: ExternalActionPoliciesSchema.optional(),
        sourceRules: z.array(ExtensionIdSchema).max(64).default([]), resources: z.array(ConversationSchema).max(64).default([]) })).max(64).default([]),
    diagnostics: z.strictObject({ snapshotIntervalMs: z.number().int().min(100).max(60000).default(2000) }).prefault({}),
}).superRefine((value, ctx) => {
    for (const [name, ids] of [['plugins', value.plugins.map(p => p.id)], ['authorityPolicies', value.authorityPolicies.map(p => p.id)]])
        if (new Set(ids).size !== ids.length)
            ctx.addIssue({ code: 'custom', message: `Duplicate ${name}` });
});
