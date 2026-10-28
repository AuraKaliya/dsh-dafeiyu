import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {join} from 'node:path';
import {inspectDatabase,matchesSchema,hasTables,countPendingEvents} from '@dafeiyu/journal';
import type {StorageIdentity} from '@dafeiyu/journal';
import {createStorageSchema} from './storage-schema.js';
import {createAutobiographySchema} from './autobiography.js';
import {MEMORY_APPLICATION_ID,MEMORY_SCHEMA_VERSION} from './store.js';

const currentSchema=(db:DatabaseSync)=>{createStorageSchema(db);createAutobiographySchema(db);};
export type MemoryStorageKind='memory'|'analysis'|'working'|'retrieval';
const definitions={analysis:{applicationId:0x44464131,version:1,tables:['jobs','ownership','audit_outbox']},working:{applicationId:0x44465731,version:1,tables:['states','revisions','requests','outbox']},retrieval:{applicationId:0x44465232,version:2,tables:['chunks','snapshots','vector_cache']}} as const;
export function inspectMemoryStorage(file:string,kind:MemoryStorageKind,identity?:StorageIdentity){
  if(kind==='memory')return inspectDatabase(file,{applicationId:MEMORY_APPLICATION_ID,version:MEMORY_SCHEMA_VERSION,validate:db=>matchesSchema(db,currentSchema),identity:(db,who)=>!db.prepare('SELECT 1 FROM memory_items WHERE agent_id<>? LIMIT 1').get(who.agentId)&&!db.prepare('SELECT 1 FROM memory_seed WHERE agent_id<>? LIMIT 1').get(who.agentId)},identity);
  const d=definitions[kind];return inspectDatabase(file,{...d,validate:db=>hasTables(db,d.tables),...(kind==='analysis'?{ownerTable:'ownership' as const}:{})},identity);
}
export function pendingMemoryEvents(directory:string){return countPendingEvents(join(directory,'memory.sqlite'),{outbox:'delivered',execution_memory_outbox:'delivered'})+countPendingEvents(join(directory,'analysis.sqlite'),{audit_outbox:'delivered'})+countPendingEvents(join(directory,'working.sqlite'),{outbox:'delivered'});}
export function readMemoryFoundation(directory:string,agentId:string){
  const file=join(directory,'memory.sqlite');if(!existsSync(file))return null;
  const db=new DatabaseSync(file,{readOnly:true});try{
    if(db.prepare('PRAGMA application_id').get()?.application_id!==MEMORY_APPLICATION_ID||db.prepare('PRAGMA user_version').get()?.user_version!==MEMORY_SCHEMA_VERSION||!matchesSchema(db,currentSchema))throw new Error('INVALID_STORAGE');
    const row=db.prepare('SELECT body FROM memory_seed WHERE agent_id=?').get(agentId);if(!row)return null;
    const value=z.strictObject({text:z.string(),version:z.string(),fileIdentity:z.string()}).parse(JSON.parse(String(row.body)));
    if(createHash('sha256').update(value.text).digest('hex')!==value.version)throw new Error('MEMORY_CORRUPT');return value;
  }finally{db.close();}
}
