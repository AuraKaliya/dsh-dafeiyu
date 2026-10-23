import { z } from 'zod';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Json } from '@dafeiyu/contracts';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const profileSchema = z.strictObject({
  schemaVersion: z.literal(1), model: z.literal('BAAI/bge-small-zh-v1.5'), dimensions: z.literal(512),
  queryPrefix: z.string().max(200), documentPrefix: z.literal(''), pooling: z.literal('CLS'), normalize: z.literal('L2'),
  outputDtype: z.literal('float32'), maxTokens: z.literal(512), chunkTokens: z.number().int().min(16).max(512),
  chunkChars: z.number().int().min(32).max(6000), chunker: z.literal('offset-semantic-v1'), lexical: z.literal('cjk-unigram-bigram-identifier-v1'),
  assets: z.array(z.strictObject({ file: z.string().regex(/^[a-z_]+\.(?:json|txt|onnx)$/), sha256: sha })).length(7),
  software: z.record(z.string().regex(/^[a-z_]+$/), z.string().max(80)), serviceSha256: sha,
  fastembedSources: z.record(z.string().regex(/^fastembed\/(?:text|common)\/[a-z_]+\.py$/), sha),
}).refine(value => new Set(value.assets.map(asset => asset.file)).size === 7
  && ['model_optimized.onnx','tokenizer.json','tokenizer_config.json','config.json','ort_config.json','special_tokens_map.json','vocab.txt'].every(file => value.assets.some(a => a.file === file))
  && ['fastembed','onnxruntime','tokenizers','numpy','fastapi','pydantic','uvicorn','huggingface_hub'].every(key => key in value.software)
  && ['fastembed/text/onnx_embedding.py','fastembed/text/text_embedding.py','fastembed/common/onnx_model.py','fastembed/common/model_description.py'].every(key => key in value.fastembedSources), 'Incomplete profile');
export type EmbeddingProfile = z.infer<typeof profileSchema>;
export function canonical(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
}
export const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
export const tokenizerScript = fileURLToPath(new URL('../tokenizer.py', import.meta.url));
export const defaultProfile = fileURLToPath(new URL('../profiles/bge-onnx-v1.json', import.meta.url));
function freezeTree(value: unknown): void {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeTree(child);
  }
}
export function loadProfile(file: string = defaultProfile) {
  const profile = profileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  freezeTree(profile);
  const workerHash = createHash('sha256').update(readFileSync(tokenizerScript)).digest('hex');
  const definition = canonical(z.json().parse({ profile, workerHash, transport: 'openai-loopback-v1' }));
  return Object.freeze({ profile, hash: digest(definition), workerHash, definition });
}
export const retrievalConfigSchema = z.strictObject({
  endpoint: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)
      && url.pathname === '/v1/embeddings' && !url.username && !url.password && !url.search && !url.hash;
  }, 'Only a loopback embedding endpoint is supported'),
  python: z.string().min(1), modelDir: z.string().min(1), serviceFile: z.string().min(1),
  pythonPackages: z.string().min(1).optional(), profileFile: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(100).max(120_000).default(30_000),
  maxDocuments: z.number().int().min(1).max(10_000).default(1000),
  maxChunks: z.number().int().min(1).max(20_000).default(5000),
  maxCacheEntries: z.number().int().min(8).max(100_000).default(8192),
});
export type RetrievalConfig = z.input<typeof retrievalConfigSchema>;
export const recallSchema = z.strictObject({ query: z.string().trim().min(1).max(2000),
  strategy: z.enum(['lexical','semantic','hybrid']).default('hybrid'), limit: z.number().int().min(1).max(20).default(5), rebuild: z.boolean().default(false) });
export class RetrievalError extends Error {
  constructor(readonly code: 'profile_mismatch' | 'tokenizer_unavailable' | 'embedding_unavailable' | 'invalid_vector'
    | 'query_too_long' | 'query_too_complex' | 'stale_state' | 'capacity_exceeded' | 'closed') { super(code); }
}
export const chunkSchema = z.strictObject({ start: z.number().int().nonnegative(), end: z.number().int().positive(),
  text: z.string(), tokens: z.number().int().nonnegative().max(512) });
export type TextChunk = z.infer<typeof chunkSchema>;
export interface Tokenizer {
  chunks(text: string, signal: AbortSignal): Promise<TextChunk[]>;
  query(text: string, signal: AbortSignal): Promise<{ text: string; tokens: number }>;
  close(): void;
}
export interface Embedder { embed(texts: readonly string[], signal: AbortSignal): Promise<number[][]>; close(): void; }
export interface RetrievalDependencies { tokenizer: Tokenizer; embedder: Embedder; }
export function validateVector(value: unknown): number[] {
  const parsed = z.array(z.number().finite()).length(512).safeParse(value);
  if (!parsed.success) throw new RetrievalError('invalid_vector');
  const norm = Math.sqrt(parsed.data.reduce((total, n) => total + n*n, 0));
  if (Math.abs(norm - 1) > 0.001) throw new RetrievalError('invalid_vector');
  return parsed.data;
}
