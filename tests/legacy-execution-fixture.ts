import type { DatabaseSync } from 'node:sqlite';
import { EXECUTION_MEMORY_TABLES } from '../packages/memory/lib/migrate-execution.js';
import { PERSONA_TABLES } from '../packages/memory/lib/migrate-persona.js';
import { EXPERIENCE_TABLES } from '../packages/memory/lib/migrate-experience.js';

/** Remove later additive tables only when constructing an older synthetic test database. */
export function dropExecutionFixtureSchema(db:DatabaseSync):void {
  dropCapabilityFixtureSchema(db);
  for(const table of [...PERSONA_TABLES].reverse())db.exec(`DROP TABLE IF EXISTS ${table}`);
  db.prepare('DELETE FROM memory_schema_migrations WHERE version=8').run();
  for(const table of [...EXECUTION_MEMORY_TABLES].reverse())db.exec(`DROP TABLE ${table}`);
  db.prepare('DELETE FROM memory_schema_migrations WHERE version=7').run();
}
export function dropCapabilityFixtureSchema(db:DatabaseSync):void {
  dropExperienceFixtureSchema(db);
  db.exec('DROP TABLE IF EXISTS native_expression_packets');
  db.prepare('DELETE FROM memory_schema_migrations WHERE version=10').run();
  db.exec('DROP TABLE IF EXISTS capability_selections;DROP TABLE IF EXISTS capability_observations');
  db.prepare('DELETE FROM memory_schema_migrations WHERE version=9').run();
}
export function dropExperienceFixtureSchema(db:DatabaseSync):void {
  for(const table of [...EXPERIENCE_TABLES].reverse())db.exec(`DROP TABLE IF EXISTS ${table}`);
  db.prepare('DELETE FROM memory_schema_migrations WHERE version=11').run();
}
