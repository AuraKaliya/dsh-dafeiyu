import { z } from 'zod';
import { MemoryStore } from './store.js';
import { memoryRef, memoryRefPattern } from './types.js';
import { AnalysisError } from './analysis-types.js';
export class AnalysisSources {
    ctx;
    store;
    constructor(ctx, store) {
        this.ctx = ctx;
        this.store = store;
    }
    scope(grantId) {
        try {
            return this.ctx.dafeiyu.analysisScope(grantId);
        }
        catch {
            throw new AnalysisError('authorization_unavailable');
        }
    }
    async read(grantId, ref, sourceId, signal) {
        const scope = this.scope(grantId);
        signal.throwIfAborted();
        const match = memoryRefPattern.exec(ref);
        if (match) {
            const item = this.store.read(scope, match[1], 'normal', Number(match[2]));
            if (!item)
                throw new AnalysisError('source_unavailable');
            return { sourceId, evidence: { kind: 'memory', id: item.id, revision: item.revision, contentHash: item.contentHash },
                text: item.content, origin: 'memory', version: item.version };
        }
        let text = '', offset = 0, hash = '', kind = '', resolved = ref;
        for (let page = 0; page < 16; page++) {
            let result = await this.ctx.dafeiyuTimeline.openForAnalysis(grantId, { ref: resolved, offset, limit: 8000 }, signal);
            if (result.status === 'redirect') {
                resolved = result.ref;
                result = await this.ctx.dafeiyuTimeline.openForAnalysis(grantId, { ref: resolved, offset, limit: 8000 }, signal);
            }
            if (result.status !== 'ok' || result.memoryUse !== 'primary-candidate' || result.interrupted)
                throw new AnalysisError('source_unavailable');
            if (result.totalChars > 12000)
                throw new AnalysisError('input_too_large');
            if (hash && hash !== result.contentHash)
                throw new AnalysisError('source_changed');
            hash = result.contentHash;
            kind = result.kind;
            text += result.text;
            if (!result.hasMore)
                break;
            if (result.nextOffset === null || page === 15)
                throw new AnalysisError('input_too_large');
            offset = result.nextOffset;
        }
        if (this.store.suppressedEvidence(scope, hash))
            throw new AnalysisError('deleted_source');
        const evidence = { kind: 'timeline', ref, contentHash: hash };
        if (kind === 'normalized-inbound') {
            const data = z.object({ sender: z.object({ id: z.string() }), text: z.string() }).parse(JSON.parse(text));
            return { sourceId, evidence, text: data.text, origin: 'user', authorId: data.sender.id };
        }
        return { sourceId, evidence, text, origin: kind === 'tool-result-text' ? 'tool' : 'event' };
    }
    async validate(grantId, sources, signal) {
        for (const source of sources) {
            const ref = source.evidence.kind === 'memory' ? memoryRef(source.evidence.id, source.evidence.revision) : source.evidence.ref;
            const current = await this.read(grantId, ref, source.sourceId, signal);
            if (current.evidence.contentHash !== source.evidence.contentHash || current.version !== source.version)
                throw new AnalysisError('source_changed');
        }
        signal.throwIfAborted();
        return this.scope(grantId);
    }
}
