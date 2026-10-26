import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id';
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm';
import { DeepSeekAdapter, DeepSeekFileStore, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
import { z } from 'zod';
export const InlineModelSettingsSchema = z.strictObject({
    contextWindow: z.number().int().min(1024).max(2000000),
    maxOutputTokens: z.number().int().positive().max(256000),
    streamIdleTimeoutMs: z.number().int().min(100).max(300000).default(40000),
    maxInlineImageBytes: z.number().int().min(1024).max(20 * 1024 * 1024).default(8 * 1024 * 1024),
    maxImages: z.number().int().min(1).max(8).default(8),
}).refine(value => value.maxOutputTokens < value.contextWindow, 'Output reserve must be smaller than context');
/** Selects the official inline fallback before any Files index or network operation. */
export class InlineOnlyDeepSeekFiles extends DeepSeekFileStore {
    async ensureUploaded(...args) {
        args[3]?.throwIfAborted();
        throw new Error('HOST_INLINE_FILES_DISABLED');
    }
    async invalidate() { throw new Error('HOST_INLINE_FILES_DISABLED'); }
    async release() { throw new Error('HOST_INLINE_FILES_DISABLED'); }
    async reclaimOldestOwned() { throw new Error('HOST_INLINE_FILES_DISABLED'); }
    async releaseAll() { throw new Error('HOST_INLINE_FILES_DISABLED'); }
}
/** Public official adapter seam; no replacement protocol, model loop, global fetch patch or Files upload. */
export function inlineDeepSeekAdapter(dependencies) {
    const files = new InlineOnlyDeepSeekFiles();
    return new DeepSeekAdapter({ ...dependencies, resolveFiles: () => files });
}
export async function installInlineDeepSeek(ctx, input) {
    const settings = InlineModelSettingsSchema.parse(input.settings), effort = z.enum(['off', 'low', 'high', 'max']).parse(input.route.reasoningEffort);
    if (input.route.provider !== 'deepseek-official')
        throw new Error('HOST_INLINE_MODEL_ROUTE_INVALID');
    const base = resolveAdapterOptions({ baseURL: input.baseURL, thinking: effort === 'off' ? 'disabled' : 'enabled', reasoningEffort: effort,
        maxTokens: settings.maxOutputTokens, streamIdleTimeoutMs: settings.streamIdleTimeoutMs,
        maxInlineRequestImageBytes: settings.maxInlineImageBytes, maxRequestFilesBytes: settings.maxInlineImageBytes, maxImagesPerRequest: settings.maxImages,
        imageOffloadByteQuantum: settings.maxInlineImageBytes, inlineImageOffloadByteQuantum: settings.maxInlineImageBytes, imageOffloadCountQuantum: settings.maxImages,
        retryPolicy: { mode: 'normal', maxRetries: 0 } });
    const selected = base.models.find(model => model.id === input.route.model);
    if (!selected || !selected.inputModalities?.includes('image') || settings.maxOutputTokens > (selected.maxTokens ?? base.maxTokens))
        throw new Error('HOST_INLINE_MODEL_CATALOG_MISMATCH');
    // Keep the official context capacity. A caller cannot lower this declaration to under-reserve image input.
    const connection = { ...base, models: [{ ...selected, maxTokens: settings.maxOutputTokens }] };
    const ref = credentialRef(input.credentialName);
    const adapter = inlineDeepSeekAdapter({ options: () => connection, providerName: 'DeepSeek',
        admit: (_connection, model) => { input.credentialGuard(); if (model !== input.route.model)
            throw new LlmError('Fixed model route changed', 'HOST_INLINE_MODEL_ROUTE_INVALID'); },
        resolveAuth: async () => {
            input.credentialGuard();
            const service = ctx.get('credentials');
            if (!service)
                throw new Error('HOST_CREDENTIAL_REFERENCE_MISSING');
            const metadata = await service.describe(ref);
            if (!metadata.configured || metadata.source !== 'file')
                throw new Error('HOST_CREDENTIAL_REFERENCE_MISSING');
            const hit = await service.resolve(ref);
            if (!hit)
                throw new Error('HOST_CREDENTIAL_REFERENCE_MISSING');
            input.credentialGuard();
            return { headers: { 'x-api-key': assertUsableApiKey(hit.value, 'dafeiyu-inline', ref) } };
        }, resolveUserId: () => getOrCreateAnonymousUserId(), resolveAttachments: () => ctx.get('attachments'),
        resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, () => undefined, ref),
        prepareExtensions: async () => ({ fields: {}, accept: async () => { } }) });
    const info = await adapter.resolveModel(input.route.provider, input.route.model);
    if (info.context?.contextWindow !== settings.contextWindow || info.defaultMaxTokens !== settings.maxOutputTokens)
        throw new Error('HOST_INLINE_MODEL_CAPACITY_MISMATCH');
    ctx.llm.registerAdapter([input.route.provider], adapter);
    // Auxiliary runtimes call host.llm.stream directly; their adapter preparation occurs inside this waterfall.
    ctx.on('llm/stream', async function* (_request, next) { input.credentialGuard(); yield* next(); }, { global: true, prepend: true });
}
