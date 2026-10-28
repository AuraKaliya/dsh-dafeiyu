import type {DatabaseSync} from 'node:sqlite';

/** Complete current schema. Called only for an empty database. */
export function createStorageSchema(db:DatabaseSync):void {
  db.exec(`
CREATE TABLE conversations(route TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE);
CREATE TABLE inbox(
        ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        route TEXT NOT NULL REFERENCES conversations(route), message_id TEXT NOT NULL,
        extension_id TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, reply TEXT,
        UNIQUE(route,message_id));
CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        route TEXT NOT NULL, trace_id TEXT NOT NULL, operation_id TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE ownership(singleton INTEGER PRIMARY KEY CHECK(singleton=1),pid INTEGER NOT NULL,nonce TEXT NOT NULL);
CREATE TABLE analysis_grants(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,route TEXT NOT NULL,body TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
CREATE INDEX events_route ON events(route,seq);
CREATE INDEX events_trace ON events(trace_id,seq);
CREATE INDEX events_visibility ON events(json_extract(body,'$.visibility.kind'),route,seq);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'Events are append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'Events are append-only'); END;
`);
}
