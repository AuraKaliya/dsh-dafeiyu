import { z } from 'zod';
import { ContextItemSchema,ExecutionToolReceiptSchema,PersonaSourceRefSchema,SourceDependencySchema,ActivityAnchorSchema } from '@dafeiyu/contracts';
import type { ActivityAnchor } from '@dafeiyu/contracts';
import type { PersonaAccess,PersonaSourceRef,ExecutionMemoryPort,SourceDependency,CompactionProvider,ContextItem,TaskRepositoryPort } from '@dafeiyu/contracts';
import type { RuntimeStore,StoredRun } from './runtime-store.js';
import { runtimeHash } from './runtime-store.js';
import { digestSource,unionDependencies } from './source-records.js';
import type { PersonaRuntime } from './persona-runtime.js';
import type { CapabilityRegistry } from './capability-registry.js';
import type { ContextEvidenceView } from './context-runtime.js';

const dependencies=z.array(SourceDependencySchema).max(4096);
const inputProof=z.strictObject({schemaVersion:z.literal(1),epoch:z.number().int().positive(),inputHash:z.string(),sources:z.array(PersonaSourceRefSchema),continuity:z.strictObject({id:z.uuid(),hash:z.string()}).nullable(),authorities:z.array(ActivityAnchorSchema).max(64).optional()});
const contextRecord=z.strictObject({owner:z.string(),region:z.string(),item:ContextItemSchema});
export interface NativeContext {owner:string;region:string;item:ContextItem}

/** Source proofs refer to real native task inputs and persisted operation outcomes. */
export class ExecutionEvidence {
  private admitted:readonly SourceDependency[]=[];
  private contexts:NativeContext[]=[];
  private readonly checking=new Set<string>();
  private readonly validationMemo=new Map<string,boolean>();
  private accessMemo=new WeakMap<PersonaAccess,PersonaAccess>();
  private readonly operationMemo=new Map<string,ReturnType<RuntimeStore['operation']>>();
  private readonly runMemo=new Map<string,StoredRun>();
  private validationDepth=0;
  private invalidated=false;
  private bound:ReturnType<ExecutionEvidence['binding']>|undefined;
  constructor(readonly run:StoredRun,private readonly store:RuntimeStore,private readonly memory:()=>ExecutionMemoryPort|undefined,
    private readonly personas:PersonaRuntime,private readonly registry:CapabilityRegistry,private readonly repository:TaskRepositoryPort,
    private readonly rules:readonly string[],private readonly base:PersonaAccess,private readonly authorityValid:(anchor:ActivityAnchor)=>boolean=()=>false,private readonly authorityRequired:(run:StoredRun)=>boolean=()=>false){}
  access(base=this.base):PersonaAccess{const cached=this.validationDepth>0?this.accessMemo.get(base):undefined;if(cached)return cached;
    const access:PersonaAccess={...base,sourceRules:this.rules,historyDependencies:this.admitted,historyTracked:true,
    validateHistory:deps=>this.validate(deps),operationFinished:id=>{try{const op=this.readOperation(id),run=this.readRun(op.runId);return run.definition.taskId===this.run.definition.taskId&&op.state==='finished'&&['succeeded','partial'].includes(op.outcome?.status??'');}catch{return false;}},
    verifyMemorySource:ref=>{try{if(ref.kind!=='memory'||!ref.selectionId||!ref.authorization||!this.rules.includes(ref.authorization.policyId))return null;
      const input=this.repository.readSelectedInputs(ref.agentId,this.run.definition.taskId!,[`task-link:${ref.selectionId}`],this.rules)[0];
      return input?.sourceRef&&runtimeHash(input.sourceRef)===runtimeHash(ref)?{text:input.text,rootSources:input.rootSources??[]}:null;}catch{return null;}}};
    if(this.validationDepth>0)this.accessMemo.set(base,access);return access;}
  recordInput(input:unknown,sources:readonly PersonaSourceRef[],continuity:{id:string;hash:string}|null,authorities:readonly ActivityAnchor[]=[]){this.store.bindInput(this.run.id,'native-program',{schemaVersion:1,epoch:this.run.definition.intentVersion,inputHash:runtimeHash(input),sources,continuity,authorities});}
  setContexts(contexts:NativeContext[]){this.contexts=contexts;
    for(const context of contexts)this.store.bindInput(this.run.id,`context:${runtimeHash(this.dependency(context))}`,context);}
  private dependency({owner,region,item}:NativeContext):Extract<SourceDependency,{kind:'context'}>{return {kind:'context',agentId:this.base.view.scope.agentId,route:this.route(),owner,region,id:item.id,version:item.version,hash:digestSource(JSON.stringify([item.text,item.sources]))};}
  private route(){if(this.run.definition.scope.kind!=='task')throw new Error('TASK_REQUIRED');return this.run.definition.scope.scopeKey;}
  private unavailable(reason:string):SourceDependency[]{return [{kind:'unavailable',agentId:this.base.view.scope.agentId,route:this.route(),reason}];}
  expose(value:readonly SourceDependency[]){this.admitted=unionDependencies(this.admitted,value);}
  invalidate(){this.invalidated=true;}
  exposed(){return structuredClone(this.admitted);}
  contextView():ContextEvidenceView{return {sourceItems:()=>this.contexts,nativeDependencies:()=>[],validateHistorical:dep=>this.validate([dep])};}
  sourceRefs(deps=this.admitted):PersonaSourceRef[]{return [...new Map(deps.filter((dep):dep is Extract<SourceDependency,{kind:'execution-source'}>=>dep.kind==='execution-source').map(dep=>[runtimeHash(dep.ref),dep.ref])).values()];}
  private clearValidation(){this.validationMemo.clear();this.accessMemo=new WeakMap();this.operationMemo.clear();this.runMemo.clear();}
  private readOperation(id:string){const cached=this.validationDepth?this.operationMemo.get(id):undefined;if(cached)return cached;const value=this.store.operation(id);if(this.validationDepth)this.operationMemo.set(id,value);return value;}
  private readRun(id:string){const cached=this.validationDepth?this.runMemo.get(id):undefined;if(cached)return cached;const value=this.store.get(id);if(this.validationDepth)this.runMemo.set(id,value);return value;}
  readSources(read:()=>void):void{const outer=this.validationDepth++===0;try{read();}finally{this.validationDepth--;if(outer)this.clearValidation();}}
  validate(deps:readonly SourceDependency[]):boolean{if(this.invalidated)return false;const outer=this.validationDepth++===0;try{return deps.every(dep=>{const key=runtimeHash(dep),cached=this.validationMemo.get(key);if(cached!==undefined)return cached;if(this.checking.has(key)||this.checking.size>=128)return false;this.checking.add(key);
    try{const valid=this.valid(dep);this.validationMemo.set(key,valid);return valid;}catch{return false;}finally{this.checking.delete(key);}});}finally{this.validationDepth--;if(outer)this.clearValidation();}}
  private valid(dep:SourceDependency):boolean{
    if(dep.agentId!==this.base.view.scope.agentId||dep.route!==this.route())return false;this.base.guard();
    if(dep.kind==='execution-source')return this.memory()?.validate(this.access(),dep.ref)??false;
    if(dep.kind==='execution-input'){const run=this.readRun(dep.runId),body=inputProof.safeParse(this.store.readInput(dep.runId,'native-program'));
      return run.definition.taskId===this.run.definition.taskId&&body.success&&body.data.epoch===run.definition.intentVersion&&runtimeHash(body.data)===dep.hash
        &&(!this.authorityRequired(run)||!!body.data.authorities?.length)&&(body.data.authorities??[]).every(anchor=>this.authorityValid(anchor))
        &&body.data.sources.every(ref=>this.memory()?.validate(this.access(),ref))&&(!body.data.continuity||(()=>{const checkpoint=this.memory()?.checkpoint(this.access(),body.data.continuity.id,true);return !!checkpoint&&runtimeHash(checkpoint)===body.data.continuity.hash;})());}
    if(dep.kind==='execution-operation'){const op=this.readOperation(dep.operationId),run=this.readRun(op.runId),body=this.store.readInput(op.runId,`operation-inputs:${op.id}`);
      return op.runId===dep.runId&&run.definition.taskId===this.run.definition.taskId&&op.state==='finished'&&!!op.outcome&&runtimeHash(op.outcome)===dep.hash
        &&body!==null&&runtimeHash(body)===dep.inputHash&&this.validate(dependencies.parse(body));}
    if(dep.kind==='context'){
      const record=contextRecord.safeParse(this.store.findContext(`context:${runtimeHash(dep)}`));if(!record.success||Date.parse(record.data.item.expiresAt)<=Date.now()||runtimeHash(this.dependency(record.data))!==runtimeHash(dep))return false;
      if(dep.owner==='memory'&&dep.region==='growth')return dep.id==='persona:availability'||this.personas.historical(this.access(),dep);
      if(dep.owner==='memory'&&dep.region==='execution')return this.memory()?.validateContext(this.access(),record.data.item)??false;
      if(dep.owner==='dsh-tools'&&dep.region==='capabilities')return true; // Immutable operational declarations; dispatch checks the current catalog separately.
      return this.registry.contributors().some(entry=>entry.owner===dep.owner&&entry.context.id===dep.region&&entry.active()&&entry.context.validate(this.base.view,record.data.item));
    }
    return dep.kind==='ephemeral'&&dep.traceId===this.run.id;
  }
  binding():{owner:string;version:string;provider:CompactionProvider}{
    if(this.bound)return this.bound;
    const port=this.memory(),scopeFields={agentId:this.base.view.scope.agentId,route:this.route()};
    const provider:CompactionProvider={policy:port?.compactionPolicy??{enabled:false,inputTokens:8192,thresholdRatio:0.75,targetRatio:0.58,minGrowthTokens:1024,minSavingsTokens:512,cooldownMs:60000,retainTurns:2,maxSourceBytes:65536,maxSummaryChars:2000},
      basis:()=>{const generation=port?.generation(this.access())??0;return {epoch:runtimeHash([generation,port?.resourceEpoch?.(this.access())??null]),taskId:this.run.definition.taskId,protectedRunId:this.run.id,versions:{memory:generation}};},
      sources:{
        inbound:(_scope,id)=>{const body=this.store.readInput(id,'native-program');if(!body)return this.unavailable('missing-native-input');const proof=inputProof.parse(body);
          return [{...scopeFields,kind:'execution-input',runId:id,hash:runtimeHash(proof)},...proof.sources.map(ref=>({...scopeFields,kind:'execution-source' as const,ref}))];},
        context:(_scope,region,item)=>{const own=this.contexts.find(context=>context.owner==='memory'&&context.region===region&&context.item.id===item.id);if(!own)return this.unavailable('missing-context');
          const refs:PersonaSourceRef[]=region==='growth'?(()=>{const manifest=this.personas.current(this.run.id)?.manifest;if(!manifest)return [];
            return manifest.entries.filter(entry=>`self-memory:${entry.memory.id}`===item.id).flatMap(entry=>[entry.contentRef,...entry.dependencies]);})()
            :(()=>{try{const value=z.object({source:PersonaSourceRefSchema}).safeParse(JSON.parse(item.text));return value.success?[value.data.source]:[];}catch{return [];}})();
          return [this.dependency(own),...refs.map(ref=>({...scopeFields,kind:'execution-source' as const,ref}))];},
        tool:(_scope,_name,_text,meta)=>{const parsed=z.object({dafeiyuExecution:ExecutionToolReceiptSchema}).safeParse(meta);if(!parsed.success)return this.unavailable('unbound-tool-result');const receipt=parsed.data.dafeiyuExecution;
          const proof=this.store.readInput(receipt.runId,`operation-receipt:${receipt.operationId}`);if(runtimeHash(proof)!==runtimeHash(receipt))return this.unavailable('receipt-mismatch');
          return unionDependencies([{...scopeFields,kind:'execution-operation',runId:receipt.runId,operationId:receipt.operationId,hash:receipt.outcomeHash,inputHash:receipt.inputHash}],receipt.sources.map(ref=>({...scopeFields,kind:'execution-source' as const,ref})));},
        validate:(_scope,dep)=>this.validate([dep]),
        validateMany:(_scope,deps)=>{let result:boolean[]=[];this.readSources(()=>{result=deps.map(dep=>this.validate([dep]));});return result;},
      },
      summarizeFragments:(...args)=>{if(!port)throw new Error('DEPENDENCY_UNAVAILABLE');return port.summarizeFragments(...args);},
      ...(port?.rewrite?{rewrite:port.rewrite.bind(port)}:{}),
    };return this.bound={owner:'memory',version:'execution-sources-v1',provider};
  }
}
