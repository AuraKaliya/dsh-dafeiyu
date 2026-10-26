import type { TimelineScope } from '#dafeiyu/contracts';
import type { TextChunk } from './retrieval-profile.js';
export interface IndexedChunk extends TextChunk {
    key: string;
    memoryId: string;
    revision: number;
    memoryHash: string;
    terms: string;
    order: number;
}
/** Encode terms as safe ASCII tokens. User text is never interpolated as FTS syntax. */
export declare function lexicalTokens(text: string): string[];
/** Derived data only. Original memory revisions and logical deletion remain in MemoryStore. */
export declare class RetrievalIndex {
    private readonly maxCacheEntries;
    private readonly db;
    private closed;
    constructor(file: string, maxCacheEntries: number);
    snapshot(scope: TimelineScope, profile: string): number | null;
    rows(scope: TimelineScope, profile: string, limit?: number): IndexedChunk[];
    replace(scope: TimelineScope, profile: string, definition: string, generation: number, chunks: readonly IndexedChunk[]): void;
    lexicalMatches(scope: TimelineScope, profile: string, query: string): Set<string>;
    getVector(scope: TimelineScope, profile: string, role: 'query' | 'document', text: string): number[] | null;
    putVector(scope: TimelineScope, profile: string, role: 'query' | 'document', text: string, raw: unknown): void;
    invalidate(scope: TimelineScope, profile: string): void;
    close(): void;
}
/** BM25 statistics are computed only from this visible scope; never use global FTS bm25(). */
export declare function lexicalRank(rows: readonly IndexedChunk[], query: string, matches: Set<string>): {
    row: IndexedChunk;
    score: number;
}[];
