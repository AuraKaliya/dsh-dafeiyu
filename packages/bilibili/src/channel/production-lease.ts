import { createServer } from 'node:net';
import type { BiliOwnerConsumerLease } from './types.js';
import { biliOwnerConsumerKey } from './types.js';
import { assertPinnedBiliOwnerProductionBinding } from './production-config.js';
import type { PinnedBiliOwnerProductionBinding } from './production-config.js';

export const biliOwnerConsumerPipe=(identity:import('./types.js').BiliOwnerAccount)=>['','', '.', 'pipe', 'DaFeiYu-BiliOwner-'+identity.accountUid+'-'+identity.ownerUid].join(String.fromCharCode(92));
const leases=new WeakMap<object,PinnedBiliOwnerProductionBinding>();
export function assertBiliOwnerProductionLease(lease:BiliOwnerConsumerLease,binding:PinnedBiliOwnerProductionBinding){if(leases.get(lease)!==binding)throw new Error('BILI_OWNER_PRODUCTION_LEASE_REQUIRED');lease.guard();}

/** A fixed OS pipe coordinates every participating profile on this machine. */
export async function acquireBiliOwnerConsumerLease(binding:PinnedBiliOwnerProductionBinding):Promise<BiliOwnerConsumerLease>{
  assertPinnedBiliOwnerProductionBinding(binding);if(process.platform!=='win32')throw new Error('BILI_OWNER_WINDOWS_REQUIRED');let closed=false,alive=false,releasing:Promise<void>|undefined;
  const server=createServer(socket=>socket.destroy());server.on('error',()=>{alive=false;});
  try{await new Promise<void>((resolve,reject)=>{const failed=()=>{server.off('listening',ready);reject(new Error('BILI_OWNER_CONSUMER_BUSY'));},ready=()=>{server.off('error',failed);alive=true;resolve();};
    server.once('error',failed);server.once('listening',ready);server.listen({path:biliOwnerConsumerPipe(binding.manifest),exclusive:true,readableAll:false,writableAll:false});});
    server.unref();binding.guard();
  }catch(error){if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));throw error;}
  const lease:BiliOwnerConsumerLease=Object.freeze({key:biliOwnerConsumerKey(binding.manifest),epoch:binding.manifest.generation,guard:()=>{if(closed||!alive||!server.listening)throw new Error('BILI_OWNER_LEASE_REVOKED');binding.guard();},
    release:()=>{if(releasing)return releasing;closed=true;alive=false;releasing=new Promise<void>((resolve,reject)=>{if(!server.listening)return resolve();server.close(error=>error?reject(new Error('BILI_OWNER_LEASE_CLOSE_FAILED')):resolve());});return releasing;}});
  leases.set(lease,binding);return lease;
}
