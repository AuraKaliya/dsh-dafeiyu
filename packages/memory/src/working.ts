import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { redactContent,ContextItemSchema } from '@dafeiyu/contracts';
import type { ActionContext,ContextContributor,ContextItem,ContextRequest,OperationScope } from '@dafeiyu/contracts';
import { MemoryStore } from './store.js';
import { MemoryRetrieval } from './retrieval.js';
import { MemoryError,keySchema,memoryRef } from './types.js';
import type { Evidence } from './types.js';
import { WorkingStore,selectedSchema } from './working-store.js';
import type { WorkEntry,SelectedMemory } from './working-store.js';

const fields={requestId:keySchema,expectedVersion:z.number().int().nonnegative(),taskId:z.string().min(1).max(100),expiresAt:z.iso.datetime()};
const workSchema=z.strictObject({...fields,items:z.array(z.strictObject({id:z.string().min(1).max(80),
  category:z.enum(['goal','constraint','correction','pending','result','gap']),text:z.string().min(1).max(4000),
  sourceRefs:z.array(z.string().min(1).max(300)).min(1).max(8)})).max(12)});
const selectSchema=z.strictObject({...fields,items:z.array(selectedSchema).max(12)});
const retrieveSchema=z.strictObject({...fields,query:z.string().min(1).max(2000),strategy:z.enum(['lexical','semantic','hybrid']).default('hybrid'),limit:z.number().int().min(1).max(12).default(3)});
const clearSchema=z.strictObject({requestId:keySchema,expectedVersion:z.number().int().nonnegative(),kind:z.enum(['working','evidence'])});
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Explicit work state and citation selection. Analysis reports never feed this service automatically. */
export class WorkingMemory {
  private readonly state:WorkingStore;
  private readonly cache=new WeakMap<ContextRequest,Map<string,{epoch:string;items:ContextItem[]}>>();
  constructor(private readonly ctx:Context,private readonly memory:MemoryStore,private readonly retrieval:MemoryRetrieval|null,directory:string,
    private readonly evidence:(context:ActionContext,refs:readonly string[])=>Promise<Evidence[]>){
    this.state=new WorkingStore(resolve(directory,'working.sqlite'));this.flush();
  }
  private scope(context:ActionContext){return this.ctx.dafeiyu.scopeFor(context);}
  compactionBasis(scope:Pick<OperationScope,'agentId'|'route'>){
    const state=this.state.read(scope,'working');
    return {working:this.state.version(scope,'working'),evidence:this.state.version(scope,'evidence'),
      taskId:state&&state.items.length&&Date.parse(state.expiresAt)>Date.now()?state.taskId:null};
  }
  private expiry(value:string):void{const n=Date.parse(value);if(n<=Date.now()||n>Date.now()+86400000)throw new z.ZodError([{code:'custom',path:['expiresAt'],message:'Expiry must be within 24 hours'}]);}
  private selected(scope:OperationScope,item:SelectedMemory){
    const memory=this.memory.read(scope,item.id,'normal',item.revision);
    if(!memory||memory.version!==item.version||memory.contentHash!==item.contentHash)return null;
    const points=Array.from(memory.content);
    return item.start<item.end&&item.end<=points.length?{memory,text:points.slice(item.start,item.end).join('')}:null;
  }
  async update(context:ActionContext,raw:unknown){
    this.scope(context);const input=workSchema.parse(raw);this.expiry(input.expiresAt);
    if(new Set(input.items.map(i=>i.id)).size!==input.items.length)throw new MemoryError('idempotency_conflict');
    const items:WorkEntry[]=[];
    for(const item of input.items){
      const sources=[];
      for(const evidence of await this.evidence(context,item.sourceRefs)){
        const scope=this.scope(context);
        if(evidence.kind==='memory'){
          const parent=this.memory.read(scope,evidence.id,'normal',evidence.revision);
          if(!parent||parent.contentHash!==evidence.contentHash)throw new MemoryError('source_unavailable');
          sources.push({evidence,version:parent.version});
        }else{
          if(!this.ctx.dafeiyuTimeline.checkWorkingSource(context,evidence.ref,evidence.contentHash)||this.memory.suppressedEvidence(scope,evidence.contentHash))throw new MemoryError('source_unavailable');
          sources.push({evidence,version:null});
        }
      }
      items.push({id:item.id,category:item.category,text:redactContent(item.text).value,sources});
    }
    const scope=this.scope(context);
    // Recheck after every asynchronous source read before persisting a selected work state.
    for(const item of items)for(const source of item.sources){
      const e=source.evidence;
      if(e.kind==='memory'){
        const parent=this.memory.read(scope,e.id,'normal',e.revision);
        if(!parent||parent.version!==source.version||parent.contentHash!==e.contentHash)throw new MemoryError('source_unavailable');
      }else if(this.memory.suppressedEvidence(scope,e.contentHash))throw new MemoryError('source_unavailable');
    }
    const receipt=this.state.write(scope,input.requestId,input.expectedVersion,{kind:'working',version:input.expectedVersion,taskId:input.taskId,expiresAt:input.expiresAt,items});
    this.flush();return {status:'ok' as const,...receipt,admission:'pending-next-request'};
  }
  select(context:ActionContext,raw:unknown){
    const scope=this.scope(context),input=selectSchema.parse(raw);this.expiry(input.expiresAt);
    for(const item of input.items)if(!this.selected(scope,item))throw new MemoryError('source_unavailable');
    const receipt=this.state.write(scope,input.requestId,input.expectedVersion,{kind:'evidence',version:input.expectedVersion,workingVersion:this.state.version(scope,'working'),taskId:input.taskId,expiresAt:input.expiresAt,items:input.items});
    this.flush();return {status:'ok' as const,...receipt,selected:input.items.length,admission:'pending-next-request'};
  }
  async retrieve(context:ActionContext,raw:unknown){
    const scope=this.scope(context),input=retrieveSchema.parse(raw);this.expiry(input.expiresAt);
    if(!this.retrieval)return {status:'not_configured' as const};
    const result=await this.retrieval.recall(scope,{query:input.query,strategy:input.strategy,limit:input.limit},context.signal,()=>{this.scope(context);});
    return {...this.select(context,{requestId:input.requestId,expectedVersion:input.expectedVersion,taskId:input.taskId,expiresAt:input.expiresAt,
      items:result.items.map(item=>({id:item.id,revision:item.revision,version:item.version,contentHash:item.contentHash,start:item.chunk.start,end:item.chunk.end}))}),
      strategy:result.strategyUsed,degraded:result.degraded};
  }
  clear(context:ActionContext,raw:unknown){
    const scope=this.scope(context),input=clearSchema.parse(raw);
    const receipt=this.state.write(scope,input.requestId,input.expectedVersion,{kind:input.kind,version:input.expectedVersion,taskId:'cleared',expiresAt:'1970-01-01T00:00:00.000Z',items:[]});
    this.flush();return {status:'ok' as const,...receipt};
  }
  status(context:ActionContext){
    const scope=this.scope(context);this.flush();
    return {status:'ok' as const,areas:(['working','evidence'] as const).map(kind=>{
      const state=this.state.read(scope,kind);return {kind,version:state?.version??0,taskId:state?.taskId??null,
        expiresAt:state?.expiresAt??null,storedCount:state?.items.length??0,expired:state?Date.parse(state.expiresAt)<=Date.now():false};
    })};
  }
  private contributions(request:ContextRequest,kind:'working'|'evidence'):ContextItem[]{
    const scope=this.ctx.dafeiyu.scopeForContext(request);
    const epoch=JSON.stringify([this.memory.generation(scope),this.state.version(scope,'working'),this.state.version(scope,'evidence')]);
    let cache=this.cache.get(request);if(!cache){cache=new Map();this.cache.set(request,cache);}
    const old=cache.get(kind);if(old?.epoch===epoch)return old.items;
    const items=this.readContributions(request,scope,kind);cache.set(kind,{epoch,items});return items;
  }
  private readContributions(request:ContextRequest,scope:OperationScope,kind:'working'|'evidence'):ContextItem[]{
    const state=this.state.read(scope,kind);
    if(!state||Date.parse(state.expiresAt)<=Date.now())return [];
    if(state.kind==='evidence'){
      const working=this.state.read(scope,'working');
      if(working&&((working.items.length>0&&working.taskId!==state.taskId)||(!working.items.length&&working.version>(state.workingVersion??0))))return [];
      return state.items.flatMap(item=>{
        const value=this.selected(scope,item);if(!value)return [];
        return [{id:`${item.id}:${item.start}:${item.end}`,version:`${state.version}:${item.version}`,expiresAt:state.expiresAt,
          text:JSON.stringify({taskId:state.taskId,kind:value.memory.kind,claimType:value.memory.claimType,offset:[item.start,item.end],text:value.text}),
          sources:[{ref:memoryRef(item.id,item.revision),version:String(item.version),hash:item.contentHash},...value.memory.sources.map(e=>({ref:e.kind==='memory'?memoryRef(e.id,e.revision):e.ref,version:e.kind==='memory'?String(e.revision):'immutable',hash:e.contentHash}))]}];
      });
    }
    return state.items.flatMap(item=>{
      for(const source of item.sources){
        const e=source.evidence;
        if(e.kind==='memory'){
          const parent=this.memory.read(scope,e.id,'normal',e.revision);
          if(!parent||parent.version!==source.version||parent.contentHash!==e.contentHash)return [];
        }else if(this.memory.suppressedEvidence(scope,e.contentHash)||!this.ctx.dafeiyuTimeline.checkContextSource(request,e.ref,e.contentHash))return [];
      }
      return [{id:item.id,version:String(state.version),expiresAt:state.expiresAt,
        text:JSON.stringify({taskId:state.taskId,category:item.category,text:item.text}),sources:item.sources.map(s=>({
          ref:s.evidence.kind==='memory'?memoryRef(s.evidence.id,s.evidence.revision):s.evidence.ref,
          version:s.version===null?'immutable':String(s.version),hash:s.evidence.contentHash}))}];
    });
  }
  contributors():ContextContributor[]{
    return (['working','evidence'] as const).map(kind=>({id:kind,kind:kind==='working'?'working-state':'evidence',
      prepare:async request=>this.contributions(request,kind),
      validate:(request,item)=>this.contributions(request,kind).some(current=>current.id===item.id&&digest(ContextItemSchema.parse(current))===digest(item))}));
  }
  private flush():void{this.state.flush((event,id)=>{this.ctx.dafeiyu.journal.appendOnce(event,id);});}
  close():void{this.state.close();}
}
