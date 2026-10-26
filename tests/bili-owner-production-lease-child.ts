import { loadBiliOwnerProductionBinding } from '../packages/channel-bili-owner/lib/production-config.js';
import { acquireBiliOwnerConsumerLease } from '../packages/channel-bili-owner/lib/production-lease.js';

try{const binding=loadBiliOwnerProductionBinding(JSON.parse(process.argv[2]??'null')),lease=await acquireBiliOwnerConsumerLease(binding);process.send?.({ready:true,epoch:lease.epoch});
  process.on('message',message=>{if(message==='release')void Promise.resolve(lease.release()).then(()=>process.exit(0));});
}catch(error){process.send?.({ready:false,code:error instanceof Error&&/^BILI_OWNER_[A-Z0-9_]+$/.test(error.message)?error.message:'BILI_OWNER_CHILD_FAILED'});process.exitCode=1;process.disconnect?.();}
