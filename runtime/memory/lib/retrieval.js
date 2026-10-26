import { resolve } from 'node:path';
import { MemoryStore } from './store.js';
import { loadProfile, digest, recallSchema, retrievalConfigSchema, RetrievalError, validateVector } from './retrieval-profile.js';
import { LocalTokenizer, LoopbackEmbedder } from './retrieval-clients.js';
import { RetrievalIndex, lexicalTokens, lexicalRank } from './retrieval-index.js';
/** Index membership is derived from authorized live memory, never from vector cache membership. */
export class MemoryRetrieval {
    memory;
    profile;
    index;
    config;
    dependencies;
    stop = new AbortController();
    closed = false;
    constructor(memory, dataDir, raw, dependencies) {
        this.memory = memory;
        this.config = retrievalConfigSchema.parse(raw);
        this.profile = loadProfile(this.config.profileFile);
        this.index = new RetrievalIndex(resolve(dataDir, 'retrieval.sqlite'), this.config.maxCacheEntries);
        this.dependencies = dependencies ?? {
            tokenizer: new LocalTokenizer(this.config, this.profile.profile, this.profile.workerHash),
            embedder: new LoopbackEmbedder(this.config, this.profile.profile),
        };
    }
    validateChunks(memory, chunks) {
        const points = Array.from(memory.content);
        let end = 0;
        if (!chunks.length || chunks.length > 1000)
            throw new RetrievalError('tokenizer_unavailable');
        for (const chunk of chunks) {
            if (chunk.start !== end || chunk.end <= chunk.start || chunk.end > points.length
                || points.slice(chunk.start, chunk.end).join('') !== chunk.text || chunk.tokens > this.profile.profile.chunkTokens
                || Array.from(chunk.text).length > this.profile.profile.chunkChars)
                throw new RetrievalError('tokenizer_unavailable');
            end = chunk.end;
        }
        if (end !== points.length)
            throw new RetrievalError('tokenizer_unavailable');
    }
    live(scope, chunk, view) {
        const memory = this.memory.read(scope, chunk.memoryId, 'normal', chunk.revision, view.purpose);
        if (!memory || !view.accepts(memory) || memory.contentHash !== chunk.memoryHash || Array.from(memory.content).slice(chunk.start, chunk.end).join('') !== chunk.text)
            return null;
        return memory;
    }
    async reconcile(scope, generation, signal, guard, view) {
        const previous = this.index.rows(view.cacheScope, this.profile.hash, this.config.maxChunks + 1);
        const oversized = previous.length > this.config.maxChunks;
        const existing = oversized ? [] : previous;
        if (!oversized && this.index.snapshot(view.cacheScope, this.profile.hash) === generation) {
            const verified = new Map();
            const visible = existing.filter(row => {
                const key = `${row.memoryId}:${row.revision}`;
                if (!verified.has(key)) {
                    const memory = this.memory.read(scope, row.memoryId, 'normal', row.revision, view.purpose);
                    verified.set(key, memory && view.accepts(memory) ? { memory, points: Array.from(memory.content) } : null);
                }
                const value = verified.get(key);
                return !!value && value.memory.contentHash === row.memoryHash && value.points.slice(row.start, row.end).join('') === row.text;
            });
            if (new Set(visible.map(row => row.memoryId)).size > this.config.maxDocuments)
                throw new RetrievalError('capacity_exceeded');
            return visible;
        }
        const rows = [];
        const current = [];
        for (const memory of this.memory.current(scope, view.purpose)) {
            if (!view.accepts(memory))
                continue;
            current.push(memory);
            if (current.length > this.config.maxDocuments)
                throw new RetrievalError('capacity_exceeded');
        }
        for (const memory of current) {
            guard();
            const cached = existing.filter(row => row.memoryId === memory.id && row.revision === memory.revision && row.memoryHash === memory.contentHash);
            let chunks;
            try {
                this.validateChunks(memory, cached);
                chunks = cached;
            }
            catch {
                chunks = await this.dependencies.tokenizer.chunks(memory.content, signal);
                guard();
                this.validateChunks(memory, chunks);
            }
            for (const chunk of chunks) {
                const key = digest(JSON.stringify([view.cacheScope.agentId, view.cacheScope.route, this.profile.hash, memory.id, memory.revision, memory.contentHash, chunk.start, chunk.end, chunk.text]));
                rows.push({ ...chunk, key, memoryId: memory.id, revision: memory.revision, memoryHash: memory.contentHash, terms: lexicalTokens(chunk.text).join(' '), order: rows.length });
            }
            if (rows.length > this.config.maxChunks)
                throw new RetrievalError('capacity_exceeded');
        }
        guard();
        this.index.replace(view.cacheScope, this.profile.hash, this.profile.definition, generation, rows);
        return rows;
    }
    async recall(scope, raw, signal, authorize) {
        return this.run(scope, raw, signal, authorize, { purpose: 'expression', cacheScope: scope, accepts: () => true });
    }
    /** Trusted task executor only; model-facing recall cannot choose purpose or namespace. */
    async recallInternal(scope, partition, accepts, raw, signal, authorize) {
        return this.run(scope, raw, signal, authorize, { purpose: 'internal', cacheScope: { agentId: scope.agentId, route: `$task-internal:${digest(JSON.stringify([scope.route, partition]))}` }, accepts });
    }
    async run(scope, raw, signal, authorize, view) {
        const input = recallSchema.parse(raw);
        const active = AbortSignal.any([signal, this.stop.signal]);
        const generation = this.memory.generation(scope);
        const guard = () => {
            authorize();
            active.throwIfAborted();
            if (this.closed)
                throw new RetrievalError('closed');
            if (generation !== this.memory.generation(scope))
                throw new RetrievalError('stale_state');
        };
        guard();
        if (input.rebuild)
            this.index.invalidate(view.cacheScope, this.profile.hash);
        const rows = await this.reconcile(scope, generation, active, guard, view);
        guard();
        const matches = input.strategy === 'semantic' ? new Set() : this.index.lexicalMatches(view.cacheScope, this.profile.hash, input.query);
        const lexical = input.strategy === 'semantic' ? [] : lexicalRank(rows, input.query, matches);
        let dense = [];
        let degraded = null;
        const stats = { cacheHits: 0, vectorsComputed: 0 };
        if (input.strategy !== 'lexical' && rows.some(row => row.text.trim())) {
            try {
                const query = await this.dependencies.tokenizer.query(input.query, active);
                guard();
                if (query.text !== this.profile.profile.queryPrefix + input.query || query.tokens > 512)
                    throw new RetrievalError('profile_mismatch');
                const documentVectors = new Map();
                const missing = [];
                for (const row of rows.filter(row => row.text.trim())) {
                    guard();
                    const cached = this.index.getVector(view.cacheScope, this.profile.hash, 'document', row.text);
                    if (cached) {
                        stats.cacheHits++;
                        documentVectors.set(row.key, cached);
                    }
                    else
                        missing.push(row);
                }
                for (let offset = 0; offset < missing.length;) {
                    const batch = [];
                    let chars = 0;
                    while (offset < missing.length && batch.length < 8) {
                        const row = missing[offset];
                        const count = Array.from(row.text).length;
                        if (batch.length && chars + count > 24000)
                            break;
                        batch.push(row);
                        chars += count;
                        offset++;
                    }
                    guard();
                    const vectors = await this.dependencies.embedder.embed(batch.map(row => row.text), active);
                    guard();
                    if (vectors.length !== batch.length)
                        throw new RetrievalError('invalid_vector');
                    vectors.forEach((rawVector, index) => {
                        const vector = validateVector(rawVector), row = batch[index];
                        this.index.putVector(view.cacheScope, this.profile.hash, 'document', row.text, vector);
                        documentVectors.set(row.key, vector);
                        stats.vectorsComputed++;
                    });
                }
                let queryVector = this.index.getVector(view.cacheScope, this.profile.hash, 'query', query.text);
                if (queryVector)
                    stats.cacheHits++;
                else {
                    guard();
                    const values = await this.dependencies.embedder.embed([query.text], active);
                    guard();
                    if (values.length !== 1)
                        throw new RetrievalError('invalid_vector');
                    queryVector = validateVector(values[0]);
                    this.index.putVector(view.cacheScope, this.profile.hash, 'query', query.text, queryVector);
                    stats.vectorsComputed++;
                }
                const vector = queryVector;
                dense = rows.filter(row => documentVectors.has(row.key)).map(row => ({ row,
                    score: documentVectors.get(row.key).reduce((sum, value, index) => sum + value * vector[index], 0) })).sort((a, b) => b.score - a.score || a.row.order - b.row.order);
            }
            catch (error) {
                guard();
                if (!(error instanceof RetrievalError) || !['embedding_unavailable', 'invalid_vector', 'profile_mismatch'].includes(error.code) || input.strategy === 'semantic')
                    throw error;
                degraded = error.code;
            }
        }
        guard();
        const used = degraded ? 'lexical' : input.strategy;
        let ranked = used === 'semantic' ? dense : lexical;
        if (used === 'hybrid') {
            const combined = new Map();
            for (const list of [lexical, dense])
                list.forEach((entry, index) => {
                    const previous = combined.get(entry.row.key);
                    combined.set(entry.row.key, { row: entry.row, score: (previous?.score ?? 0) + 1 / (60 + index + 1) });
                });
            ranked = [...combined.values()].sort((a, b) => b.score - a.score || a.row.order - b.row.order);
        }
        const seen = new Set();
        const items = [];
        for (const entry of ranked) {
            if (seen.has(entry.row.memoryId))
                continue;
            const memory = this.live(scope, entry.row, view);
            if (!memory)
                continue;
            seen.add(memory.id);
            const preview = Array.from(entry.row.text).slice(0, 600).join('');
            items.push({ id: memory.id, ref: memory.ref, revision: memory.revision, version: memory.version, contentHash: memory.contentHash,
                sources: memory.sources, sourceVersions: memory.sourceVersions, boundary: memory.boundary, effectiveAccess: memory.effectiveAccess, score: entry.score,
                chunk: { key: entry.row.key, start: entry.row.start, end: entry.row.end, tokens: entry.row.tokens, offsetUnit: 'unicode-codepoint',
                    text: preview, truncated: preview !== entry.row.text, previewEnd: entry.row.start + Array.from(preview).length } });
            if (items.length >= input.limit)
                break;
        }
        guard();
        return { status: 'ok', untrustedEvidence: true, profile: this.profile.hash, generation,
            strategyRequested: input.strategy, strategyUsed: used, scoreKind: used === 'hybrid' ? 'rrf' : used === 'semantic' ? 'cosine' : 'bm25',
            degraded: degraded !== null, degradationReason: degraded, indexedChunks: rows.length, ...stats, items };
    }
    close() {
        if (!this.closed) {
            this.closed = true;
            this.stop.abort();
            this.dependencies.tokenizer.close();
            this.dependencies.embedder.close();
            this.index.close();
        }
    }
}
