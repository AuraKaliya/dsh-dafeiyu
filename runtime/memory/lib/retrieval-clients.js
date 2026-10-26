import { spawn } from 'node:child_process';
import { z } from 'zod';
import { chunkSchema, RetrievalError, tokenizerScript, validateVector } from './retrieval-profile.js';
function cancellable(task, signal) {
    if (signal.aborted)
        return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
        const abort = () => { reject(signal.reason); };
        signal.addEventListener('abort', abort, { once: true });
        task.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
}
export class LocalTokenizer {
    config;
    profile;
    workerHash;
    child = null;
    ready = null;
    sequence = 0;
    buffer = '';
    closed = false;
    pending = new Map();
    constructor(config, profile, workerHash) {
        this.config = config;
        this.profile = profile;
        this.workerHash = workerHash;
    }
    fail() {
        for (const request of this.pending.values())
            request.reject(new RetrievalError('tokenizer_unavailable'));
        this.pending.clear();
    }
    start() {
        if (this.closed)
            return Promise.reject(new RetrievalError('closed'));
        if (this.ready)
            return this.ready;
        const args = [tokenizerScript, '--model-dir', this.config.modelDir, '--service-file', this.config.serviceFile,
            ...(this.config.pythonPackages ? ['--packages', this.config.pythonPackages] : [])];
        this.child = spawn(this.config.python, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false' } });
        this.child.stdout.setEncoding('utf8');
        this.child.stdout.on('data', (part) => {
            this.buffer += part;
            if (this.buffer.length > 512_000) {
                this.close();
                return;
            }
            let index;
            while ((index = this.buffer.indexOf('\n')) >= 0) {
                const line = this.buffer.slice(0, index);
                this.buffer = this.buffer.slice(index + 1);
                try {
                    const result = z.object({ id: z.number().int(), ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() }).parse(JSON.parse(line));
                    const request = this.pending.get(result.id);
                    if (!request)
                        continue;
                    this.pending.delete(result.id);
                    if (result.ok)
                        request.resolve(result.result);
                    else
                        request.reject(new RetrievalError(result.error === 'profile_mismatch' ? 'profile_mismatch'
                            : result.error === 'query_too_long' ? 'query_too_long' : 'tokenizer_unavailable'));
                }
                catch {
                    this.close();
                    return;
                }
            }
        });
        this.child.stderr.resume(); // No raw paths, inputs or provider errors go to model-visible output.
        this.child.stdin.on('error', () => this.fail());
        this.child.on('error', () => this.fail());
        this.child.on('exit', () => this.fail());
        this.ready = this.request({ op: 'hello', profile: this.profile }, AbortSignal.timeout(this.config.timeoutMs ?? 30_000)).then(value => {
            const response = z.strictObject({ ready: z.literal(true), workerHash: z.string() }).parse(value);
            if (response.workerHash !== this.workerHash)
                throw new RetrievalError('profile_mismatch');
        });
        return this.ready;
    }
    request(body, signal) {
        signal.throwIfAborted();
        if (this.closed || !this.child || this.child.exitCode !== null || this.child.killed || this.pending.size >= 128)
            return Promise.reject(new RetrievalError('tokenizer_unavailable'));
        const id = ++this.sequence;
        return new Promise((resolve, reject) => {
            const abort = () => { this.pending.delete(id); reject(signal.reason); };
            signal.addEventListener('abort', abort, { once: true });
            const finish = (callback) => (value) => { signal.removeEventListener('abort', abort); callback(value); };
            this.pending.set(id, { resolve: finish(resolve), reject: finish(reject) });
            this.child.stdin.write(JSON.stringify({ id, ...body }) + '\n', error => {
                if (error) {
                    this.pending.delete(id);
                    finish(reject)(new RetrievalError('tokenizer_unavailable'));
                }
            });
        });
    }
    async chunks(text, signal) {
        await cancellable(this.start(), signal);
        signal.throwIfAborted();
        return z.array(chunkSchema).max(1000).parse(await this.request({ op: 'chunks', text }, signal));
    }
    async query(text, signal) {
        await cancellable(this.start(), signal);
        signal.throwIfAborted();
        return z.strictObject({ text: z.string(), tokens: z.number().int().positive().max(512) })
            .parse(await this.request({ op: 'query', text }, signal));
    }
    close() { if (!this.closed) {
        this.closed = true;
        this.fail();
        this.child?.kill();
    } }
}
async function boundedJson(response) {
    if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new RetrievalError('embedding_unavailable');
    }
    const reader = response.body.getReader();
    const blocks = [];
    let size = 0;
    try {
        while (true) {
            const item = await reader.read();
            if (item.done)
                break;
            size += item.value.byteLength;
            if (size > 256_000) {
                await reader.cancel();
                throw new RetrievalError('embedding_unavailable');
            }
            blocks.push(item.value);
        }
    }
    finally {
        reader.releaseLock();
    }
    try {
        return JSON.parse(Buffer.concat(blocks).toString('utf8'));
    }
    catch {
        throw new RetrievalError('embedding_unavailable');
    }
}
export class LoopbackEmbedder {
    config;
    profile;
    stop = new AbortController();
    queue = Promise.resolve();
    constructor(config, profile) {
        this.config = config;
        this.profile = profile;
    }
    embed(texts, signal) {
        const cancellation = AbortSignal.any([signal, this.stop.signal]);
        cancellation.throwIfAborted();
        const task = this.queue.then(async () => {
            const active = AbortSignal.any([signal, this.stop.signal, AbortSignal.timeout(this.config.timeoutMs ?? 30_000)]);
            active.throwIfAborted();
            if (!texts.length || texts.length > 8 || texts.some(text => !text.trim() || Array.from(text).length > 6000)
                || texts.reduce((sum, text) => sum + Array.from(text).length, 0) > 24000)
                throw new RetrievalError('embedding_unavailable');
            try {
                const health = z.object({ model: z.string(), dimension: z.number(), model_loaded: z.boolean() }).parse(await boundedJson(await fetch(new URL('/health', this.config.endpoint), { signal: active, redirect: 'error' })));
                if (health.model !== this.profile.model || health.dimension !== 512 || !health.model_loaded)
                    throw new RetrievalError('profile_mismatch');
                const response = await fetch(this.config.endpoint, { method: 'POST', signal: active, redirect: 'error',
                    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: this.profile.model, input: texts, dimensions: 512, encoding_format: 'float' }) });
                const result = z.object({ model: z.string(), data: z.array(z.object({ index: z.number().int(), embedding: z.unknown() })) })
                    .parse(await boundedJson(response));
                if (result.model !== this.profile.model || result.data.length !== texts.length
                    || result.data.some((value, index) => value.index !== index))
                    throw new RetrievalError('invalid_vector');
                return result.data.map(value => validateVector(value.embedding));
            }
            catch (error) {
                signal.throwIfAborted();
                this.stop.signal.throwIfAborted();
                if (error instanceof RetrievalError)
                    throw error;
                throw new RetrievalError('embedding_unavailable');
            }
        });
        this.queue = task.then(() => { }, () => { });
        return cancellable(task, cancellation);
    }
    close() { this.stop.abort(); }
}
