import type {DatabaseSync} from 'node:sqlite';

/** Complete current schema. Called only for an empty database. */
export function createStorageSchema(db:DatabaseSync):void {
  db.exec(`
CREATE TABLE runtime_metadata(singleton INTEGER PRIMARY KEY CHECK(singleton=1),body TEXT NOT NULL);
CREATE TABLE runtime_ownership(singleton INTEGER PRIMARY KEY CHECK(singleton=1),pid INTEGER NOT NULL,nonce TEXT NOT NULL);
CREATE TABLE execution_requests(id TEXT PRIMARY KEY,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,task_id TEXT,run_id TEXT,UNIQUE(producer,request_id));
CREATE TABLE runs(id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE REFERENCES execution_requests(id),definition TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL,snapshot TEXT,result TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE run_inputs(run_id TEXT NOT NULL REFERENCES runs(id),input_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(run_id,input_id));
CREATE TABLE execution_sessions(session_key TEXT PRIMARY KEY,session_id TEXT NOT NULL UNIQUE);
CREATE TABLE run_operations(ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,run_id TEXT NOT NULL REFERENCES runs(id),call_id TEXT NOT NULL,fingerprint TEXT NOT NULL,action TEXT NOT NULL,plugin TEXT NOT NULL,plugin_version TEXT NOT NULL,state TEXT NOT NULL,outcome TEXT,started_event TEXT NOT NULL,UNIQUE(run_id,call_id));
CREATE TABLE run_checkpoints(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),body TEXT NOT NULL);
CREATE TABLE wake_receipts(producer TEXT NOT NULL,occurrence_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,run_id TEXT REFERENCES runs(id),PRIMARY KEY(producer,occurrence_id));
CREATE TABLE runtime_outbox(ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,body TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0);
CREATE TABLE run_persona_manifests(run_id TEXT PRIMARY KEY REFERENCES runs(id),body TEXT NOT NULL,body_hash TEXT NOT NULL);
CREATE TABLE native_deliveries(id TEXT PRIMARY KEY,run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),state TEXT NOT NULL,version INTEGER NOT NULL,anchor TEXT NOT NULL,material TEXT,render_ref TEXT,body TEXT,credential TEXT,receipt TEXT,error TEXT);
CREATE TRIGGER runtime_request_immutable BEFORE UPDATE OF id,producer,request_id,fingerprint,body ON execution_requests BEGIN SELECT RAISE(ABORT,'Immutable runtime request');END;
CREATE TRIGGER runtime_run_binding_immutable BEFORE UPDATE OF id,request_key,definition,created_at ON runs BEGIN SELECT RAISE(ABORT,'Immutable run binding');END;
CREATE TRIGGER runtime_snapshot_immutable BEFORE UPDATE OF snapshot ON runs WHEN OLD.snapshot IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable run snapshot');END;
CREATE TRIGGER runtime_result_immutable BEFORE UPDATE OF result ON runs WHEN OLD.result IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable run result');END;
CREATE TRIGGER runtime_operation_binding_immutable BEFORE UPDATE OF id,run_id,call_id,fingerprint,action,plugin,plugin_version,started_event ON run_operations BEGIN SELECT RAISE(ABORT,'Immutable operation binding');END;
CREATE TRIGGER runtime_operation_result_immutable BEFORE UPDATE OF outcome ON run_operations WHEN OLD.outcome IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable operation outcome');END;
CREATE TRIGGER runtime_checkpoint_immutable BEFORE UPDATE ON run_checkpoints BEGIN SELECT RAISE(ABORT,'Immutable checkpoint');END;
CREATE TRIGGER runtime_event_immutable BEFORE UPDATE OF id,body ON runtime_outbox BEGIN SELECT RAISE(ABORT,'Immutable execution event');END;
CREATE TRIGGER runtime_runs_retain BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT,'Retain execution history');END;
CREATE TRIGGER run_persona_manifest_immutable BEFORE UPDATE ON run_persona_manifests BEGIN SELECT RAISE(ABORT,'Immutable persona manifest');END;
CREATE TRIGGER run_persona_manifest_retain BEFORE DELETE ON run_persona_manifests BEGIN SELECT RAISE(ABORT,'Retain persona manifest');END;
CREATE TRIGGER native_delivery_anchor_immutable BEFORE UPDATE OF id,run_id,anchor ON native_deliveries BEGIN SELECT RAISE(ABORT,'Immutable delivery anchor'); END;
CREATE TRIGGER native_delivery_material_immutable BEFORE UPDATE OF material ON native_deliveries WHEN OLD.material IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable delivery material'); END;
CREATE TRIGGER native_delivery_render_immutable BEFORE UPDATE OF render_ref ON native_deliveries WHEN OLD.render_ref IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable rendering result'); END;
CREATE TRIGGER native_delivery_body_immutable BEFORE UPDATE OF body,credential ON native_deliveries WHEN OLD.credential IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable delivery credential'); END;
CREATE TRIGGER native_delivery_retain BEFORE DELETE ON native_deliveries BEGIN SELECT RAISE(ABORT,'Retain native delivery'); END;
`);
}
