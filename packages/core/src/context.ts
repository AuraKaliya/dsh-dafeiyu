import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ContextItemSchema,redactContent,ContextBudgetSchema,ContextRegionPolicySchema } from '@dafeiyu/contracts';
import type { ContextContributor,ContextItem,ContextRequest,OperationScope,PendingMessage } from '@dafeiyu/contracts';
import type { Journal } from '@dafeiyu/journal';
import { CORE_VERSION } from './version.js';

import {admitContext,contextManifest,requestCapacity} from './context-plan.js';
import type {ContextPacket} from './context-plan.js';
export type {ContextPacket} from './context-plan.js';
const policySchema=ContextRegionPolicySchema;
export const contextConfigSchema=ContextBudgetSchema;
export const CONTEXT_CARRIER='dafeiyu:controlled-context:v1';
export const bytes=(value:unknown):number=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value),'utf8');
interface Entry {owner:string;version:string;contributor:ContextContributor;active:boolean;controller:AbortController}
export interface PreparedRegion {entry:Entry;request:ContextRequest;items:readonly ContextItem[];unavailable:boolean}
function frozenItem(item:ContextItem):ContextItem {
  item.sources.forEach(Object.freeze);Object.freeze(item.sources);return Object.freeze(item);
}

/** Registry and admission policy owned by the persona core, not by any contributing plugin. */
export class ContextCoordinator {
  readonly config:z.output<typeof contextConfigSchema>;
  private readonly entries=new Map<string,Entry>();
  private readonly scopes=new WeakMap<ContextRequest,{scope:OperationScope;entry:Entry}>();
  private readonly pinnedRegions=new Set<string>();
  private readonly latest=new Map<string,{manifest:ReturnType<typeof contextManifest>;requestBytes:number}>();
  status(route:string){return this.latest.get(route)??null;}
  pinRegion(name:string):()=>void{this.pinnedRegions.add(name);return ()=>{this.pinnedRegions.delete(name);};}
  constructor(private readonly agentId:string,private readonly journal:Journal,config:z.input<typeof contextConfigSchema>={}){
    this.config=contextConfigSchema.parse(config);
    if(this.config.outputReserveBytes>=this.config.requestMaxBytes)throw new Error('Invalid context reserve');
  }
  register(owner:string,version:string,contributors:readonly ContextContributor[]):()=>void{
    const controller=new AbortController();
    const entries=contributors.map(contributor=>{
      if(!/^[a-z][a-z0-9-]{0,63}$/.test(contributor.id))throw new Error('Invalid context region');
      z.enum(['working-state','evidence','operational-fact']).parse(contributor.kind);
      return {owner,version,contributor:{id:contributor.id,kind:contributor.kind,
        prepare:contributor.prepare.bind(contributor),validate:contributor.validate.bind(contributor),...(contributor.validateHistorical?{validateHistorical:contributor.validateHistorical.bind(contributor)}:{})},active:true,controller};
    });
    const names=entries.map(e=>`${owner}:${e.contributor.id}`);
    if(new Set(names).size!==names.length||names.some(n=>this.entries.has(n))||this.entries.size+names.length>32)throw new Error('Duplicate or excessive context regions');
    entries.forEach((entry,i)=>this.entries.set(names[i]!,entry));
    return ()=>{entries.forEach((entry,i)=>{entry.active=false;this.entries.delete(names[i]!);});controller.abort();};
  }
  scopeFor(request:ContextRequest):OperationScope{
    request.signal.throwIfAborted();const authority=this.scopes.get(request);
    if(!authority||!authority.entry.active)throw new Error('No active core-issued context request');return authority.scope;
  }
  release(regions:readonly PreparedRegion[]):void{for(const region of regions)this.scopes.delete(region.request);}
  async prepare(item:PendingMessage,signal:AbortSignal):Promise<PreparedRegion[]>{
    const prepared:PreparedRegion[]=[];const deadline=this.config.assembly.mode==='unified'?Date.now()+this.config.assembly.deadlineMs:Infinity;
    try{
      for(const entry of [...this.entries.values()]){
        if(!entry.active)continue;
        signal.throwIfAborted();
        const operationId=randomUUID();
        const event=this.journal.append({agentId:this.agentId,route:item.route,traceId:item.id,operationId,causedBy:null,
          type:'context.preparing',plugin:entry.owner,pluginVersion:entry.version,occurredAt:new Date().toISOString(),sources:[],data:{region:entry.contributor.id}});
        const timeout=new AbortController(),waiting=AbortSignal.any([signal,timeout.signal,entry.controller.signal]);
        const remaining=deadline-Date.now();const timer=setTimeout(()=>timeout.abort(),Math.max(1,Math.min(remaining,this.config.prepareTimeoutMs)));if(remaining<=0)timeout.abort();
        const request:ContextRequest=Object.freeze({conversation:Object.freeze({...item.message.conversation}),sourceMessageId:item.message.id,signal:waiting});
        this.scopes.set(request,{entry,scope:Object.freeze({agentId:this.agentId,route:item.route,traceId:item.id,operationId,startedEventId:event.id})});
        const region:PreparedRegion={entry,request,items:[],unavailable:false};prepared.push(region);
        let onAbort:()=>void=()=>{};
        try{
          const aborted=new Promise<never>((_,reject)=>{onAbort=()=>reject(new Error('Context preparation stopped'));waiting.addEventListener('abort',onAbort,{once:true});if(waiting.aborted)onAbort();});
          const raw=await Promise.race([entry.contributor.prepare(request),aborted]);signal.throwIfAborted();
          region.items=Object.freeze(z.array(ContextItemSchema).max(64).parse(raw).map(value=>frozenItem({...value,text:redactContent(value.text).value})));
          if(!entry.active)region.unavailable=true;
        }catch{signal.throwIfAborted();region.unavailable=true;this.scopes.delete(request);}
        finally{clearTimeout(timer);waiting.removeEventListener('abort',onAbort);}
      }
      return prepared;
    }catch(error){this.release(prepared);throw error;}
  }
  private policy(region:PreparedRegion){
    const name=`${region.entry.owner}:${region.entry.contributor.id}`;
    return this.config.regions[name]??policySchema.parse(name==='core-situation:responsibilities'?{priority:900,maxBytes:8000,required:true}:name==='memory:working'?{priority:500,maxBytes:6000}:name==='memory:evidence'?{priority:200,maxBytes:8000}:name==='native-task-results:delivered-results'?{priority:450,maxBytes:6000}:{});
  }
  packet(prepared:readonly PreparedRegion[],allowance=this.config.maxBytes):ContextPacket{
    for(const [name,policy] of Object.entries(this.config.regions))if(policy.required&&!prepared.some(r=>r.entry.active&&`${r.entry.owner}:${r.entry.contributor.id}`===name))
      throw new Error('Required context contributor missing');
    for(const name of this.pinnedRegions)if(!prepared.some(region=>region.entry.active&&`${region.entry.owner}:${region.entry.contributor.id}`===name))throw new Error('Required context contributor missing');
    return admitContext(prepared.map(region=>{const policy=this.policy(region),{entry,request}=region;return {
      owner:entry.owner,region:entry.contributor.id,kind:entry.contributor.kind,items:region.items,
      ...policy,required:policy.required||this.pinnedRegions.has(`${entry.owner}:${entry.contributor.id}`),unavailable:region.unavailable||!entry.active,
      validate:(item:ContextItem)=>{this.scopeFor(request);return entry.contributor.validate(request,item);},
    };}),Math.max(0,Math.min(allowance,this.config.maxBytes)));
  }
  audit(item:PendingMessage,packet:ContextPacket,retired:number,nativeNames:readonly string[],requestBytes:number,capacity?:ReturnType<typeof requestCapacity>):void{
    this.latest.delete(item.route);this.latest.set(item.route,{manifest:contextManifest('conversation',packet),requestBytes});while(this.latest.size>64)this.latest.delete(this.latest.keys().next().value!);
    this.journal.append({agentId:this.agentId,route:item.route,traceId:item.id,operationId:randomUUID(),causedBy:null,
      type:'context.admitted',plugin:'core',pluginVersion:CORE_VERSION,occurredAt:new Date().toISOString(),sources:[],
      data:{...(capacity?{capacity}:{}),plan:contextManifest('conversation',packet),bytes:bytes(packet.text),requestBytes,retired,decisions:packet.decisions,nativeRegions:[...nativeNames],selected:packet.regions.map(r=>({owner:r.owner,region:r.region,
        items:r.items.map(i=>({id:i.id,version:i.version,sources:i.sources}))}))}});
  }
}
