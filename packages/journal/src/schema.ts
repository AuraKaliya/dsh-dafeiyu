import {inspectDatabase} from './storage-inspection.js';
import type {StorageIdentity} from './storage-inspection.js';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

export const JOURNAL_APPLICATION_ID = 0x44464a33;
const required: Record<string, readonly string[]> = {
  conversations: ['route','session_id'], inbox: ['ordinal','id','route','message_id','extension_id','payload','state','reply'],
  events: ['seq','id','route','trace_id','operation_id','body'], ownership: ['singleton','pid','nonce'],
  analysis_grants: ['id','agent_id','route','body','revoked'],
};
export interface JournalInspection { exists: boolean; version: number; applicationId: number; supported: boolean; activeOwner: boolean }
export function journalHasLiveOwner(db:DatabaseSync):boolean {
  const owner=db.prepare('SELECT pid FROM ownership WHERE singleton=1').get();
  if(!owner)return false;
  try{process.kill(Number(owner.pid),0);return true;}catch(error){return !(error instanceof Error&&'code'in error&&error.code==='ESRCH');}
}
export function checkJournalShape(db: DatabaseSync): void {
  for (const [table, columns] of Object.entries(required)) {
    const actual = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    if (columns.some(column => !actual.includes(column))) throw new Error('Unsupported journal shape');
  }
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(row => row.name);
  if (!triggers.includes('events_no_update') || !triggers.includes('events_no_delete')) throw new Error('Unsupported journal protections');
}
export function inspectJournal(file: string): JournalInspection {
  if (!existsSync(file)) return { exists: false, version: 0, applicationId: 0, supported: true, activeOwner: false };
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version), applicationId = Number(db.prepare('PRAGMA application_id').get()?.application_id);
    let supported = version === 1 && applicationId === JOURNAL_APPLICATION_ID;
    if (supported) { try { checkJournalShape(db); } catch { supported = false; } }
    let activeOwner = false;
    if (supported) activeOwner=journalHasLiveOwner(db);
    return { exists: true, version, applicationId, supported, activeOwner };
  } finally { db.close(); }
}


export function inspectJournalStorage(file:string,identity?:StorageIdentity){return inspectDatabase(file,{applicationId:JOURNAL_APPLICATION_ID,version:1,ownerTable:'ownership',validate:db=>{checkJournalShape(db);return true;},identity:(db,who)=>!db.prepare("SELECT 1 FROM events WHERE json_extract(body,'$.agentId')<>? LIMIT 1").get(who.agentId)},identity);}
