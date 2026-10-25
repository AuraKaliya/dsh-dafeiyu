import { DatabaseSync } from 'node:sqlite';
import { existsSync,lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from './catalog.ts';
import type { EvaluationWorkspace } from './workspace.ts';

function alive(pid:number){
  if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('EVALUATION_LEASE_INVALID');
  try{process.kill(pid,0);return true;}catch(error){
    if(error&&typeof error==='object'&&'code' in error&&error.code==='ESRCH')return false;
    // Inaccessible processes and PID reuse are treated as busy, never killed.
    return true;
  }
}

/** A separate transactional owner record prevents recovery racing an active executor. */
export function acquireEvaluationLease(workspace:EvaluationWorkspace){
  const file=join(workspace.root,'execution-lease.sqlite'),existed=existsSync(file);
  if(existed&&(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()))throw new Error('EVALUATION_LINK_DENIED');
  const db=new DatabaseSync(file),nonce=randomUUID(),identity=sha256(JSON.stringify({root:workspace.root,config:workspace.config}));
  let transaction=false;try{
    db.exec('PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');
    transaction=true;
    const version=db.prepare('PRAGMA user_version').get()?.user_version;
    if(version===0&&!existed&&!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table'").get()){
      db.exec('CREATE TABLE identity(id INTEGER PRIMARY KEY CHECK(id=1),hash TEXT NOT NULL);CREATE TABLE owner(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER NOT NULL,nonce TEXT NOT NULL);PRAGMA application_id=1145455928;PRAGMA user_version=1');
      db.prepare('INSERT INTO identity VALUES(1,?)').run(identity);
    }else if(version!==1||db.prepare('PRAGMA application_id').get()?.application_id!==1145455928)throw new Error('EVALUATION_LEASE_INVALID');
    if(db.prepare('SELECT hash FROM identity WHERE id=1').get()?.hash!==identity)throw new Error('EVALUATION_LEASE_IDENTITY_CHANGED');
    const owner=db.prepare('SELECT pid FROM owner WHERE id=1').get();
    if(owner&&alive(Number(owner.pid)))throw new Error('EVALUATION_WORKSPACE_BUSY');
    db.prepare('INSERT INTO owner VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET pid=excluded.pid,nonce=excluded.nonce').run(process.pid,nonce);
    db.exec('COMMIT');
  }catch(error){try{if(transaction)db.exec('ROLLBACK');}finally{db.close();}throw error;}
  let released=false;
  return {release(){if(released)return;try{db.prepare('DELETE FROM owner WHERE id=1 AND pid=? AND nonce=?').run(process.pid,nonce);}finally{released=true;db.close();}}};
}
