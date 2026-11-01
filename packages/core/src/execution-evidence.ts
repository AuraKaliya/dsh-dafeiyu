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

const dependencies=z.array(SourceDependencySchema);
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
  private immutableVersion=-1;
  private readonly inputMemo=new Map<string,import('@dafeiyu/contracts').Json>();
  private readonly operationProofMemo=new Map<string,{hash:string;inputHash:string;dependencies:z.infer<typeof dependencies>}>();
  private readonly contextMemo=new Map<string,z.infer<typeof contextRecord>>();
  private readonly runMemo=new Map<string,StoredRun>();
  private validationDepth=0;
  private invalidated=false;
  private contextExpiry=Infinity;
  private admissionCache:{dependencies:readonly SourceDependency[];epoch:string;until:number;valid:boolean}|undefined;
  private bound:ReturnType<ExecutionEvidence['binding']>|undefined;
  constructor(readonly run:StoredRun,private readonly store:RuntimeStore,private readonly memory:()=>ExecutionMemoryPort|undefined,
    private readonly personas:PersonaRuntime,private readonly registry:CapabilityRegistry,private readonly repository:TaskRepositoryPort,
    private readonly rules:readonly string[],private readonly base:PersonaAccess,private readonly authorityValid:(anchor:ActivityAnchor)=>boolean=()=>false,private readonly authorityRequired:(run:StoredRun)=>boolean=()=>false){}
  access(base=this.base):PersonaAccess{const cached=this.validationDepth>0?this.accessMemo.get(base):undefined;if(cached)return cached;
    const access:PersonaAccess={...base,sourceRules:this.rules,historyDependencies:this.admitted,historyTracked:true,
    // A synchronous source batch checks the complete authority at both boundaries.
    // Repeating the same task/message/policy traversal for every nested proof makes long tasks quadratic.
    guard:()=>{if(this.validationDepth>0){base.view.signal.throwIfAborted();if(this.invalidated)throw new Error('SOURCE_STALE');}else base.guard();},
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
  // This is the current projected request, not every snapshot ever seen by the run.
  expose(value:readonly SourceDependency[]){this.admitted=unionDependencies(value);this.admissionCache=undefined;}
  invalidate(){this.invalidated=true;this.admissionCache=undefined;}
  exposed(){return structuredClone(this.admitted);}
  contextView():ContextEvidenceView{return {sourceItems:()=>this.contexts,nativeDependencies:()=>[],validateHistorical:dep=>this.validate([dep])};}
  sourceRefs(deps=this.admitted):PersonaSourceRef[]{return [...new Map(deps.filter((dep):dep is Extract<SourceDependency,{kind:'execution-source'}>=>dep.kind==='execution-source').map(dep=>[runtimeHash(dep.ref),dep.ref])).values()];}
  private clearValidation(){this.validationMemo.clear();this.accessMemo=new WeakMap();this.runMemo.clear();}
  private syncImmutable(){const version=this.store.immutableDataVersion();if(version===this.immutableVersion)return;this.immutableVersion=version;this.operationMemo.clear();this.operationProofMemo.clear();this.inputMemo.clear();this.contextMemo.clear();}
  private readInput(runId:string,id:string){const key=runId+':'+id,cached=this.inputMemo.get(key);if(cached!==undefined)return cached;const value=this.store.readInput(runId,id);
    if(value!==null){if(this.inputMemo.size>=1024)this.inputMemo.delete(this.inputMemo.keys().next().value!);this.inputMemo.set(key,value);}return value;}
  private readOperation(id:string){const cached=this.operationMemo.get(id);if(cached)return cached;const value=this.store.operation(id);if(value.state==='finished'){if(this.operationMemo.size>=1024)this.operationMemo.delete(this.operationMemo.keys().next().value!);this.operationMemo.set(id,value);}return value;}
  private readRun(id:string){const cached=this.validationDepth?this.runMemo.get(id):undefined;if(cached)return cached;const value=this.store.get(id);if(this.validationDepth)this.runMemo.set(id,value);return value;}
  readSources(read:()=>void):void{const outer=this.validationDepth++===0;try{if(outer){this.base.guard();this.syncImmutable();}read();if(outer)this.base.guard();}finally{this.validationDepth--;if(outer)this.clearValidation();}}
  /** Coalesces read validation across short async steps; every store/provider change and authority guard still applies. */
  validateAdmitted():boolean {
    this.base.guard();const port=this.memory(),epoch=runtimeHash([this.store.validationEpoch(),port?.generation(this.access())??0,port?.resourceEpoch?.(this.access())??null]);
    const prior=this.admissionCache;if(prior?.dependencies===this.admitted&&prior.epoch===epoch&&Date.now()<prior.until)return prior.valid;
    this.contextExpiry=Infinity;const valid=this.validate(this.admitted);
    this.admissionCache=valid?{dependencies:this.admitted,epoch,until:Math.min(Date.now()+250,this.contextExpiry),valid}:undefined;
    return valid;
  }
  validate(deps:readonly SourceDependency[]):boolean{if(this.invalidated)return false;const outer=this.validationDepth++===0;try{if(outer){this.base.guard();this.syncImmutable();}const valid=deps.every(dep=>{const key=runtimeHash(dep),cached=this.validationMemo.get(key);if(cached!==undefined)return cached;if(this.checking.has(key))return false;this.checking.add(key);
    try{const valid=this.valid(dep);this.validationMemo.set(key,valid);return valid;}catch{return false;}finally{this.checking.delete(key);}});if(outer)this.base.guard();return valid;}finally{this.validationDepth--;if(outer)this.clearValidation();}}
  private valid(dep:SourceDependency):boolean{
    if(dep.agentId!==this.base.view.scope.agentId||dep.route!==this.route())return false;
    if(dep.kind==='execution-source')return this.memory()?.validate(this.access(),dep.ref)??false;
    if(dep.kind==='execution-input'){const run=this.readRun(dep.runId),body=inputProof.safeParse(this.readInput(dep.runId,'native-program'));
      return run.definition.taskId===this.run.definition.taskId&&body.success&&body.data.epoch===run.definition.intentVersion&&runtimeHash(body.data)===dep.hash
        &&(!this.authorityRequired(run)||!!body.data.authorities?.length)&&(body.data.authorities??[]).every(anchor=>this.authorityValid(anchor))
        &&body.data.sources.every(ref=>this.memory()?.validate(this.access(),ref))
        &&(!body.data.continuity||(()=>{const checkpoint=this.memory()?.checkpoint(this.access(),body.data.continuity.id,true);return !!checkpoint&&runtimeHash(checkpoint)===body.data.continuity.hash;})());}
    if(dep.kind==='execution-operation'){const op=this.readOperation(dep.operationId),run=this.readRun(op.runId);if(op.runId!==dep.runId||run.definition.taskId!==this.run.definition.taskId||op.state!=='finished'||!op.outcome)return false;
      let proof=this.operationProofMemo.get(op.id);if(!proof){const body=this.readInput(op.runId,`operation-inputs:${op.id}`);if(body===null)return false;
        proof={hash:runtimeHash(op.outcome),inputHash:runtimeHash(body),dependencies:dependencies.parse(body)};if(this.operationProofMemo.size>=1024)this.operationProofMemo.delete(this.operationProofMemo.keys().next().value!);this.operationProofMemo.set(op.id,proof);}
      return proof.hash===dep.hash&&proof.inputHash===dep.inputHash&&this.validate(proof.dependencies);}
    if(dep.kind==='context'){
      const key=runtimeHash(dep),stored=this.contextMemo.get(key),record=contextRecord.safeParse(stored??this.store.findContext(`context:${key}`));if(!record.success||Date.parse(record.data.item.expiresAt)<=Date.now()||runtimeHash(this.dependency(record.data))!==key)return false;
      if(!stored){if(this.contextMemo.size>=1024)this.contextMemo.delete(this.contextMemo.keys().next().value!);this.contextMemo.set(key,record.data);}
      this.contextExpiry=Math.min(this.contextExpiry,Date.parse(record.data.item.expiresAt));
      if(dep.owner==='memory'&&dep.region==='growth')return dep.id==='persona:availability'||this.personas.historical(this.access(),dep);
      if(dep.owner==='memory'&&dep.region==='execution')return this.memory()?.validateContext(this.access(),record.data.item)??false;
      if(dep.owner==='dsh-tools'&&dep.region==='capabilities')return true; // Immutable operational declarations; dispatch checks the current catalog separately.
      return this.registry.contributors().some(entry=>entry.owner===dep.owner&&entry.context.id===dep.region&&entry.active()
        &&(entry.context.validateHistorical?.(this.base.view,record.data.item)??entry.context.validate(this.base.view,record.data.item)));
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
