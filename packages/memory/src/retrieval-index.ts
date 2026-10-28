import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { TimelineScope } from '@dafeiyu/contracts';
import { digest, RetrievalError, validateVector } from './retrieval-profile.js';
import type { TextChunk } from './retrieval-profile.js';

export interface IndexedChunk extends TextChunk { key: string; memoryId: string; revision: number; memoryHash: string; terms: string; order: number; }
const rowSchema = z.object({ key: z.string(), memory_id: z.string(), revision: z.number(), memory_hash: z.string(),
  start_cp: z.number(), end_cp: z.number(), tokens: z.number(), text: z.string(), terms: z.string(), order_no: z.number() });
const APP = 0x44465232;

/** Encode terms as safe ASCII tokens. User text is never interpolated as FTS syntax. */
export function lexicalTokens(text: string): string[] {
  const tokens: string[] = [];
  const normalized = text.normalize('NFKC').toLowerCase();
  for (const value of normalized.matchAll(/[a-z0-9_]+/g)) tokens.push('w' + Buffer.from(value[0]).toString('hex'));
  for (const value of normalized.matchAll(/\p{Script=Han}+/gu)) {
    const chars = Array.from(value[0]);
    for (let i = 0; i < chars.length; i++) {
      tokens.push('u' + Buffer.from(chars[i]!).toString('hex'));
      if (i + 1 < chars.length) tokens.push('b' + Buffer.from(chars[i]! + chars[i+1]!).toString('hex'));
    }
  }
  return tokens;
}

/** Derived data only. Original memory revisions and logical deletion remain in MemoryStore. */
export class RetrievalIndex {
  private readonly db: DatabaseSync;
  private closed = false;
  constructor(file: string, private readonly maxCacheEntries: number) {
    mkdirSync(dirname(file), { recursive: true }); this.db = new DatabaseSync(file);
    try {
      const app = this.db.prepare('PRAGMA application_id').get()?.application_id;
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
      const fresh = app === 0 && version === 0 && this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n === 0;
      if (!fresh && (app !== APP || version !== 2)) throw new Error('Unsupported retrieval database');
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      if (fresh) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE profiles(hash TEXT PRIMARY KEY,body TEXT NOT NULL);
        CREATE TABLE snapshots(agent_id TEXT NOT NULL,route TEXT NOT NULL,profile TEXT NOT NULL,generation INTEGER NOT NULL,
          PRIMARY KEY(agent_id,route,profile));
        CREATE TABLE chunks(rowid INTEGER PRIMARY KEY,key TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL,route TEXT NOT NULL,
          profile TEXT NOT NULL,memory_id TEXT NOT NULL,revision INTEGER NOT NULL,memory_hash TEXT NOT NULL,
          start_cp INTEGER NOT NULL,end_cp INTEGER NOT NULL,tokens INTEGER NOT NULL,text TEXT NOT NULL,terms TEXT NOT NULL,generation INTEGER NOT NULL,order_no INTEGER NOT NULL);
        CREATE INDEX chunk_scope ON chunks(agent_id,route,profile,memory_id);
        CREATE VIRTUAL TABLE chunk_fts USING fts5(terms);
        CREATE TRIGGER chunks_insert AFTER INSERT ON chunks BEGIN INSERT INTO chunk_fts(rowid,terms) VALUES(new.rowid,new.terms); END;
        CREATE TRIGGER chunks_delete AFTER DELETE ON chunks BEGIN DELETE FROM chunk_fts WHERE rowid=old.rowid; END;
        CREATE TABLE vector_cache(id INTEGER PRIMARY KEY,agent_id TEXT NOT NULL,route TEXT NOT NULL,profile TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('query','document')),text_hash TEXT NOT NULL,vector BLOB NOT NULL,accessed INTEGER NOT NULL,
          UNIQUE(agent_id,route,profile,role,text_hash));
        PRAGMA application_id=${APP}; PRAGMA user_version=2; COMMIT;`);
    } catch (error) { this.db.close(); throw error; }
  }
  snapshot(scope: TimelineScope, profile: string): number | null {
    const row = this.db.prepare('SELECT generation FROM snapshots WHERE agent_id=? AND route=? AND profile=?').get(scope.agentId, scope.route, profile);
    return row ? z.number().parse(row.generation) : null;
  }
  rows(scope: TimelineScope, profile: string, limit = 20_001): IndexedChunk[] {
    return this.db.prepare('SELECT * FROM chunks WHERE agent_id=? AND route=? AND profile=? ORDER BY order_no,rowid LIMIT ?').all(scope.agentId, scope.route, profile, limit).map(value => {
      const row = rowSchema.parse(value);
      return { key: row.key, memoryId: row.memory_id, revision: row.revision, memoryHash: row.memory_hash,
        start: row.start_cp, end: row.end_cp, tokens: row.tokens, text: row.text, terms: row.terms, order: row.order_no };
    });
  }
  replace(scope: TimelineScope, profile: string, definition: string, generation: number, chunks: readonly IndexedChunk[]): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare('SELECT body FROM profiles WHERE hash=?').get(profile);
      if (existing && existing.body !== definition) throw new RetrievalError('profile_mismatch');
      this.db.prepare('INSERT OR IGNORE INTO profiles(hash,body) VALUES(?,?)').run(profile, definition);
      for (const chunk of chunks) this.db.prepare(`INSERT INTO chunks(key,agent_id,route,profile,memory_id,revision,memory_hash,start_cp,end_cp,tokens,text,terms,generation,order_no)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET generation=excluded.generation,order_no=excluded.order_no`)
        .run(chunk.key, scope.agentId, scope.route, profile, chunk.memoryId, chunk.revision, chunk.memoryHash,
          chunk.start, chunk.end, chunk.tokens, chunk.text, chunk.terms, generation, chunk.order);
      this.db.prepare('DELETE FROM chunks WHERE agent_id=? AND route=? AND profile=? AND generation<>?').run(scope.agentId, scope.route, profile, generation);
      this.db.prepare(`INSERT INTO snapshots(agent_id,route,profile,generation) VALUES(?,?,?,?)
        ON CONFLICT(agent_id,route,profile) DO UPDATE SET generation=excluded.generation`).run(scope.agentId, scope.route, profile, generation);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  lexicalMatches(scope: TimelineScope, profile: string, query: string): Set<string> {
    const terms = [...new Set(lexicalTokens(query))];
    if (terms.length > 512) throw new RetrievalError('query_too_complex');
    if (!terms.length) return new Set();
    const rows = this.db.prepare(`SELECT c.key FROM chunk_fts JOIN chunks c ON c.rowid=chunk_fts.rowid
      WHERE chunk_fts MATCH ? AND c.agent_id=? AND c.route=? AND c.profile=?`).all(terms.join(' OR '), scope.agentId, scope.route, profile);
    return new Set(rows.map(row => z.string().parse(row.key)));
  }
  getVector(scope: TimelineScope, profile: string, role: 'query' | 'document', text: string): number[] | null {
    const row = this.db.prepare('SELECT id,vector,accessed FROM vector_cache WHERE agent_id=? AND route=? AND profile=? AND role=? AND text_hash=?')
      .get(scope.agentId, scope.route, profile, role, digest(text));
    if (!row) return null;
    let values: number[];
    try {
      if (!(row.vector instanceof Uint8Array) || row.vector.byteLength !== 512 * 4) throw new RetrievalError('invalid_vector');
      const bytes = Buffer.from(row.vector);
      values = validateVector(Array.from({length:512}, (_,index) => bytes.readFloatLE(index * 4)));
    } catch {
      this.db.prepare('DELETE FROM vector_cache WHERE id=?').run(row.id!);
      return null;
    }
    if (Date.now() - Number(row.accessed) > 60_000) this.db.prepare('UPDATE vector_cache SET accessed=? WHERE id=?').run(Date.now(), row.id!);
    return values;
  }
  putVector(scope: TimelineScope, profile: string, role: 'query' | 'document', text: string, raw: unknown): void {
    const vector = validateVector(raw), bytes = Buffer.alloc(512 * 4);
    vector.forEach((value,index) => bytes.writeFloatLE(value, index * 4));
    this.db.prepare(`INSERT INTO vector_cache(agent_id,route,profile,role,text_hash,vector,accessed) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(agent_id,route,profile,role,text_hash) DO UPDATE SET vector=excluded.vector,accessed=excluded.accessed`)
      .run(scope.agentId, scope.route, profile, role, digest(text), bytes, Date.now());
    this.db.prepare('DELETE FROM vector_cache WHERE id IN (SELECT id FROM vector_cache ORDER BY accessed DESC,id DESC LIMIT -1 OFFSET ?)').run(this.maxCacheEntries);
  }
  invalidate(scope: TimelineScope, profile: string): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM chunks WHERE agent_id=? AND route=? AND profile=?').run(scope.agentId, scope.route, profile);
      this.db.prepare('DELETE FROM snapshots WHERE agent_id=? AND route=? AND profile=?').run(scope.agentId, scope.route, profile);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close(): void { if (!this.closed) { this.closed = true; this.db.close(); } }
}

/** BM25 statistics are computed only from this visible scope; never use global FTS bm25(). */
export function lexicalRank(rows: readonly IndexedChunk[], query: string, matches: Set<string>) {
  const terms = new Set(lexicalTokens(query));
  const frequencies = new Map<string,number>();
  const lengths = rows.map(row => {
    const tokens = row.terms.split(' ').filter(Boolean);
    for (const token of new Set(tokens.filter(token=>terms.has(token)))) frequencies.set(token,(frequencies.get(token)??0)+1);
    return tokens.length;
  });
  const average = lengths.reduce((sum,n) => sum+n, 0) / Math.max(rows.length, 1);
  // Keep only one row's term counts at a time instead of a corpus-sized array of Maps.
  const scores = rows.map((row,index) => {
    if (!matches.has(row.key)) return 0;
    const counts = new Map<string,number>();
    for (const token of row.terms.split(' ')) if(terms.has(token)) counts.set(token,(counts.get(token)??0)+1);
    let score = 0;
    for (const term of terms) {
      const df = frequencies.get(term) ?? 0, freq = counts.get(term) ?? 0;
      const idf = Math.log(1+(rows.length-df+0.5)/(df+0.5));
      score += idf * freq * 2.2 / (freq + 1.2 * (0.25 + 0.75 * lengths[index]! / Math.max(average,1)));
    }
    return score;
  });
  return rows.map((row,index) => ({row,score:scores[index]!})).filter(item => matches.has(item.row.key) && item.score>0)
    .sort((a,b) => b.score-a.score || a.row.order-b.row.order);
}
