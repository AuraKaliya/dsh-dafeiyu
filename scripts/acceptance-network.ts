import { channel } from 'node:diagnostics_channel';
import { appendFileSync,mkdirSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { transportFacts } from './evaluation/transport-diagnostics.ts';

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object';
/** Passive operator diagnostics. Never reads request/response headers or bodies. */
export function observeAcceptanceNetwork(root:string,origin:string,controllerHash:string){
  const testRoot=process.env.DAFEIYU_TEST_RUN;if(testRoot){if(!resolve(root).startsWith(resolve(testRoot)+'\\'))throw new Error('MANAGED_NETWORK_TRACE_REQUIRED');}
  else if(resolve(root)!==resolve('.runtime/acceptance/7c-20261026/network')||origin!=='https://api.deepseek.com')throw new Error('ACCEPTANCE_NETWORK_SCOPE_INVALID');
  if(!/^[a-f0-9]{64}$/.test(controllerHash))throw new Error('NETWORK_CONTROLLER_HASH_INVALID');mkdirSync(root,{recursive:true});const path=join(root,randomUUID()+'.jsonl'),known=new WeakMap<object,number>(),subscriptions:{name:string;listener:(message:unknown)=>void}[]=[];let count=0,events=0,dropped=0,closed=false;
  const write=(record:Record<string,unknown>)=>{if(events++>=50000){dropped++;return;}appendFileSync(path,JSON.stringify({at:new Date().toISOString(),...record})+'\n');};
  write({event:'observer-started',schemaVersion:1,controllerHash,node:process.version,undici:process.versions.undici,proxyEnabled:process.env.NODE_USE_ENV_PROXY==='1'});
  for(const name of ['undici:request:create','undici:client:sendHeaders','undici:request:bodySent','undici:request:headers','undici:request:trailers','undici:request:error','undici:client:connectError']){
    const listener=(message:unknown)=>{try{if(closed||!object(message))return;
      if(name==='undici:client:connectError'){const params=message.connectParams;if(object(params)&&params.hostname===new URL(origin).hostname)write({event:'connection-error',facts:transportFacts(message.error)});return;}
      const request=message.request;if(!object(request))return;
      if(name==='undici:request:create'){if(String(request.origin)!==origin)return;known.set(request,++count);write({event:'request-created',request:count});return;}
      const id=known.get(request);if(id===undefined)return;
      if(name==='undici:request:error')write({event:'request-error',request:id,facts:transportFacts(message.error)});
      else if(name==='undici:request:headers'){const response=message.response,status=object(response)&&typeof response.statusCode==='number'?response.statusCode:null;write({event:'response-headers',request:id,status});}
      else write({event:name==='undici:client:sendHeaders'?'sending-headers':name==='undici:request:bodySent'?'body-sent':'response-completed',request:id});
    }catch{dropped++;}};channel(name).subscribe(listener);subscriptions.push({name,listener});
  }
  return {path,close(){if(closed)return;closed=true;for(const s of subscriptions)channel(s.name).unsubscribe(s.listener);write({event:'observer-ended',requests:count,dropped});}};
}
