import type { DatabaseSync } from 'node:sqlite';
import { EXECUTION_MEMORY_TABLES } from '../packages/memory/lib/migrate-execution.js';

/** Remove only the new v7 tables when constructing an older synthetic test database. */
export function dropExecutionFixtureSchema(db:DatabaseSync):void {
  for(const table of [...EXECUTION_MEMORY_TABLES].reverse())db.exec(`DROP TABLE ${table}`);
  db.prepare('DELETE FROM memory_schema_migrations WHERE version=7').run();
}
