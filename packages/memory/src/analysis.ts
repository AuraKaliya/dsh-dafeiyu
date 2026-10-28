import type { Context } from '@deepseek-ai/cordis';
import type { ConversationAccess, OperationScope } from '@dafeiyu/contracts';
import { redactJson } from '@dafeiyu/contracts';
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { MemoryStore } from './store.js';
import { MemoryError } from './types.js';
import { AnalysisStore } from './analysis-store.js';
import { AnalysisSources } from './analysis-sources.js';
import { AnalysisRuntime } from './analysis-runtime.js';
import { candidates } from './analysis-policy.js';
import { AnalysisError, analysisConfigSchema, submitSchema, targetSnapshot, resultSchema } from './analysis-types.js';
import type { AnalysisJob, Target } from './analysis-types.js';

export class MemoryAnalysis {
  private readonly queue:AnalysisStore;
  private readonly sources:AnalysisSources;
  private readonly runtime:AnalysisRuntime;
  private readonly config:z.output<typeof analysisConfigSchema>;
  private worker:Promise<void>|undefined;
  private active:{id:string;abort:AbortController}|undefined;
  private stopping=false;
  private faulted=false;
  private readonly cancelled=new Set<string>();
  private enabled:boolean;
  constructor(private readonly ctx:Context,private readonly memories:MemoryStore,directory:string,config:z.input<typeof analysisConfigSchema>,managed=false,private readonly canRun:()=>boolean=()=>true){
    this.enabled=!managed;
    this.config=analysisConfigSchema.parse(config);
    this.queue=new AnalysisStore(resolve(directory,'analysis.sqlite'),managed);
    this.sources=new AnalysisSources(ctx,memories);
    this.runtime=new AnalysisRuntime(ctx,resolve(directory,'analysis-sessions'));
  }
  recover():void {this.queue.recover();}
  activate():void {this.enabled=true;this.start();}
  quiesce():void {this.enabled=false;}
  cancelRunning():void {this.quiesce();this.active?.abort.abort();}
  get health(){return {state:this.stopping?'stopped' as const:this.faulted?'failed' as const:this.enabled?'ready' as const:'paused' as const,active:!!this.active};}
  start():void {
    if(this.stopping||this.faulted||this.worker||!this.enabled||!this.canRun())return;
    // Schedule outside submit; authority does not depend on the initiating action's lifetime.
    this.worker=new Promise<void>(resolve=>setImmediate(resolve)).then(()=>this.drain())
      .catch(()=>{this.faulted=true;}).finally(()=>{this.worker=undefined;});
  }
  async whenIdle():Promise<void>{await this.worker;}
  private scope(grantId:string):OperationScope{
    try{return this.ctx.dafeiyu.analysisScope(grantId);}catch{throw new AnalysisError('authorization_unavailable');}
  }
  private summary(job:AnalysisJob){return {status:'ok' as const,jobId:job.id,state:job.state,attempts:job.attempts,
    counts:{candidates:job.candidates.length,committed:job.candidates.filter(c=>c.status==='committed').length,
      review:job.candidates.filter(c=>c.status==='needs_review').length},error:this.faulted?'worker_unavailable':job.error??null,contextInjected:false};}
  async submit(context:ConversationAccess,raw:unknown){
    const scope=this.ctx.dafeiyu.scopeFor(context),input=submitSchema.parse(raw);
    if(this.stopping||this.faulted||!this.enabled||!this.canRun())throw new AnalysisError('worker_unavailable');
    const normalized={...input,sourceRefs:[...new Set(input.sourceRefs)].sort(),targetIds:[...new Set(input.targetIds)].sort()};
    const fingerprint=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    const previous=this.queue.request(scope,input.requestId,fingerprint);
    if(previous)return {...this.summary(previous),duplicate:true};
    if([...this.queue.pending()].length>=this.config.maxPending)throw new AnalysisError('queue_full');
    const grantId=this.ctx.dafeiyu.issueAnalysisGrant(context);
    try {
      const generation=this.memories.generation(scope);
      const sources=[];
      for(const [index,ref] of normalized.sourceRefs.entries())sources.push(await this.sources.read(grantId,ref,`S${index+1}`,context.signal));
      const targets:Target[]=[];
      for(const id of normalized.targetIds){
        const item=this.memories.read(scope,id);
        if(!item)throw new AnalysisError('target_unavailable');
        const authorIds:string[]=[];
        for(const evidence of item.sources)if(evidence.kind==='timeline'){
          const source=await this.sources.read(grantId,evidence.ref,'S1',context.signal);
          if(source.authorId&&source.evidence.contentHash===evidence.contentHash)authorIds.push(source.authorId);
        }
        targets.push({item:targetSnapshot(item),authorIds:[...new Set(authorIds)]});
      }
      if(sources.reduce((n,s)=>n+s.text.length,0)+targets.reduce((n,t)=>n+t.item.content.length,0)>24000)throw new AnalysisError('input_too_large');
      this.ctx.dafeiyu.scopeFor(context);
      if(generation!==this.memories.generation(scope))throw new AnalysisError('version_conflict');
      // A second submit may have awaited the same evidence concurrently.
      const duplicate=this.queue.request(scope,input.requestId,fingerprint);
      if(duplicate){this.ctx.dafeiyu.revokeAnalysisGrant(grantId);return {...this.summary(duplicate),duplicate:true};}
      if([...this.queue.pending()].length>=this.config.maxPending)throw new AnalysisError('queue_full');
      const now=new Date().toISOString();
      const job:AnalysisJob={id:randomUUID(),requestId:input.requestId,fingerprint,grantId,agentId:scope.agentId,route:scope.route,
        authority:this.scope(grantId),
        model:this.ctx.dafeiyu.analysisModelRoute(),inputGeneration:generation,generation,state:'queued',sources,targets,candidates:[],createdAt:now,updatedAt:now,attempts:0};
      this.queue.insert(job);this.flush();this.start();
      return {...this.summary(job),duplicate:false};
    }catch(error){this.ctx.dafeiyu.revokeAnalysisGrant(grantId);throw error;}
  }
  status(context:ConversationAccess,id:unknown){
    const scope=this.ctx.dafeiyu.scopeFor(context),job=this.queue.get(scope,z.uuid().parse(id));
    return job?this.summary(job):{status:'not_found' as const};
  }
  async inspect(context:ConversationAccess,id:unknown){
    const scope=this.ctx.dafeiyu.scopeFor(context),job=this.queue.get(scope,z.uuid().parse(id));
    if(!job)return {status:'not_found' as const};
    // Terminal grants are revoked. Explicit read receives its own short-lived grant.
    const grantId=this.ctx.dafeiyu.issueAnalysisGrant(context);
    try{
      await this.sources.validate(grantId,job.sources,context.signal);
      for(const target of job.targets)if(!this.memories.read(scope,target.item.id,'history',target.item.revision))throw new AnalysisError('source_unavailable');
      for(const candidate of job.candidates)if(candidate.receipt&&!this.memories.read(scope,candidate.receipt.id,'history',candidate.receipt.revision))throw new AnalysisError('source_unavailable');
      this.ctx.dafeiyu.scopeFor(context);
      return {...this.summary(job),untrustedEvidence:true,useRestriction:'analysis_read_only',result:job.result??null,
        model:job.model,policyVersion:'literal-evidence-v1',inputGeneration:job.inputGeneration,
        sources:job.sources.map(({text:_text,...source})=>source),
        targets:job.targets.map(({item})=>({id:item.id,version:item.version,revision:item.revision})),
        candidates:job.candidates.map(({command:_command,...candidate})=>candidate)};
    }finally{this.ctx.dafeiyu.revokeAnalysisGrant(grantId);}
  }
  cancel(context:ConversationAccess,id:unknown){
    const scope=this.ctx.dafeiyu.scopeFor(context),job=this.queue.get(scope,z.uuid().parse(id));
    if(!job)return {status:'not_found' as const};
    if(['queued','running','committing'].includes(job.state)){
      if(this.active?.id===job.id)this.cancelled.add(job.id);
      job.state='cancelled';job.error='cancelled';
      for(const candidate of job.candidates)if(candidate.status==='ready'){candidate.status='stale';candidate.reason='cancelled';}
      this.queue.save(job);this.flush();
      this.ctx.dafeiyu.revokeAnalysisGrant(job.grantId);
      if(this.active?.id===job.id)this.active.abort.abort();
    }
    return this.summary(job);
  }
  private validateGeneration(job:AnalysisJob):OperationScope{
    const scope=this.scope(job.grantId);
    if(this.memories.generation(scope)!==job.generation)throw new AnalysisError('version_conflict');
    return scope;
  }
  private flush():void{
    this.memories.drainOutbox((event,id)=>{this.ctx.dafeiyu.journal.appendOnce(event,id);});
    this.queue.flush((event,id)=>{this.ctx.dafeiyu.journal.appendOnce(event,id);});
  }
  private async execute(job:AnalysisJob,signal:AbortSignal):Promise<void>{
    if(JSON.stringify(job.model)!==JSON.stringify(this.ctx.dafeiyu.analysisModelRoute()))throw new AnalysisError('model_route_changed');
    if(!job.result){
      this.validateGeneration(job);
      await this.sources.validate(job.grantId,job.sources,signal);
      this.validateGeneration(job);
      job.state='running';job.attempts++;this.queue.save(job);
      const output=await this.runtime.run(job,signal).catch(error=>{
        signal.throwIfAborted();
        if(error instanceof AnalysisError)throw error;
        throw new AnalysisError('model_failed');
      });
      const result=resultSchema.parse(redactJson(z.json().parse(output)).value);
      signal.throwIfAborted();
      this.validateGeneration(job);
      job.candidates=candidates(job,result);job.result=result;job.state='committing';this.queue.save(job);
    }
    for(const candidate of job.candidates){
      if(candidate.status!=='ready'||!candidate.command)continue;
      signal.throwIfAborted();
      const scope=this.scope(job.grantId);
      // Reconcile BEFORE checking changed generation: a crash may have occurred after memory COMMIT.
      let receipt=this.memories.receipt(scope,candidate.command);
      if(!receipt){
        await this.sources.validate(job.grantId,job.sources,signal);
        this.validateGeneration(job);
        if(candidate.command.action==='revise'){
          const target=this.memories.read(scope,candidate.command.id);
          if(!target||target.version!==candidate.command.expectedVersion)throw new AnalysisError('version_conflict');
        }
        if(candidate.command.action==='create'&&[...this.memories.current(scope)].some(item=>item.content===candidate.command!.value?.content)){
          candidate.status='duplicate';candidate.reason='already_present';this.queue.save(job);continue;
        }
        if(candidate.command.action==='create'&&[...this.memories.current(scope)].some(item=>item.content.includes(candidate.claim.subject))){
          candidate.status='needs_review';candidate.reason='existing_topic_requires_comparison';this.queue.save(job);continue;
        }
        // Persist the precise request before mutation; retries must use the identical fingerprint.
        candidate.command={...candidate.command,expectedGeneration:job.generation};this.queue.save(job);
        signal.throwIfAborted();this.scope(job.grantId);
        const {duplicate:_duplicate,...committed}=this.memories.mutate(scope,candidate.command);
        receipt=committed;
      }
      if(receipt.generation===undefined)throw new AnalysisError('invalid_receipt');
      candidate.receipt=receipt;candidate.status='committed';candidate.reason='published';job.generation=receipt.generation;
      this.queue.save(job);this.flush();
    }
    job.state='completed';this.queue.save(job);
  }
  private async drain():Promise<void>{
    this.flush();
    while(!this.stopping&&this.enabled&&this.canRun()){
      const job=this.queue.firstPending();
      if(!job)break;
      const abort=new AbortController();this.active={id:job.id,abort};
      const timeout=AbortSignal.timeout(this.config.timeoutMs),signal=AbortSignal.any([abort.signal,timeout]);
      try{await this.execute(job,signal);}
      catch(error){
        if(this.cancelled.has(job.id)){
          // cancel() already durably saved the terminal state and its audit event.
          job.state='cancelled';job.error='cancelled';
        }else{
          if(this.stopping){if(job.state==='running')job.state='queued';this.queue.save(job);break;}
          if(!signal.aborted&&!(error instanceof AnalysisError)&&!(error instanceof MemoryError))throw error;
          job.state='failed';job.error=timeout.aborted?'timeout':error instanceof AnalysisError||error instanceof MemoryError?error.code:'analysis_failed';
          for(const candidate of job.candidates)if(candidate.status==='ready'){candidate.status='stale';candidate.reason=job.error;}
          this.queue.save(job);
        }
      }finally{this.active=undefined;}
      if(!this.stopping){
        this.flush();
        this.ctx.dafeiyu.revokeAnalysisGrant(job.grantId);this.cancelled.delete(job.id);
      }
    }
  }
  async close():Promise<void>{
    this.stopping=true;this.active?.abort.abort();
    await this.worker;
    try{await this.runtime.close();}finally{this.queue.close();}
  }
}
