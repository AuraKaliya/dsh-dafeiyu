import { join } from 'node:path';
import { Journal } from '@dafeiyu/journal';
import { RuntimeStore } from './runtime-store.js';
import { DeliveryStore } from './delivery-store.js';
/** Host has already claimed and verified these new empty directories. No recovery or model calls. */
export function initializeCoreStorage(directory:string,agentId:string,profileId:string){
  const journal=new Journal(join(directory,'journal.sqlite'));
  try{const runtime=new RuntimeStore(join(directory,'runtime.sqlite'),{agentId,profileId},{create:true});runtime.close();
    const delivery=new DeliveryStore(join(directory,'delivery.sqlite'),agentId,journal,true);delivery.close();
  }finally{journal.close();}
}
