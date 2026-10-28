import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {inspectDatabase} from '@dafeiyu/journal';
import {inspectQqSchema,QQ_APPLICATION_ID,QQ_SCHEMA_VERSION} from './schema.js';
import {QqMediaDeliveryLedger} from './media-delivery.js';

export function inspectQqStorage(file:string){return inspectDatabase(file,{applicationId:QQ_APPLICATION_ID,version:QQ_SCHEMA_VERSION,validate:db=>inspectQqSchema(db).supported});}
/** Read-only channel facts used by recovery, without loading credentials or opening a transport. */
export function readQqMediaDelivery(directory:string|undefined,replyId:string){
  if(!directory)return null;const file=join(directory,'qq.sqlite');if(!existsSync(file))return null;
  const db=new DatabaseSync(file,{readOnly:true});try{const ledger=new QqMediaDeliveryLedger(db),plan=ledger.plan(replyId);return plan?{manifest:plan.manifest,progress:ledger.progress(replyId)}:null;}finally{db.close();}
}
