import {inspectDatabase,hasTables} from '@dafeiyu/journal';
import type {StorageIdentity} from '@dafeiyu/journal';
import {BILI_OWNER_APPLICATION_ID,BILI_OWNER_SCHEMA_VERSION,BILI_OWNER_TABLES,inspectBiliOwnerStorage} from './store.js';
import {BiliOwnerIdentitySchema} from './types.js';
export function inspectOwnerStorage(file:string,identity?:StorageIdentity){return inspectDatabase(file,{applicationId:BILI_OWNER_APPLICATION_ID,version:BILI_OWNER_SCHEMA_VERSION,
 validate:db=>{if(!hasTables(db,BILI_OWNER_TABLES))return false;const bound=BiliOwnerIdentitySchema.parse(JSON.parse(String(db.prepare('SELECT body FROM bili_owner_binding WHERE id=1').get()?.body)));return inspectBiliOwnerStorage(file,bound).supported;},
 identity:(db,who)=>{const bound=BiliOwnerIdentitySchema.parse(JSON.parse(String(db.prepare('SELECT body FROM bili_owner_binding WHERE id=1').get()?.body)));return bound.agentId===who.agentId&&bound.profileId===who.profileId;}},identity);}
