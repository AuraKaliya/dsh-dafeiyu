import type {DatabaseSync} from 'node:sqlite';

/** Complete current schema. Called only for an empty database. */
export function createStorageSchema(db:DatabaseSync):void {
  db.exec(`
CREATE TABLE memory_items(ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
          agent_id TEXT NOT NULL,route TEXT NOT NULL,version INTEGER NOT NULL,head INTEGER NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),reason TEXT NOT NULL DEFAULT '');
CREATE TABLE memory_revisions(id TEXT NOT NULL REFERENCES memory_items(id),revision INTEGER NOT NULL,
          body TEXT NOT NULL,event_id TEXT NOT NULL,PRIMARY KEY(id,revision));
CREATE TABLE dependencies(id TEXT NOT NULL,revision INTEGER NOT NULL,parent_id TEXT NOT NULL,parent_revision INTEGER NOT NULL,
          PRIMARY KEY(id,revision,parent_id,parent_revision),
          FOREIGN KEY(id,revision) REFERENCES memory_revisions(id,revision),
          FOREIGN KEY(parent_id,parent_revision) REFERENCES memory_revisions(id,revision));
CREATE TABLE scope_generations(agent_id TEXT NOT NULL,route TEXT NOT NULL,generation INTEGER NOT NULL,PRIMARY KEY(agent_id,route));
CREATE TABLE memory_events(id TEXT PRIMARY KEY,body TEXT NOT NULL,reason TEXT NOT NULL);
CREATE TABLE outbox(event_id TEXT PRIMARY KEY REFERENCES memory_events(id),delivered INTEGER NOT NULL DEFAULT 0);
CREATE TABLE requests(agent_id TEXT NOT NULL,route TEXT NOT NULL,request_id TEXT NOT NULL,
          fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,route,request_id));
CREATE TABLE memory_boundaries(id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,boundary_hash TEXT NOT NULL,
    PRIMARY KEY(id,revision),FOREIGN KEY(id,revision) REFERENCES memory_revisions(id,revision));
CREATE TABLE observation_sources(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,route TEXT NOT NULL,plugin TEXT NOT NULL,source_key TEXT NOT NULL,version INTEGER NOT NULL,deleted INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,UNIQUE(agent_id,route,source_key));
CREATE TABLE observation_activities(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL,route TEXT NOT NULL,plugin TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,receipt TEXT NOT NULL,UNIQUE(agent_id,route,plugin,request_id));
CREATE TABLE observation_contributions(memory_id TEXT PRIMARY KEY REFERENCES memory_items(id),activity_id TEXT NOT NULL REFERENCES observation_activities(id),contribution_id TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE observation_source_requests(agent_id TEXT NOT NULL,route TEXT NOT NULL,plugin TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,route,plugin,request_id));
CREATE TABLE task_workspaces(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,version INTEGER NOT NULL,epoch INTEGER NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE task_revisions(task_id TEXT NOT NULL REFERENCES task_workspaces(id),version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(task_id,version));
CREATE TABLE task_members(task_id TEXT NOT NULL REFERENCES task_workspaces(id),route TEXT NOT NULL,plugin TEXT NOT NULL,PRIMARY KEY(task_id,route,plugin));
CREATE TABLE task_selections(agent_id TEXT NOT NULL,route TEXT NOT NULL,version INTEGER NOT NULL,task_id TEXT REFERENCES task_workspaces(id),PRIMARY KEY(agent_id,route));
CREATE TABLE task_links(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES task_workspaces(id),fingerprint TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(task_id,fingerprint));
CREATE TABLE task_jobs(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES task_workspaces(id),status TEXT NOT NULL,body TEXT NOT NULL,result TEXT);
CREATE TABLE task_slots(task_id TEXT NOT NULL REFERENCES task_workspaces(id),slot TEXT NOT NULL,version INTEGER NOT NULL,job_id TEXT NOT NULL REFERENCES task_jobs(id),PRIMARY KEY(task_id,slot));
CREATE TABLE task_requests(agent_id TEXT NOT NULL,route TEXT NOT NULL,plugin TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,route,plugin,request_id));
CREATE TABLE task_observations(task_id TEXT NOT NULL REFERENCES task_workspaces(id),job_id TEXT NOT NULL REFERENCES task_jobs(id),activity_id TEXT NOT NULL REFERENCES observation_activities(id),late INTEGER NOT NULL,PRIMARY KEY(job_id,activity_id));
CREATE TABLE task_memory_policies(agent_id TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,id));
CREATE TABLE task_memory_policy_revisions(agent_id TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,id,version));
CREATE TABLE task_memory_grants(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES task_workspaces(id),version INTEGER NOT NULL,revoked INTEGER NOT NULL,body TEXT NOT NULL);
CREATE TABLE task_memory_requests(agent_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,request_id));
CREATE TABLE task_memory_hits(id TEXT PRIMARY KEY,grant_id TEXT NOT NULL REFERENCES task_memory_grants(id),expires_at TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE expression_policies(agent_id TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,id));
CREATE TABLE expression_policy_revisions(agent_id TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,id,version));
CREATE TABLE execution_scopes(scope_key TEXT PRIMARY KEY,agent_id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES task_workspaces(id),body TEXT NOT NULL,fingerprint TEXT NOT NULL,UNIQUE(agent_id,task_id));
CREATE TABLE execution_sources(id TEXT PRIMARY KEY,scope_key TEXT NOT NULL REFERENCES execution_scopes(scope_key),run_id TEXT NOT NULL,producer TEXT NOT NULL,body TEXT NOT NULL,content_hash TEXT NOT NULL,state_version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)));
CREATE TABLE execution_observations(id TEXT PRIMARY KEY,scope_key TEXT NOT NULL REFERENCES execution_scopes(scope_key),run_id TEXT NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,receipt TEXT NOT NULL,UNIQUE(scope_key,producer,request_id));
CREATE TABLE execution_contributions(memory_id TEXT PRIMARY KEY REFERENCES memory_items(id),observation_id TEXT NOT NULL REFERENCES execution_observations(id),body TEXT NOT NULL);
CREATE TABLE task_execution_results(task_id TEXT NOT NULL REFERENCES task_workspaces(id),run_id TEXT PRIMARY KEY,task_epoch INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL);
CREATE TABLE execution_memory_requests(scope_key TEXT NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(scope_key,producer,request_id));
CREATE TABLE execution_memory_outbox(id TEXT PRIMARY KEY,body TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0);
CREATE TABLE persona_dependencies(owner_kind TEXT NOT NULL,owner_id TEXT NOT NULL,owner_version INTEGER NOT NULL,source_key TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_kind,owner_id,owner_version,source_key));
CREATE TABLE continuity_checkpoints(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES task_workspaces(id),run_id TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL);
CREATE TABLE task_intent_events(ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,agent_id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES task_workspaces(id),task_epoch INTEGER NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(agent_id,producer,request_id));
CREATE TABLE capability_observations(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,content_hash TEXT NOT NULL,UNIQUE(agent_id,scope_key,producer,request_id));
CREATE TABLE capability_selections(agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,scope_key,producer,request_id));
CREATE TABLE native_expression_packets(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,task_id TEXT NOT NULL,run_id TEXT NOT NULL,version INTEGER NOT NULL,withdrawn INTEGER NOT NULL,body TEXT NOT NULL,UNIQUE(agent_id,run_id));
CREATE TABLE experience_items(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,version INTEGER NOT NULL,state TEXT NOT NULL);
CREATE TABLE experience_revisions(id TEXT NOT NULL REFERENCES experience_items(id),version INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,PRIMARY KEY(id,version));
CREATE TABLE experience_relations(id TEXT PRIMARY KEY,maintenance_id TEXT NOT NULL,scope_key TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE maintenance_events(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL);
CREATE TABLE maintenance_requests(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,result TEXT,error TEXT,updated_at TEXT NOT NULL,UNIQUE(agent_id,scope_key,producer,request_id));
CREATE TABLE maintenance_receipts(agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,scope_key,producer,request_id));
CREATE TABLE maintenance_watermarks(agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,request_id TEXT NOT NULL,watermark TEXT NOT NULL,PRIMARY KEY(agent_id,scope_key,request_id));
CREATE TABLE recent_self_states(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL);
CREATE TABLE recent_state_revisions(id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(id,version));
CREATE TABLE recent_state_requests(agent_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,request_id));
CREATE TABLE recent_state_publications(id TEXT PRIMARY KEY,state_id TEXT NOT NULL,state_version INTEGER NOT NULL,body TEXT NOT NULL,withdrawn INTEGER NOT NULL DEFAULT 0 CHECK(withdrawn IN (0,1)));
CREATE INDEX items_scope ON memory_items(agent_id,route,ordinal);
CREATE INDEX persona_dependencies_source ON persona_dependencies(source_key);
CREATE INDEX experience_scope ON experience_items(agent_id,scope_key);
CREATE INDEX experience_relation_scope ON experience_relations(scope_key,maintenance_id);
CREATE INDEX maintenance_pending ON maintenance_requests(agent_id,scope_key,state);
CREATE INDEX recent_state_scope ON recent_self_states(agent_id,scope_key);
CREATE INDEX recent_state_publication ON recent_state_publications(state_id,state_version);
CREATE TRIGGER items_no_delete BEFORE DELETE ON memory_items BEGIN SELECT RAISE(ABORT,'Use logical deletion'); END;
CREATE TRIGGER revisions_immutable_update BEFORE UPDATE ON memory_revisions BEGIN SELECT RAISE(ABORT,'Immutable revision'); END;
CREATE TRIGGER revisions_immutable_delete BEFORE DELETE ON memory_revisions BEGIN SELECT RAISE(ABORT,'Immutable revision'); END;
CREATE TRIGGER events_immutable_update BEFORE UPDATE ON memory_events BEGIN SELECT RAISE(ABORT,'Append-only memory event'); END;
CREATE TRIGGER events_immutable_delete BEFORE DELETE ON memory_events BEGIN SELECT RAISE(ABORT,'Append-only memory event'); END;
CREATE TRIGGER dependencies_immutable_update BEFORE UPDATE ON dependencies BEGIN SELECT RAISE(ABORT,'Immutable source dependency'); END;
CREATE TRIGGER dependencies_immutable_delete BEFORE DELETE ON dependencies BEGIN SELECT RAISE(ABORT,'Immutable source dependency'); END;
CREATE TRIGGER boundaries_no_update BEFORE UPDATE ON memory_boundaries BEGIN SELECT RAISE(ABORT,'Immutable memory boundary'); END;
CREATE TRIGGER boundaries_no_delete BEFORE DELETE ON memory_boundaries BEGIN SELECT RAISE(ABORT,'Retain memory boundary'); END;
CREATE TRIGGER observation_source_body_immutable BEFORE UPDATE OF id,agent_id,route,plugin,source_key,body,body_hash ON observation_sources BEGIN SELECT RAISE(ABORT,'Immutable observation source'); END;
CREATE TRIGGER observation_source_no_delete BEFORE DELETE ON observation_sources BEGIN SELECT RAISE(ABORT,'Use logical deletion'); END;
CREATE TRIGGER observation_activity_immutable BEFORE UPDATE OF id,agent_id,route,plugin,request_id,fingerprint,body ON observation_activities BEGIN SELECT RAISE(ABORT,'Immutable observation activity'); END;
CREATE TRIGGER observation_activity_no_delete BEFORE DELETE ON observation_activities BEGIN SELECT RAISE(ABORT,'Retain observation activity'); END;
CREATE TRIGGER observation_receipt_once BEFORE UPDATE OF receipt ON observation_activities WHEN OLD.receipt<>'{}' OR NEW.receipt='{}' BEGIN SELECT RAISE(ABORT,'Immutable observation receipt'); END;
CREATE TRIGGER observation_contribution_immutable BEFORE UPDATE ON observation_contributions BEGIN SELECT RAISE(ABORT,'Immutable contribution'); END;
CREATE TRIGGER observation_contribution_no_delete BEFORE DELETE ON observation_contributions BEGIN SELECT RAISE(ABORT,'Retain contribution'); END;
CREATE TRIGGER task_revision_immutable BEFORE UPDATE ON task_revisions BEGIN SELECT RAISE(ABORT,'Immutable task revision'); END;
CREATE TRIGGER task_revision_no_delete BEFORE DELETE ON task_revisions BEGIN SELECT RAISE(ABORT,'Retain task revision'); END;
CREATE TRIGGER task_link_immutable BEFORE UPDATE ON task_links BEGIN SELECT RAISE(ABORT,'Immutable task source'); END;
CREATE TRIGGER task_link_no_delete BEFORE DELETE ON task_links BEGIN SELECT RAISE(ABORT,'Retain task source'); END;
CREATE TRIGGER task_job_input_immutable BEFORE UPDATE OF id,task_id,body ON task_jobs BEGIN SELECT RAISE(ABORT,'Immutable work inputs'); END;
CREATE TRIGGER task_memory_policy_revision_immutable BEFORE UPDATE ON task_memory_policy_revisions BEGIN SELECT RAISE(ABORT,'Immutable policy revision'); END;
CREATE TRIGGER task_memory_policy_revision_retain BEFORE DELETE ON task_memory_policy_revisions BEGIN SELECT RAISE(ABORT,'Retain policy revision'); END;
CREATE TRIGGER task_memory_grant_immutable BEFORE UPDATE OF id,agent_id,task_id,body ON task_memory_grants BEGIN SELECT RAISE(ABORT,'Immutable grant binding'); END;
CREATE TRIGGER task_memory_grant_retain BEFORE DELETE ON task_memory_grants BEGIN SELECT RAISE(ABORT,'Revoke authorization'); END;
CREATE TRIGGER task_memory_hit_immutable BEFORE UPDATE ON task_memory_hits BEGIN SELECT RAISE(ABORT,'Immutable hit proof'); END;
CREATE TRIGGER expression_policy_revision_immutable BEFORE UPDATE ON expression_policy_revisions BEGIN SELECT RAISE(ABORT,'Immutable expression policy'); END;
CREATE TRIGGER expression_policy_revision_retain BEFORE DELETE ON expression_policy_revisions BEGIN SELECT RAISE(ABORT,'Retain expression policy'); END;
CREATE TRIGGER execution_scopes_immutable BEFORE UPDATE ON execution_scopes BEGIN SELECT RAISE(ABORT,'Immutable execution scope'); END;
CREATE TRIGGER execution_source_body_immutable BEFORE UPDATE OF id,scope_key,run_id,producer,body,content_hash ON execution_sources BEGIN SELECT RAISE(ABORT,'Immutable execution source'); END;
CREATE TRIGGER execution_source_retain BEFORE DELETE ON execution_sources BEGIN SELECT RAISE(ABORT,'Retain execution source state'); END;
CREATE TRIGGER execution_observation_immutable BEFORE UPDATE ON execution_observations BEGIN SELECT RAISE(ABORT,'Immutable execution observation'); END;
CREATE TRIGGER execution_contribution_immutable BEFORE UPDATE ON execution_contributions BEGIN SELECT RAISE(ABORT,'Immutable execution contribution'); END;
CREATE TRIGGER task_execution_result_immutable BEFORE UPDATE ON task_execution_results BEGIN SELECT RAISE(ABORT,'Immutable execution result'); END;
CREATE TRIGGER execution_outbox_body_immutable BEFORE UPDATE OF id,body ON execution_memory_outbox BEGIN SELECT RAISE(ABORT,'Immutable execution event'); END;
CREATE TRIGGER persona_dependency_immutable BEFORE UPDATE ON persona_dependencies BEGIN SELECT RAISE(ABORT,'Immutable persona dependency');END;
CREATE TRIGGER persona_dependency_retain BEFORE DELETE ON persona_dependencies BEGIN SELECT RAISE(ABORT,'Retain persona dependency');END;
CREATE TRIGGER continuity_checkpoint_immutable BEFORE UPDATE ON continuity_checkpoints BEGIN SELECT RAISE(ABORT,'Immutable continuity checkpoint');END;
CREATE TRIGGER continuity_checkpoint_retain BEFORE DELETE ON continuity_checkpoints BEGIN SELECT RAISE(ABORT,'Retain continuity checkpoint');END;
CREATE TRIGGER task_intent_immutable BEFORE UPDATE ON task_intent_events BEGIN SELECT RAISE(ABORT,'Immutable task intent');END;
CREATE TRIGGER task_intent_retain BEFORE DELETE ON task_intent_events BEGIN SELECT RAISE(ABORT,'Retain task intent');END;
CREATE TRIGGER capability_observation_immutable BEFORE UPDATE ON capability_observations BEGIN SELECT RAISE(ABORT,'Immutable capability observation'); END;
CREATE TRIGGER capability_observation_retain BEFORE DELETE ON capability_observations BEGIN SELECT RAISE(ABORT,'Retain capability provenance'); END;
CREATE TRIGGER capability_selection_immutable BEFORE UPDATE ON capability_selections BEGIN SELECT RAISE(ABORT,'Immutable capability selection'); END;
CREATE TRIGGER native_expression_immutable BEFORE UPDATE OF id,agent_id,task_id,run_id,body ON native_expression_packets BEGIN SELECT RAISE(ABORT,'Immutable native expression'); END;
CREATE TRIGGER native_expression_retain BEFORE DELETE ON native_expression_packets BEGIN SELECT RAISE(ABORT,'Withdraw native expression'); END;
CREATE TRIGGER experience_revision_immutable BEFORE UPDATE ON experience_revisions BEGIN SELECT RAISE(ABORT,'Immutable experience revision'); END;
CREATE TRIGGER experience_revision_retain BEFORE DELETE ON experience_revisions BEGIN SELECT RAISE(ABORT,'Retain experience revision'); END;
CREATE TRIGGER experience_relation_immutable BEFORE UPDATE ON experience_relations BEGIN SELECT RAISE(ABORT,'Immutable experience relation'); END;
CREATE TRIGGER maintenance_event_immutable BEFORE UPDATE ON maintenance_events BEGIN SELECT RAISE(ABORT,'Immutable maintenance event'); END;
CREATE TRIGGER maintenance_request_immutable BEFORE UPDATE OF id,agent_id,scope_key,producer,request_id,fingerprint,body ON maintenance_requests BEGIN SELECT RAISE(ABORT,'Immutable maintenance input'); END;
CREATE TRIGGER maintenance_request_retain BEFORE DELETE ON maintenance_requests BEGIN SELECT RAISE(ABORT,'Retain maintenance request'); END;
CREATE TRIGGER maintenance_receipt_immutable BEFORE UPDATE ON maintenance_receipts BEGIN SELECT RAISE(ABORT,'Immutable maintenance receipt'); END;
CREATE TRIGGER recent_state_revision_immutable BEFORE UPDATE ON recent_state_revisions BEGIN SELECT RAISE(ABORT,'Immutable recent state revision'); END;
CREATE TRIGGER recent_state_revision_retain BEFORE DELETE ON recent_state_revisions BEGIN SELECT RAISE(ABORT,'Retain recent state revision'); END;
CREATE TRIGGER recent_publication_immutable BEFORE UPDATE OF id,state_id,state_version,body ON recent_state_publications BEGIN SELECT RAISE(ABORT,'Immutable recent publication'); END;
CREATE TRIGGER recent_publication_retain BEFORE DELETE ON recent_state_publications BEGIN SELECT RAISE(ABORT,'Retain recent publication'); END;
`);
}
