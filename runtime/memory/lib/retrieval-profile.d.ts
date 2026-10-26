import { z } from 'zod';
import type { Json } from '#dafeiyu/contracts';
export declare const profileSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    model: z.ZodLiteral<"BAAI/bge-small-zh-v1.5">;
    dimensions: z.ZodLiteral<512>;
    queryPrefix: z.ZodString;
    documentPrefix: z.ZodLiteral<"">;
    pooling: z.ZodLiteral<"CLS">;
    normalize: z.ZodLiteral<"L2">;
    outputDtype: z.ZodLiteral<"float32">;
    maxTokens: z.ZodLiteral<512>;
    chunkTokens: z.ZodNumber;
    chunkChars: z.ZodNumber;
    chunker: z.ZodLiteral<"offset-semantic-v1">;
    lexical: z.ZodLiteral<"cjk-unigram-bigram-identifier-v1">;
    assets: z.ZodArray<z.ZodObject<{
        file: z.ZodString;
        sha256: z.ZodString;
    }, z.core.$strict>>;
    software: z.ZodRecord<z.ZodString, z.ZodString>;
    serviceSha256: z.ZodString;
    fastembedSources: z.ZodRecord<z.ZodString, z.ZodString>;
}, z.core.$strict>;
export type EmbeddingProfile = z.infer<typeof profileSchema>;
export declare function canonical(value: Json): string;
export declare const digest: (text: string) => string;
export declare const tokenizerScript: string;
export declare const defaultProfile: string;
export declare function loadProfile(file?: string): Readonly<{
    profile: {
        schemaVersion: 1;
        model: "BAAI/bge-small-zh-v1.5";
        dimensions: 512;
        queryPrefix: string;
        documentPrefix: "";
        pooling: "CLS";
        normalize: "L2";
        outputDtype: "float32";
        maxTokens: 512;
        chunkTokens: number;
        chunkChars: number;
        chunker: "offset-semantic-v1";
        lexical: "cjk-unigram-bigram-identifier-v1";
        assets: {
            file: string;
            sha256: string;
        }[];
        software: Record<string, string>;
        serviceSha256: string;
        fastembedSources: Record<string, string>;
    };
    hash: string;
    workerHash: string;
    definition: string;
}>;
export declare const retrievalConfigSchema: z.ZodObject<{
    endpoint: z.ZodURL;
    python: z.ZodString;
    modelDir: z.ZodString;
    serviceFile: z.ZodString;
    pythonPackages: z.ZodOptional<z.ZodString>;
    profileFile: z.ZodOptional<z.ZodString>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    maxDocuments: z.ZodDefault<z.ZodNumber>;
    maxChunks: z.ZodDefault<z.ZodNumber>;
    maxCacheEntries: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export type RetrievalConfig = z.input<typeof retrievalConfigSchema>;
export declare const recallSchema: z.ZodObject<{
    query: z.ZodString;
    strategy: z.ZodDefault<z.ZodEnum<{
        lexical: "lexical";
        semantic: "semantic";
        hybrid: "hybrid";
    }>>;
    limit: z.ZodDefault<z.ZodNumber>;
    rebuild: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
export declare class RetrievalError extends Error {
    readonly code: 'profile_mismatch' | 'tokenizer_unavailable' | 'embedding_unavailable' | 'invalid_vector' | 'query_too_long' | 'query_too_complex' | 'stale_state' | 'capacity_exceeded' | 'closed';
    constructor(code: 'profile_mismatch' | 'tokenizer_unavailable' | 'embedding_unavailable' | 'invalid_vector' | 'query_too_long' | 'query_too_complex' | 'stale_state' | 'capacity_exceeded' | 'closed');
}
export declare const chunkSchema: z.ZodObject<{
    start: z.ZodNumber;
    end: z.ZodNumber;
    text: z.ZodString;
    tokens: z.ZodNumber;
}, z.core.$strict>;
export type TextChunk = z.infer<typeof chunkSchema>;
export interface Tokenizer {
    chunks(text: string, signal: AbortSignal): Promise<TextChunk[]>;
    query(text: string, signal: AbortSignal): Promise<{
        text: string;
        tokens: number;
    }>;
    close(): void;
}
export interface Embedder {
    embed(texts: readonly string[], signal: AbortSignal): Promise<number[][]>;
    close(): void;
}
export interface RetrievalDependencies {
    tokenizer: Tokenizer;
    embedder: Embedder;
}
export declare function validateVector(value: unknown): number[];
