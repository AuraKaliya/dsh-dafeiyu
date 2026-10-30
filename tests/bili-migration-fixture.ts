import { DatabaseSync } from 'node:sqlite';
import { BiliStore } from '../packages/bilibili/lib/store.js';

/** Preserve the real platform tables while replacing only the historical reading layout. */
export function legacyBiliStore(file:string,identity:{agentId:string;profileId:string},version:2|3,record?:{bvid:string}){
  new BiliStore(file,identity,true).close();const db=new DatabaseSync(file);
  try{
    for(const table of ['bili_reading','bili_reading_receipts','bili_reading_history','bili_reading_legacy','bili_comment_cursors'])db.exec(`DROP TABLE ${table}`);
    if(version===3){db.exec('CREATE TABLE bili_reading(bvid TEXT PRIMARY KEY,body TEXT NOT NULL,updated_at INTEGER NOT NULL)');
      if(record)db.prepare('INSERT INTO bili_reading VALUES(?,?,1)').run(record.bvid,JSON.stringify(record));}
    db.exec(`PRAGMA user_version=${version}`);
  }finally{db.close();}
}
