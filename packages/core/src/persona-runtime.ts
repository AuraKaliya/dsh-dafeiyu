import { ContextItemSchema,PersonaManifestSchema } from '@dafeiyu/contracts';
import type { PersonaAccess,PersonaProvider,PersonaManifest,PreparedPersonaEntry,ExecutionInput,ContextItem,SourceDependency } from '@dafeiyu/contracts';
import { digestSource } from './source-records.js';
import type { StoredRun } from './runtime-store.js';
import { runtimeHash } from './runtime-store.js';
import { foundationManifest } from './persona-manifest.js';
import type { FoundationSnapshot } from './foundation.js';
import type { contextConfigSchema } from './context.js';
import type { z } from 'zod';

export interface RunPersona {
  readonly manifest:PersonaManifest;readonly items:readonly ContextItem[];readonly projectionKey:string;
  guard():void;dispose():void;
}
export class PersonaRuntime {
  private provider:PersonaProvider|undefined;
  private readonly active=new Map<string,RunPersona>();
  enrich:(access:PersonaAccess,run:StoredRun)=>PersonaAccess=access=>access;
  constructor(private readonly config:z.output<typeof contextConfigSchema>){}
  bind(provider:PersonaProvider):()=>void{if(this.provider)throw new Error('DUPLICATE_PROVIDER');const bound=Object.freeze({ready:provider.ready.bind(provider),prepare:provider.prepare.bind(provider),validate:provider.validate.bind(provider)});this.provider=bound;
    return ()=>{if(this.provider===bound)this.provider=undefined;};}
  get configured(){return !!this.provider;}
  get ready(){return !this.provider||this.provider.ready();}
  prepare(run:StoredRun,foundation:FoundationSnapshot,model:unknown,inputs:readonly ExecutionInput[],signal:AbortSignal,guard:()=>void):RunPersona{
    guard();if(this.active.has(run.id))throw new Error('RUN_ALREADY_PREPARED');const access=this.access(run,inputs,signal,guard),provider=this.provider;
    if(provider&&!provider.ready())throw new Error('DEPENDENCY_UNAVAILABLE');const prepared=provider?.prepare(access),admitted:PreparedPersonaEntry[]=[];
    const limit=Math.min(this.config.maxBytes,this.config.regions['memory:growth']?.maxBytes??4000);
    const size=(items:readonly ContextItem[])=>Buffer.byteLength(JSON.stringify({owner:'memory',region:'growth',kind:'working-state',items}),'utf8');
    for(const entry of prepared?.entries??[]){const item=ContextItemSchema.parse(entry.item),candidate=structuredClone({...entry,item});
      if(!provider?.validate(access,candidate))continue;admitted.push(candidate);
      if(size(admitted.map(value=>value.item))>limit)admitted.pop();
    }
    let omitted=(prepared?.omitted??0)+(prepared?.entries.length??0)-admitted.length;
    let notice:ContextItem|undefined=omitted?ContextItemSchema.parse({id:'persona:availability',version:String(prepared?.selectionVersion??0),text:'本轮有选中成长资料未能核验或未装入预算，未提供对应正文；不要补造内容，也不要据此断言过去从未形成过相关认识。',
      expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:'dafeiyu:persona-availability',version:String(prepared?.selectionVersion??0),hash:runtimeHash({scope:run.definition.scope,omitted})}]}):undefined;
    if(notice){if(size([notice])>limit)notice=undefined;else while(admitted.length&&size([...admitted.map(value=>value.item),notice])>limit)admitted.pop();}
    omitted=(prepared?.omitted??0)+(prepared?.entries.length??0)-admitted.length;
    const manifest=PersonaManifestSchema.parse({...foundationManifest(run,foundation,model),stageRevision:prepared?.stageRevision??0,selectionVersion:prepared?.selectionVersion??0,
      stageStatus:provider?(omitted?'degraded':admitted.length?'selected':'empty'):'not-configured',omittedCandidates:omitted,entries:admitted.map(({candidate,contentRef,dependencies})=>({candidate,contentRef,dependencies})),policyVersion:runtimeHash({policy:'explicit-persona-v1',automaticInference:false,scopeExpansion:false})});
    const result:RunPersona={manifest,items:[...admitted.map(entry=>entry.item),...(notice?[notice]:[])],projectionKey:runtimeHash({foundation:foundation.version,selection:manifest.selectionVersion,entries:manifest.entries}),
      guard:()=>{guard();if(this.provider!==provider||provider&&!provider.ready())throw new Error('DEPENDENCY_UNAVAILABLE');if(provider&&admitted.some(entry=>!provider.validate(access,entry)))throw new Error('SOURCE_STALE');},
      dispose:()=>{if(this.active.get(run.id)===result)this.active.delete(run.id);}};
    this.active.set(run.id,result);return result;
  }
  access(run:StoredRun,inputs:readonly ExecutionInput[],signal:AbortSignal,guard:()=>void):PersonaAccess{return this.enrich(Object.freeze({view:Object.freeze({runId:run.id,taskId:run.definition.taskId,scope:run.definition.scope,origin:run.definition.origin,signal}),
    producer:'core-persona',operationId:run.id,startedEventId:null,intentVersion:run.definition.intentVersion,motivation:{kind:'unknown' as const,basis:[]},inputs,admittedSources:[],guard}),run);}
  historical(access:PersonaAccess,dependency:Extract<SourceDependency,{kind:'context'}>):boolean{const provider=this.provider;if(!provider?.ready())return false;
    const entry=provider.prepare(access).entries.find(entry=>entry.item.id===dependency.id&&entry.item.version===dependency.version&&digestSource(JSON.stringify([entry.item.text,entry.item.sources]))===dependency.hash);
    return !!entry&&provider.validate(access,entry);}
  current(runId:string){return this.active.get(runId);}
  validateStored(run:StoredRun,manifest:PersonaManifest,inputs:readonly ExecutionInput[],signal:AbortSignal,guard:()=>void):void{
    guard();if(!manifest.entries.length)return;const provider=this.provider;if(!provider?.ready())throw new Error('DEPENDENCY_UNAVAILABLE');
    const access=this.access(run,inputs,signal,guard),prepared=provider.prepare(access);
    for(const entry of manifest.entries){const current=prepared.entries.find(item=>item.candidate.id===entry.candidate.id&&item.candidate.version===entry.candidate.version);
      if(!current||runtimeHash({candidate:current.candidate,contentRef:current.contentRef,dependencies:current.dependencies})!==runtimeHash(entry)||!provider.validate(access,current))throw new Error('SOURCE_STALE');}
  }
}
