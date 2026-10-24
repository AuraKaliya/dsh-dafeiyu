import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { revisionSchema } from './types.js';
import { conservativeBoundary,boundaryDigest } from './boundary.js';

/** Caller owns BEGIN IMMEDIATE. Recheck the version under that lock for concurrent opens.
 * No old row, fingerprint, content hash, tombstone, source fence or generation is rewritten. */
export function migrateMemoryBoundaries(db:DatabaseSync):void {
  const version=db.prepare('PRAGMA user_version').get()?.user_version;
  if(version===2||version===3||version===4||version===5||version===6||version===7||version===8){db.prepare('SELECT id,revision,body,boundary_hash FROM memory_boundaries LIMIT 0').all();return;}
  if(version!==1)throw new Error('Unsupported memory boundary migration');
  db.exec(`CREATE TABLE memory_boundaries(id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,boundary_hash TEXT NOT NULL,
    PRIMARY KEY(id,revision),FOREIGN KEY(id,revision) REFERENCES memory_revisions(id,revision));
    CREATE TABLE memory_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL,migrated_revisions INTEGER NOT NULL,policy TEXT NOT NULL);
    CREATE TRIGGER boundaries_no_update BEFORE UPDATE ON memory_boundaries BEGIN SELECT RAISE(ABORT,'Immutable memory boundary'); END;
    CREATE TRIGGER boundaries_no_delete BEFORE DELETE ON memory_boundaries BEGIN SELECT RAISE(ABORT,'Retain memory boundary'); END;`);
  const insert=db.prepare('INSERT INTO memory_boundaries(id,revision,body,boundary_hash) VALUES(?,?,?,?)');let count=0;
  for(const row of db.prepare('SELECT i.agent_id,i.route,r.id,r.revision,r.body FROM memory_revisions r JOIN memory_items i ON i.id=r.id ORDER BY i.ordinal,r.revision').iterate()){
    const revision=revisionSchema.parse(JSON.parse(z.string().parse(row.body)));
    if(revision.id!==row.id||revision.revision!==row.revision)throw new Error('Legacy memory revision identity mismatch');
    const boundary=conservativeBoundary({agentId:z.string().parse(row.agent_id),route:z.string().parse(row.route)},'legacy-migration');
    insert.run(revision.id,revision.revision,JSON.stringify(boundary),boundaryDigest(boundary));count++;
  }
  if(count!==db.prepare('SELECT count(*) AS n FROM memory_revisions').get()?.n)throw new Error('Legacy memory has unowned revisions');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Legacy memory source graph is incomplete');
  db.prepare('INSERT INTO memory_schema_migrations VALUES(2,?,?,?)').run(new Date().toISOString(),count,'preserve-origin-conversation-v1');
  db.exec('PRAGMA user_version=2;');
}
