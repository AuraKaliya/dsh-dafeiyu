import { randomUUID, createHash } from 'node:crypto';
import { MediaReplyDraftInputSchema, ReplyMediaManifestSchema, NativeMediaMaterialSchema } from '#dafeiyu/contracts';
import { mediaHash } from './store.js';
import { mediaDraftContentSchema } from './reply-store.js';
function filename(source, asset) {
    let name = (source.name ?? 'attachment-' + asset.id.slice(0, 8) + '.bin').normalize('NFKC').replace(/[\\/:\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 160);
    if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
        name = 'attachment-' + asset.id.slice(0, 8) + '.bin';
    return name;
}
export class MediaReplies {
    host;
    constructor(host) {
        this.host = host;
    }
    write(context, owner) { if (!this.host.ready())
        throw new Error('MEDIA_NOT_CONFIGURED'); const access = this.host.ctx.dafeiyu.personaAccess(context, owner, 'local-write'); if (!access.historyTracked)
        throw new Error('HISTORY_UNTRACKED'); return access; }
    async prepare(context, raw, owner = 'media') {
        const input = MediaReplyDraftInputSchema.parse(raw), access = this.write(context, owner), temporary = [];
        const parts = [];
        let persisted = false;
        try {
            for (const [index, part] of input.parts.entries()) {
                if (part.kind === 'final-voice') {
                    if (!this.host.speech)
                        throw new Error('MEDIA_TTS_NOT_CONFIGURED');
                    parts.push({ kind: 'final-voice', voiceHash: this.host.speech.hash });
                    continue;
                }
                const as = part.as ?? (part.asset.kind === 'image' ? 'image' : part.asset.kind === 'audio' ? 'record' : 'file');
                const prepared = await this.host.prepareAsset(context, part.asset, as, 'reply:' + mediaHash([input.requestId, input.expectedVersion, index]), owner);
                access.guard();
                if (prepared.asset.bytes > 16 * 1024 ** 2)
                    throw new Error('MEDIA_SIZE_LIMIT');
                parts.push({ kind: 'asset', ...prepared, as });
                const mediaAccess = this.host.ctx.dafeiyu.mediaAccess(context, owner, prepared.source.origin);
                temporary.push(this.host.store.lease(mediaAccess, prepared.asset, 'draft-preparing', Date.now() + 3600000));
            }
            if (parts.reduce((n, p) => n + (p.kind === 'asset' ? p.asset.bytes : 0), 0) > 32 * 1024 ** 2)
                throw new Error('MEDIA_SIZE_LIMIT');
            const content = mediaDraftContentSchema.parse({ schemaVersion: 1, runId: access.view.runId, scope: access.view.scope, taskEpoch: access.intentVersion, parts });
            const authority = this.host.ctx.dafeiyu.captureMediaReplyAuthority(context, owner, mediaHash(content)), before = this.host.store.replies.current(context.runId)?.draft;
            const draft = this.host.store.replies.prepare(access, { requestId: input.requestId, expectedVersion: input.expectedVersion, content, authority });
            persisted = true;
            // Each immutable selection has bounded pins; replacing/cancelling only releases that selection's pins.
            for (const part of draft.parts)
                if (part.kind === 'asset') {
                    const mediaAccess = this.host.ctx.dafeiyu.mediaAccess(context, owner, part.source.origin);
                    this.host.store.ensureLease(mediaAccess, part.asset, 'media-draft:' + draft.id, Date.now() + 3600000);
                }
            if (before && before.id !== draft.id)
                this.host.store.releaseLeases('media-draft:' + before.id);
            const current = this.host.store.replies.current(context.runId).draft;
            return { draftId: draft.id, version: draft.version, currentDraftId: current.id, currentVersion: current.version, selected: current.parts.length, cancelled: !current.parts.length };
        }
        catch (error) {
            if (persisted)
                throw new Error('MEDIA_DRAFT_PREPARATION_INCOMPLETE');
            throw error;
        }
        finally {
            for (const id of temporary)
                this.host.store.releaseLease(id, 'draft-preparing');
        }
    }
    status(context) { this.host.ctx.dafeiyu.executionAuthority(context, 'media'); const value = this.host.store.replies.current(context.runId); return value ? { draftId: value.draft.id, version: value.draft.version, selected: value.draft.parts.length, frozen: value.frozen } : { draftId: null, version: 0, selected: 0, frozen: false }; }
    pending(runId) { const value = this.host.store.replies.current(runId); return value ? { id: value.draft.id, version: value.draft.version, selected: value.draft.parts.length, authority: value.draft.authority } : null; }
    native(access) {
        const current = this.host.store.replies.current(access.execution.view.runId);
        if (!current || !current.draft.parts.length) {
            access.guard();
            return null;
        }
        const draft = current.draft;
        const payload = this.host.ctx.dafeiyu.validateNativeMediaReplyAuthority(draft.authority, access);
        if (payload !== mediaHash(mediaDraftContentSchema.strip().parse(draft)))
            throw new Error('MEDIA_DRAFT_AUTHORITY_MISMATCH');
        const parts = draft.parts.map(part => {
            if (part.kind !== 'asset') {
                if (!this.host.speech || part.voiceHash !== this.host.speech.hash)
                    throw new Error('MEDIA_TTS_CONFIG_CHANGED');
                return { kind: 'final-voice' };
            }
            const guard = () => { access.execution.guard(); if (!access.execution.resourceAllowed?.(part.source.origin.scene) || !this.host.sourceCurrent(part.source) || !part.source.publicContent && mediaHash(part.source.origin.scene) !== mediaHash(access.anchor.target))
                throw new Error('MEDIA_TARGET_DENIED'); };
            guard();
            const stored = this.host.store.assetWitness(part.asset);
            if (mediaHash(stored.scope) !== mediaHash(access.execution.view.scope) || stored.taskEpoch !== access.execution.intentVersion)
                throw new Error('SCOPE_DENIED');
            guard();
            const delivery = part.as ?? (part.asset.kind === 'image' ? 'image' : part.asset.kind === 'audio' ? 'record' : 'file');
            return { kind: 'asset', delivery, asset: part.asset, name: delivery === 'file' ? filename(part.source, part.asset) : null };
        });
        const fence = this.fence(access.execution, access.anchor.target, draft);
        access.guard();
        return NativeMediaMaterialSchema.parse({ draftId: draft.id, draftVersion: draft.version, parts, sourceStamp: mediaHash({ authority: draft.authority, content: mediaDraftContentSchema.strip().parse(draft), target: access.anchor.target, fence: fence.stamp }) });
    }
    fence(execution, target, draft) { const fence = this.host.ctx.dafeiyu.mediaExpressionFence(execution, target, [...new Set(draft.parts.flatMap(p => p.kind === 'asset' ? p.source.origin.roots : []))]); if (!fence.allowed)
        throw new Error('MEDIA_SOURCE_SUPPRESSED'); return fence; }
    access(access) {
        this.host.ctx.dafeiyu.validateMediaReplyAccess(access);
        if (!this.host.ready())
            throw new Error('MEDIA_NOT_CONFIGURED');
        const current = this.host.store.replies.current(access.execution.view.runId);
        if (!current || mediaHash(current.draft.authority) !== mediaHash(access.authority) || mediaHash(mediaDraftContentSchema.strip().parse(current.draft)) !== access.payloadHash)
            throw new Error('MEDIA_DRAFT_AUTHORITY_MISMATCH');
        const fence = this.fence(access.execution, access.target, current.draft);
        if (current.draft.scope.kind === 'task' && (!access.approvedMedia || access.approvedMedia.draftId !== current.draft.id || access.approvedMedia.draftVersion !== current.draft.version || access.approvedMedia.sourceStamp !== mediaHash({ authority: current.draft.authority, content: mediaDraftContentSchema.strip().parse(current.draft), target: access.target, fence: fence.stamp })))
            throw new Error('MEDIA_NATIVE_DELIVERY_NOT_CONFIGURED');
        return current.draft;
    }
    partAccess(access, source) { const guard = () => { this.host.ctx.dafeiyu.validateMediaReplyAccess(access); if (!this.host.sourceCurrent(source) || !source.publicContent && mediaHash(source.origin.scene) !== mediaHash(access.target))
        throw new Error('MEDIA_TARGET_DENIED'); }; guard(); return { execution: access.execution, origin: source.origin, guard }; }
    frozenBinding(access, draft, manifest) {
        const { credential, ...body } = manifest;
        if (manifest.replyId !== access.replyId || manifest.runId !== access.execution.view.runId || manifest.draft.id !== draft.id || manifest.draft.version !== draft.version || mediaHash(manifest.target) !== mediaHash(access.target) || manifest.sourceMessageId !== access.sourceMessageId || mediaHash(manifest.anchor) !== mediaHash(access.anchor)
            || manifest.textHash !== createHash('sha256').update(access.text).digest('hex') || manifest.expiresAt !== access.expiresAt || manifest.sourceStamp !== mediaHash({ authority: access.authority, parts: draft.parts, fence: this.fence(access.execution, access.target, draft).stamp }) || credential !== mediaHash(body) || manifest.parts.length !== draft.parts.length)
            throw new Error('MEDIA_EXPORT_BINDING_INVALID');
        for (const [i, selected] of draft.parts.entries()) {
            if (selected.kind !== 'asset') {
                if (!this.host.speech || !selected.voiceHash || manifest.parts[i]?.kind !== 'record')
                    throw new Error('MEDIA_TTS_NOT_CONFIGURED');
                this.host.speech.verify(access, selected.voiceHash, manifest.parts[i].asset);
                continue;
            }
            const kind = selected.as ?? (selected.asset.kind === 'image' ? 'image' : selected.asset.kind === 'audio' ? 'record' : 'file');
            const expected = kind === 'file' ? { kind, asset: selected.asset, name: filename(selected.source, selected.asset) } : { kind, asset: selected.asset };
            if (mediaHash(manifest.parts[i]) !== mediaHash(expected))
                throw new Error('MEDIA_EXPORT_BINDING_INVALID');
        }
    }
    async finalize(access) {
        const draft = this.access(access);
        if (!draft.parts.length)
            return null;
        const old = this.host.store.replies.exported(access.replyId);
        if (old) {
            this.frozenBinding(access, draft, old.manifest);
            if (old.state !== 'ready')
                throw new Error('MEDIA_EXPORT_STATE_CONFLICT');
            for (const [index, part] of draft.parts.entries()) {
                const source = part.kind === 'asset' ? part.source : this.host.speech.verify(access, part.voiceHash, old.manifest.parts[index].asset), asset = old.manifest.parts[index].asset, scope = this.partAccess(access, source);
                this.host.store.requireRef(scope, asset);
                await this.host.files.verified(asset);
                scope.guard();
            }
            this.access(access);
            return old.manifest;
        }
        const parts = [], leases = [], id = randomUUID(), owner = 'media-export:' + id;
        let frozen = false;
        try {
            for (const selected of draft.parts) {
                const prepared = selected.kind === 'asset' ? selected : await this.speech(access, selected.voiceHash), scope = this.partAccess(access, prepared.source);
                this.host.store.requireRef(scope, prepared.asset);
                await this.host.files.verified(prepared.asset);
                scope.guard();
                const kind = selected.kind === 'final-voice' ? 'record' : selected.as ?? (selected.asset.kind === 'image' ? 'image' : selected.asset.kind === 'audio' ? 'record' : 'file');
                parts.push(kind === 'file' ? { kind, asset: prepared.asset, name: filename(prepared.source, prepared.asset) } : { kind, asset: prepared.asset });
                leases.push({ id: this.host.store.lease(scope, prepared.asset, owner, Date.parse(access.expiresAt)), owner });
            }
            const fields = { schemaVersion: 1, id, replyId: access.replyId, runId: access.execution.view.runId, target: access.target, sourceMessageId: access.sourceMessageId, anchor: access.anchor, textHash: createHash('sha256').update(access.text).digest('hex'), draft: { id: draft.id, version: draft.version }, parts,
                sourceStamp: mediaHash({ authority: access.authority, parts: draft.parts, fence: this.fence(access.execution, access.target, draft).stamp }), expiresAt: access.expiresAt };
            const manifest = ReplyMediaManifestSchema.parse({ ...fields, credential: mediaHash(fields) });
            this.host.store.replies.freeze(draft, manifest, leases, () => { this.access(access); this.frozenBinding(access, draft, manifest); for (const part of draft.parts)
                if (part.kind === 'asset')
                    this.partAccess(access, part.source).guard(); });
            frozen = true;
            this.host.store.releaseLeases('media-draft:' + draft.id);
            return manifest;
        }
        finally {
            if (!frozen)
                for (const lease of leases)
                    this.host.store.releaseLease(lease.id, lease.owner);
        }
    }
    async bytes(access, manifestId, position) {
        const draft = this.access(access), exported = this.host.store.replies.exported(access.replyId);
        if (!exported || exported.state !== 'ready' || exported.manifest.id !== manifestId || exported.manifest.draft.id !== draft.id || !Number.isSafeInteger(position) || position < 0)
            throw new Error('MEDIA_EXPORT_UNAVAILABLE');
        this.frozenBinding(access, draft, exported.manifest);
        const selected = draft.parts[position], part = exported.manifest.parts[position];
        if (!selected || !part || selected.kind === 'asset' && mediaHash(part.asset) !== mediaHash(selected.asset))
            throw new Error('MEDIA_EXPORT_BINDING_INVALID');
        const source = selected.kind === 'asset' ? selected.source : this.host.speech.verify(access, selected.voiceHash, part.asset), scope = this.partAccess(access, source);
        this.host.store.requireRef(scope, part.asset);
        const data = await this.host.files.bytes(part.asset, access.execution.view.signal, scope.guard);
        this.validate(access, manifestId);
        return data;
    }
    validate(access, id) {
        const draft = this.access(access), exported = this.host.store.replies.exported(access.replyId);
        if (!exported || exported.manifest.id !== id || exported.state !== 'ready')
            throw new Error('MEDIA_EXPORT_UNAVAILABLE');
        this.frozenBinding(access, draft, exported.manifest);
        for (const [index, part] of draft.parts.entries()) {
            const asset = exported.manifest.parts[index].asset, source = part.kind === 'asset' ? part.source : this.host.speech.verify(access, part.voiceHash, asset);
            this.host.store.requireRef(this.partAccess(access, source), asset);
        }
    }
    settle(access, id, state) {
        if (!this.host.ctx.dafeiyu.ownsMediaReplyAccess(access))
            throw new Error('SCOPE_DENIED');
        const exported = this.host.store.replies.exported(access.replyId);
        if (!exported || exported.manifest.id !== id)
            throw new Error('MEDIA_EXPORT_BINDING_INVALID');
        this.host.store.replies.settle(access.replyId, state);
        for (const lease of exported.leases)
            this.host.store.releaseLease(lease.id, lease.owner);
        this.host.speech?.release(access);
    }
    speech(access, hash) { if (!this.host.speech || !hash)
        throw new Error('MEDIA_TTS_NOT_CONFIGURED'); return this.host.speech.prepare(access, hash); }
}
