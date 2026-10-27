import { randomUUID } from 'node:crypto';
import { DshBridgeResponseSchema,DshToolCatalogSchema,BiliBrowserResultSchema } from '@dafeiyu/contracts';
import type { DshToolsPort,Json,BiliBrowserPort } from '@dafeiyu/contracts';

/** The inherited Node IPC pipe is the only bridge endpoint; no listener or public token. */
export function createDshBridgeClient():DshToolsPort&{biliBrowser:BiliBrowserPort}{
  const pending=new Map<string,{resolve:(value:Json)=>void;reject:(error:Error)=>void}>();
  process.on('message',(raw:unknown)=>{const parsed=DshBridgeResponseSchema.safeParse(raw);if(!parsed.success)return;const item=pending.get(parsed.data.id);if(!item)return;pending.delete(parsed.data.id);if(parsed.data.error)item.reject(new Error(parsed.data.error));else item.resolve(parsed.data.value);});
  process.once('disconnect',()=>{for(const item of pending.values())item.reject(new Error('DSH_BRIDGE_DISCONNECTED'));pending.clear();});
  const request=async(type:'dsh.catalog'|'dsh.call'|'dsh.bili-read',data:Record<string,unknown>,signal:AbortSignal):Promise<Json>=>{
    signal.throwIfAborted();if(!process.connected||!process.send)throw new Error('DSH_BRIDGE_UNAVAILABLE');const id=randomUUID();
    let invoked=false;const abort=()=>{if(invoked&&process.connected)process.send?.({type:'dsh.cancel',id});if(type==='dsh.catalog'){pending.get(id)?.reject(new Error('DSH_BRIDGE_UNAVAILABLE'));pending.delete(id);}};
    signal.addEventListener('abort',abort,{once:true});
    try{const result=await new Promise<Json>((resolve,reject)=>{pending.set(id,{resolve,reject});invoked=true;process.send!({type,id,...data},undefined,{},(error:Error|null)=>{if(error){pending.delete(id);reject(new Error('DSH_BRIDGE_DISCONNECTED'));}});if(signal.aborted)abort();});signal.throwIfAborted();return result;}
    finally{signal.removeEventListener('abort',abort);pending.delete(id);}
  };
  return {biliBrowser:{read:async(input,signal)=>BiliBrowserResultSchema.parse(await request('dsh.bili-read',{request:input},signal))},catalog:async(signal,taskId)=>DshToolCatalogSchema.parse(await request('dsh.catalog',taskId?{taskId}:{},AbortSignal.any([signal,AbortSignal.timeout(10000)]))),execute:async(call,authority,signal)=>{authority.guard();const value=await request('dsh.call',{call,authorization:authority.authorization},signal);authority.guard();return value;}};
}
