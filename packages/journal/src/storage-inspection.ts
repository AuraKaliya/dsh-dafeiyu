import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';

export interface DatabaseInspection {exists:boolean;version:number;applicationId:number;supported:boolean;activeOwner:boolean;integrity:boolean;identityMatches:boolean}
export interface StorageIdentity {agentId:string;profileId:string}
export interface DatabaseContract {
  applicationId:number;version:number;
  validate(db:DatabaseSync):boolean;
  identity?(db:DatabaseSync,identity:StorageIdentity):boolean;
  ownerTable?:'ownership'|'runtime_ownership';
}
const schemas=new WeakMap<(db:DatabaseSync)=>void,string>();
const shape=(db:DatabaseSync)=>JSON.stringify(db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>({type:row.type,name:row.name,sql:String(row.sql).replace(/\s+/g,' ').replace(/IF NOT EXISTS /gi,'').trim()})));
export function matchesSchema(db:DatabaseSync,create:(db:DatabaseSync)=>void):boolean {
  let expected=schemas.get(create);if(expected===undefined){const fresh=new DatabaseSync(':memory:');try{create(fresh);expected=shape(fresh);schemas.set(create,expected);}finally{fresh.close();}}
  return shape(db)===expected;
}
export function hasTables(db:DatabaseSync,names:readonly string[]){const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>String(row.name)));return names.every(name=>tables.has(name));}
export function metadataMatches(db:DatabaseSync,table:string,identity:StorageIdentity){
  if(!/^[a-z_]+$/.test(table))throw new Error('INVALID_STORAGE_CONTRACT');
  const row=db.prepare(`SELECT body FROM ${table} LIMIT 1`).get();if(!row)return false;
  const value:unknown=JSON.parse(String(row.body));return !!value&&typeof value==='object'&&'agentId'in value&&'profileId'in value&&value.agentId===identity.agentId&&value.profileId===identity.profileId;
}
/** Common SQLite checks; schema and identity knowledge stay with the owning module. */
export function inspectDatabase(file:string,contract:DatabaseContract,identity?:StorageIdentity):DatabaseInspection {
  if(!existsSync(file))return {exists:false,version:0,applicationId:0,supported:true,activeOwner:false,integrity:true,identityMatches:true};
  let db:DatabaseSync|undefined;
  try{db=new DatabaseSync(file,{readOnly:true});const version=Number(db.prepare('PRAGMA user_version').get()?.user_version),applicationId=Number(db.prepare('PRAGMA application_id').get()?.application_id);
    const supported=version===contract.version&&applicationId===contract.applicationId&&contract.validate(db);
    let activeOwner=false;
    if(supported&&contract.ownerTable){const row=db.prepare(`SELECT pid FROM ${contract.ownerTable} WHERE singleton=1`).get();if(row){try{process.kill(Number(row.pid),0);activeOwner=true;}catch(error){activeOwner=!(error instanceof Error&&'code'in error&&error.code==='ESRCH');}}}
    const identityMatches=supported&&identity&&contract.identity?contract.identity(db,identity):supported;
    const integrity=Object.values(db.prepare('PRAGMA quick_check').get()??{})[0]==='ok'&&db.prepare('PRAGMA foreign_key_check').get()===undefined;
    return {exists:true,version,applicationId,supported,activeOwner,integrity,identityMatches};
  }catch{return {exists:true,version:-1,applicationId:-1,supported:false,activeOwner:false,integrity:false,identityMatches:false};}finally{db?.close();}
}
export function countPendingEvents(file:string,tables:Readonly<Record<string,string>>):number {
  if(!existsSync(file))return 0;const db=new DatabaseSync(file,{readOnly:true});
  try{let count=0;for(const [table,column]of Object.entries(tables)){
    if(!/^[a-z_]+$/.test(table)||!/^[a-z_]+$/.test(column))throw new Error('INVALID_STORAGE_CONTRACT');
    count+=Number(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column}=0`).get()?.n);
  }return count;}finally{db.close();}
}
