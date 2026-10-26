import { z } from 'zod';
import { createHash } from 'node:crypto';
import { mediaHash } from './store.js';
import { SystemSpeech } from './tts.js';
export const replySpeechConfigSchema = z.strictObject({ powershell: z.string().min(1), voice: z.string().min(1).max(200) });
export class ReplySpeech {
    ctx;
    store;
    files;
    hash;
    engine;
    bindings = new Map();
    constructor(ctx, store, files, settings, worker) {
        this.ctx = ctx;
        this.store = store;
        this.files = files;
        this.hash = mediaHash(settings);
        this.engine = new SystemSpeech(files.work, settings, worker);
    }
    binding(access, expected) {
        this.ctx.dafeiyu.validateMediaReplyAccess(access);
        if (expected !== this.hash)
            throw new Error('MEDIA_TTS_CONFIG_CHANGED');
        for (const [key, value] of this.bindings)
            if (!this.ctx.dafeiyu.ownsMediaReplyAccess(value.owner))
                this.bindings.delete(key);
        const textHash = createHash('sha256').update(access.text).digest('hex'), key = 'reply-text:' + mediaHash([access.replyId, textHash, this.hash]), old = this.bindings.get(key);
        if (!old && this.bindings.size >= 256)
            throw new Error('MEDIA_TTS_CAPACITY');
        const source = { ref: { provider: 'media', key }, kind: 'audio', name: 'reply.wav', mimeHint: 'audio/wav', bytesHint: null, durationMsHint: null, rangeReadable: false, publicContent: false,
            origin: { provider: 'media', scene: access.target, key, version: 1, hash: mediaHash({ replyId: access.replyId, textHash, voice: this.hash, authority: access.authority }), roots: ['core:reply:' + access.replyId], detail: { kind: 'approved-reply-text', replyId: access.replyId, textHash, voiceHash: this.hash } } };
        const guard = () => { this.ctx.dafeiyu.validateMediaReplyAccess(access); if (this.bindings.get(key)?.owner !== access)
            throw new Error('MEDIA_TTS_ACCESS_EXPIRED'); };
        this.bindings.set(key, { owner: access, source, guard });
        return { source, guard, textHash };
    }
    describe(key) { const found = this.bindings.get(key); if (!found)
        return null; try {
        found.guard();
        return found.source;
    }
    catch {
        return null;
    } }
    current(proof) { const source = this.describe(proof.key); return !!source && mediaHash(source.origin) === mediaHash(proof); }
    source(access, expected) { return this.binding(access, expected).source; }
    async prepare(access, expected) {
        const binding = this.binding(access, expected), scoped = { execution: access.execution, origin: binding.source.origin, guard: binding.guard }, source = this.store.rememberSource(scoped, binding.source);
        const key = 'tts:' + mediaHash([access.replyId, binding.textHash, expected]), processingHash = mediaHash(['approved-speech-v1', binding.textHash, expected]), reservation = this.store.reserve(scoped, key, source, processingHash), prior = this.store.read(scoped, reservation.id);
        if (prior.state === 'ready') {
            const asset = this.store.ref(prior);
            await this.files.verified(asset);
            binding.guard();
            return { asset, source: binding.source };
        }
        if (prior.state !== 'staging')
            throw new Error('MEDIA_TTS_PREVIOUS_ATTEMPT_INCOMPLETE');
        try {
            const rendered = await this.engine.synthesize({ text: access.text, textHash: binding.textHash, guard: binding.guard }, access.execution.view.signal);
            binding.guard();
            const asset = await this.files.ingest(scoped, key, source, { bytes: rendered.data.length, mime: rendered.mime, stream: (async function* () { yield rendered.data; })() }, access.execution.view.signal, { kind: 'audio', processingHash,
                coverage: { acquiredBytes: rendered.data.length, processed: [], exposed: false, gaps: ['由已批准最终正文合成；不是外部声音观察'], completeness: 'unknown' } });
            return { asset, source: binding.source };
        }
        catch (error) {
            this.store.abandon(scoped, reservation.id, 'MEDIA_TTS_PREPARATION_FAILED');
            throw error;
        }
    }
    verify(access, expected, asset) {
        const { source, textHash } = this.binding(access, expected), record = this.store.assetWitness(asset), actual = this.store.source(record.sourceId);
        if (record.parent !== null || record.kind !== 'audio' || record.mime !== 'audio/wav' || record.processingHash !== mediaHash(['approved-speech-v1', textHash, expected]) || mediaHash(actual.description) !== mediaHash(source))
            throw new Error('MEDIA_TTS_BINDING_INVALID');
        return source;
    }
    release(access) { for (const [key, value] of this.bindings)
        if (value.owner === access)
            this.bindings.delete(key); }
    close() { this.bindings.clear(); }
}
