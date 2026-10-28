import {ContextItemSchema,PersonaManifestSchema} from '@dafeiyu/contracts';
import type {PersonaAccess,MemoryGrowthProvider,PersonaManifest,PreparedPersonaEntry,ExecutionInput,ContextItem,SourceDependency} from '@dafeiyu/contracts';
import type {StoredRun} from './runtime-store.js';
import {runtimeHash} from './runtime-store.js';
import {digestSource} from './source-records.js';
import {foundationManifest} from './persona-manifest.js';
import type {FoundationSnapshot} from './foundation.js';
import type {contextConfigSchema} from './context.js';
import type {z} from 'zod';

const identity=(entry:PreparedPersonaEntry)=>({memory:entry.memory,contentRef:entry.contentRef,dependencies:entry.dependencies});
export interface RunPersona {
  readonly manifest:PersonaManifest;
  readonly items:readonly ContextItem[];
  readonly projectionKey:string;
  guard():void;
  dispose():void;
}

/** Read-only per-run projection of Memory. This component never creates beliefs or approves growth. */
export class PersonaRuntime {
  private provider:MemoryGrowthProvider|undefined;
  private readonly active=new Map<string,RunPersona>();
  enrich:(access:PersonaAccess,run:StoredRun)=>PersonaAccess=access=>access;
  constructor(private readonly config:z.output<typeof contextConfigSchema>){}
  bind(provider:MemoryGrowthProvider){
    if(this.provider)throw new Error('DUPLICATE_PROVIDER');
    const bound={ready:provider.ready.bind(provider),prepare:provider.prepare.bind(provider),validate:provider.validate.bind(provider)};
    this.provider=bound;return ()=>{if(this.provider===bound)this.provider=undefined;};
  }
  get configured(){return !!this.provider;}
  get ready(){return !this.provider||this.provider.ready();}
  private select(access:PersonaAccess){
    access.guard();const provider=this.provider;if(provider&&!provider.ready())throw new Error('DEPENDENCY_UNAVAILABLE');
    const prepared=provider?.prepare(access),entries:PreparedPersonaEntry[]=[];
    const limit=Math.min(this.config.maxBytes,this.config.regions['memory:growth']?.maxBytes??4000);
    for(const entry of prepared?.entries??[]){
      if(!provider?.validate(access,entry))throw new Error('SOURCE_STALE');
      entries.push({...structuredClone(entry),item:ContextItemSchema.parse(entry.item)});
      if(Buffer.byteLength(JSON.stringify({owner:'memory',region:'growth',kind:'working-state',items:entries.map(value=>value.item)}))>limit)throw new Error('PERSONA_CONTEXT_CAPACITY');
    }
    return {provider,prepared,entries,guard:()=>{
      access.guard();if(this.provider!==provider||provider&&!provider.ready())throw new Error('DEPENDENCY_UNAVAILABLE');
      if(entries.some(entry=>!provider?.validate(access,entry)))throw new Error('SOURCE_STALE');
    }};
  }
  prepareTarget(access:PersonaAccess){
    const selected=this.select(access);
    return {items:selected.entries.map(entry=>entry.item),stamp:runtimeHash(selected.entries.map(identity)),guard:selected.guard};
  }
  prepare(run:StoredRun,foundation:FoundationSnapshot,model:unknown,inputs:readonly ExecutionInput[],signal:AbortSignal,guard:()=>void):RunPersona{
    guard();if(this.active.has(run.id))throw new Error('RUN_ALREADY_PREPARED');
    const selected=this.select(this.access(run,inputs,signal,guard));
    const manifest=PersonaManifestSchema.parse({...foundationManifest(run,foundation,model),
      stageRevision:selected.prepared?.stageRevision??0,selectionVersion:selected.prepared?.selectionVersion??0,
      stageStatus:selected.entries.length?'selected':selected.provider?'empty':'not-configured',
      omittedCandidates:selected.prepared?.omitted??0,entries:selected.entries.map(identity),
      policyVersion:runtimeHash({source:'memory',projection:'explicit-self-understanding'})});
    const result:RunPersona={manifest,items:selected.entries.map(entry=>entry.item),projectionKey:runtimeHash({foundation:foundation.version,entries:manifest.entries}),
      guard:selected.guard,dispose:()=>{if(this.active.get(run.id)===result)this.active.delete(run.id);}};
    this.active.set(run.id,result);return result;
  }
  access(run:StoredRun,inputs:readonly ExecutionInput[],signal:AbortSignal,guard:()=>void):PersonaAccess{
    return this.enrich(Object.freeze({view:Object.freeze({runId:run.id,taskId:run.definition.taskId,scope:run.definition.scope,origin:run.definition.origin,signal}),
      producer:'core-memory-projection',operationId:run.id,startedEventId:null,intentVersion:run.definition.intentVersion,
      motivation:{kind:'unknown' as const,basis:[]},inputs,admittedSources:[],guard}),run);
  }
  historical(access:PersonaAccess,dependency:Extract<SourceDependency,{kind:'context'}>){
    const provider=this.provider;if(!provider?.ready())return false;
    const entry=provider.prepare(access).entries.find(entry=>entry.item.id===dependency.id&&entry.item.version===dependency.version&&digestSource(JSON.stringify([entry.item.text,entry.item.sources]))===dependency.hash);
    return !!entry&&provider.validate(access,entry);
  }
  current(runId:string){return this.active.get(runId);}
  validateStored(run:StoredRun,manifest:PersonaManifest,inputs:readonly ExecutionInput[],signal:AbortSignal,guard:()=>void){
    guard();if(!manifest.entries.length)return;const provider=this.provider;if(!provider?.ready())throw new Error('DEPENDENCY_UNAVAILABLE');
    const access=this.access(run,inputs,signal,guard),prepared=provider.prepare(access);
    for(const stored of manifest.entries){const entry=prepared.entries.find(value=>runtimeHash(identity(value))===runtimeHash(stored));
      if(!entry||!provider.validate(access,entry))throw new Error('SOURCE_STALE');}
  }
}
