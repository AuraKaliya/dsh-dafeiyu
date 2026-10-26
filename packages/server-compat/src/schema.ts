import { DatabaseSync } from 'node:sqlite';
import { ArchiveLocationSchema,archiveIdentity,assertArchiveIdentity,check,digest,existingArchiveUri } from './safety.js';
import type { ArchiveIdentity,ArchiveLocation } from './safety.js';

const required={
  records:['id','source_key','kind','route','actor','occurred_at','captured_at','source','audience','body','payload','hash'],
  imports:['source','fingerprint','completed_at'],cycles:['id','day','kind','state','updated_at','payload'],
  versions:['id','cycle_id','base_commit','tree_id','commit_hash','state','title','notes','plan','created_at'],
  blobs:['hash','bytes','encoding','content'],snapshots:['version_id','path','hash','kind'],records_search:['body'],
} as const;
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
const normalized=(value:unknown)=>String(value).replace(/\s+/g,' ').trim().replace(/;$/,'').toLowerCase();
const normalizedSearchTrigger=(value:unknown)=>normalized(value).replace(/^create trigger if not exists /,'create trigger ').replace(/\s*([(),])\s*/g,'$1');
function unique(db:DatabaseSync,table:string,columns:readonly string[],predicate?:string):boolean{
  return db.prepare(`PRAGMA index_list(${quote(table)})`).all().some(row=>{
    if(Number(row.unique)!==1||Number(row.partial)!==(predicate?1:0))return false;
    const names=db.prepare(`PRAGMA index_info(${quote(String(row.name))})`).all().map(item=>String(item.name));
    if(JSON.stringify(names)!==JSON.stringify(columns))return false;
    if(!predicate)return true;
    const sql=String(db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(String(row.name))?.sql),where=/\bWHERE\s+([\s\S]+)$/i.exec(sql)?.[1];
    // SQL keywords are case-insensitive, but the predicate's string value is not.
    return where?.trim().replace(/;$/,'').replace(/["`\[\]]/g,'').replace(/\s*=\s*/,'=')===predicate;
  });
}
export function schemaFingerprint(db:DatabaseSync):string{return digest(JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all()));}
export function validateArchiveSchema(db:DatabaseSync):string{
  check(Number(db.prepare('PRAGMA user_version').get()?.user_version)===1,'ARCHIVE_SCHEMA_UNSUPPORTED');
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>String(row.name)));
  for(const [table,columns]of Object.entries(required)){
    check(tables.has(table),'ARCHIVE_SCHEMA_UNSUPPORTED');
    const actual=db.prepare(`PRAGMA table_info(${quote(table)})`).all();check(columns.every(column=>actual.some(row=>row.name===column)),'ARCHIVE_SCHEMA_UNSUPPORTED');
  }
  const recordColumns=db.prepare('PRAGMA table_info(records)').all();
  check(JSON.stringify(recordColumns.filter(row=>Number(row.pk)>0).map(row=>row.name))===JSON.stringify(['id'])&&recordColumns.some(row=>row.name==='id'&&String(row.type).toUpperCase()==='INTEGER'),'ARCHIVE_SCHEMA_UNSUPPORTED');
  for(const [table,columns]of [['records',['source_key']],['imports',['source']],['cycles',['id']],['versions',['id']],['blobs',['hash']],['snapshots',['version_id','path']]] as const)
    check(unique(db,table,columns),'ARCHIVE_UNIQUENESS_UNSUPPORTED');
  check(unique(db,'cycles',['day'],"kind='daily'")&&unique(db,'versions',['cycle_id'],"state='committed'"),'ARCHIVE_UNIQUENESS_UNSUPPORTED');
  const allowed=new Set(['records_immutable_update','records_immutable_delete','records_index']);
  const triggers=db.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger'").all();
  check(triggers.filter(row=>Object.hasOwn(required,String(row.tbl_name))).every(row=>allowed.has(String(row.name))),'ARCHIVE_TRIGGER_UNSUPPORTED');
  for(const operation of ['update','delete']){
    const name='records_immutable_'+operation,sql=normalized(triggers.find(row=>row.name===name)?.sql);
    const pattern=new RegExp(`^create trigger(?: if not exists)? ${name} before ${operation} on records begin select raise\\(abort,\\s*'(?:[^']|'')*'\\); end$`);
    check(pattern.test(sql),'ARCHIVE_IMMUTABILITY_UNSUPPORTED');
  }
  const indexSql=normalizedSearchTrigger(triggers.find(row=>row.name==='records_index')?.sql);
  const expectedIndexSql=normalizedSearchTrigger('CREATE TRIGGER records_index AFTER INSERT ON records BEGIN INSERT INTO records_search(rowid,body) VALUES(new.id,new.body); END');
  check(indexSql===expectedIndexSql,'ARCHIVE_SEARCH_TRIGGER_UNSUPPORTED');
  // The actual FTS declaration was redacted. Validate its usable columns, never guess/create a tokenizer or virtual table.
  db.prepare('SELECT rowid,body FROM records_search LIMIT 0').all();
  check(db.prepare('PRAGMA foreign_key_list(snapshots)').all().some(row=>row.table==='blobs'&&row.from==='hash'&&row.to==='hash'),'ARCHIVE_SCHEMA_UNSUPPORTED');
  check(Object.values(db.prepare('PRAGMA quick_check').get()??{})[0]==='ok'&&db.prepare('PRAGMA foreign_key_check').get()===undefined,'ARCHIVE_INTEGRITY_FAILED');
  return schemaFingerprint(db);
}
export interface ArchiveInspection {readonly ready:boolean;readonly code:string|null;readonly schemaVersion:1|null;readonly identity:ArchiveIdentity|null;readonly schemaHash:string|null;readonly searchImplementation:'columns-validated-not-assumed'}
export function inspectExistingArchive(raw:ArchiveLocation):ArchiveInspection{
  let db:DatabaseSync|undefined;
  try{const location=ArchiveLocationSchema.parse(raw),identity=archiveIdentity(location);db=new DatabaseSync(existingArchiveUri(location.database,false),{readOnly:true,allowExtension:false});
    db.exec('BEGIN');const schemaHash=validateArchiveSchema(db);assertArchiveIdentity(location,identity);db.exec('COMMIT');
    return {ready:true,code:null,schemaVersion:1,identity,schemaHash,searchImplementation:'columns-validated-not-assumed'};
  }catch(error){return {ready:false,code:error instanceof Error&&/^ARCHIVE_[A-Z_]+$/.test(error.message)?error.message:'ARCHIVE_INSPECTION_FAILED',schemaVersion:null,identity:null,schemaHash:null,searchImplementation:'columns-validated-not-assumed'};}
  finally{db?.close();}
}
