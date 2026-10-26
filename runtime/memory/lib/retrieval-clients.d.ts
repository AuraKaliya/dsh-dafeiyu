import type { EmbeddingProfile, RetrievalConfig, TextChunk, Tokenizer, Embedder } from './retrieval-profile.js';
export declare class LocalTokenizer implements Tokenizer {
    private readonly config;
    private readonly profile;
    private readonly workerHash;
    private child;
    private ready;
    private sequence;
    private buffer;
    private closed;
    private readonly pending;
    constructor(config: RetrievalConfig, profile: EmbeddingProfile, workerHash: string);
    private fail;
    private start;
    private request;
    chunks(text: string, signal: AbortSignal): Promise<TextChunk[]>;
    query(text: string, signal: AbortSignal): Promise<{
        text: string;
        tokens: number;
    }>;
    close(): void;
}
export declare class LoopbackEmbedder implements Embedder {
    private readonly config;
    private readonly profile;
    private readonly stop;
    private queue;
    constructor(config: RetrievalConfig, profile: EmbeddingProfile);
    embed(texts: readonly string[], signal: AbortSignal): Promise<number[][]>;
    close(): void;
}
