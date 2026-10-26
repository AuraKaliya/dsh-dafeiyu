import type { Context } from '@deepseek-ai/cordis';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { redactContent,redactJson,FeedbackMetaSchema,PersonaSourceRefSchema,ActionOutcomeSchema } from '@dafeiyu/contracts';
import type { SourceDependency,SourcePolicy,CompactionScope,ContextItem } from '@dafeiyu/contracts';
import type { MemoryStore } from './store.js';
import type { WorkingMemory } from './working.js';
import type { ToolFeedbackArchive } from './feedback.js';
import { memoryRefPattern,sourceVersionSchema,sourceFenceSchema } from './types.js';

const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const memoryView=z.object({id:z.string(),revision:z.number(),version:z.number(),contentHash:z.string(),sourceVersions:z.array(sourceVersionSchema).optional(),sourceFences:z.array(sourceFenceSchema).optional()});
const scoped=(scope:CompactionScope)=>({agentId:scope.agentId,route:scope.route});
/** Checks authoritative stores, never a model-authored citation or an index's cached state. */
export class MemorySourcePolicy implements SourcePolicy {
  constructor(private readonly ctx:Context,private readonly memory:MemoryStore,private readonly working:WorkingMemory|null,
    private readonly feedback:ToolFeedbackArchive|null,private readonly epoch:(scope:CompactionScope)=>string){}
  private missing(scope:CompactionScope):SourceDependency[]{return [{...scoped(scope),kind:'unavailable',reason:'source-unavailable'}];}
  private match(scope:CompactionScope,sourceRef:string){return (ref:string)=>this.ctx.dafeiyuTimeline.sameArchivedSource(scope,sourceRef,ref);}
  private inboundMatch(scope:CompactionScope,id:string){return (ref:string)=>this.ctx.dafeiyuTimeline.matchesInboundSource(scope,ref,id);}
  private message(scope:CompactionScope,id:string):string|null {
    const item=this.ctx.dafeiyu.journal.messageFor(scope,id);if(!item||this.ctx.dafeiyu.journal.messageRecalled(scope,id))return null;
    return redactContent(JSON.stringify(redactJson({sender:item.message.sender,occurredAt:item.message.occurredAt,text:item.message.text}).value,null,2)).value;
  }
  inbound(scope:CompactionScope,id:string):SourceDependency[]{
    const text=this.message(scope,id);if(text===null)return this.missing(scope);const hash=digest(text);
    return [{...scoped(scope),kind:'inbound',id,hash,fence:this.memory.sourceFence(scope,hash,this.inboundMatch(scope,id))}];
  }
  private timeline(scope:CompactionScope,ref:string,hash:string):SourceDependency {
    return {...scoped(scope),kind:'timeline',ref,hash,fence:this.memory.sourceFence(scope,hash,this.match(scope,ref))};
  }
  private roots(scope:CompactionScope,id:string,revision:number):SourceDependency[]{
    return this.memory.provenance(scope,id,revision).flatMap(item=>[
      {...scoped(scope),kind:'memory' as const,id:item.id,revision:item.revision,version:item.version,hash:item.contentHash},
      ...item.sources.flatMap(source=>source.kind==='timeline'?[this.timeline(scope,source.ref,source.contentHash)]:[]),
    ]);
  }
  context(scope:CompactionScope,region:string,item:ContextItem):SourceDependency[]{
    try{
      if(region==='task-workspace'||region==='growth')return [{...scoped(scope),kind:'context',owner:'memory',region,id:item.id,version:item.version,hash:digest(JSON.stringify([item.text,item.sources]))}];
      const result:SourceDependency[]=[];
      if(region==='working'){
        const work=this.working?.sourceItem(scope,item.id);
        if(!work||String(work.revision)!==item.version)return this.missing(scope);
        result.push({...scoped(scope),kind:'working',id:work.id,taskId:work.taskId,revision:work.revision,hash:work.hash});
      }
      // Evidence's first source is the selected memory. Its entire ancestry is captured
      // from the store; parent citation revision numbers are not mistaken for state versions.
      for(const source of region==='evidence'?item.sources.slice(0,1):item.sources){
        const match=memoryRefPattern.exec(source.ref);
        if(match){
          const root=this.memory.read(scope,match[1]!,'normal',Number(match[2]));
          if(!root||root.version!==Number(source.version)||root.contentHash!==source.hash)return this.missing(scope);
          result.push(...this.roots(scope,root.id,root.revision));
        }else result.push(this.timeline(scope,source.ref,source.hash));
      }
      return result;
    }catch{return this.missing(scope);}
  }
  tool(scope:CompactionScope,name:string,text:string,meta:unknown):SourceDependency[]{
    try{
      const data:unknown=JSON.parse(text);
      if(name==='qq_browse'){
        const outcome=ActionOutcomeSchema.parse(data);if(outcome.data===null)return [];
        const view=z.object({page:z.json(),observation:z.object({source:PersonaSourceRefSchema})}).parse(outcome.data),ref=view.observation.source;
        if(!this.ctx.dafeiyu.capabilityObservationCurrent(scope,ref,digest(JSON.stringify(view.page))))return this.missing(scope);
        return [{...scoped(scope),kind:'capability',ref}];
      }
      if(name==='dafeiyu_media_read'||name==='qq_media_list'){
        const outcome=ActionOutcomeSchema.parse(data);if(outcome.status!=='succeeded'||outcome.data===null)return [];
        const value=z.record(z.string(),z.json()).parse(outcome.data);if(value.observation===undefined)return [];
        const observation=z.object({source:PersonaSourceRefSchema}).parse(value.observation),{observation:_observation,...view}=value;
        const actual=name==='dafeiyu_media_read'?z.string().parse(view.text):JSON.stringify(view);
        if(!this.ctx.dafeiyu.capabilityObservationCurrent(scope,observation.source,digest(actual)))return this.missing(scope);
        return [{...scoped(scope),kind:'capability',ref:observation.source}];
      }
      if(['qq_groups','qq_observe_select','dafeiyu_media_select','dafeiyu_media_acquire','dafeiyu_media_inspect','dafeiyu_media_reply','dafeiyu_media_reply_status'].includes(name))return [];
      if(name==='dafeiyu_source_open'||name.includes('_deleted_')||name==='dafeiyu_memory_analysis_open'
        ||name==='dafeiyu_tool_feedback_open'||/deleted_lookup_only|historical_evidence_only/.test(text))return [{...scoped(scope),kind:'ephemeral',traceId:scope.traceId}];
      const feedback=z.object({dafeiyuFeedback:FeedbackMetaSchema}).safeParse(meta);
      if(feedback.success){
        const witness=feedback.data.dafeiyuFeedback.witness;
        if(witness.view!=='brief'||witness.mode!=='normal')return [{...scoped(scope),kind:'ephemeral',traceId:scope.traceId}];
        const record=this.feedback?.sourceRecord(scope,witness.id);if(!record||record.version!==witness.version||record.archive.hash!==witness.hash)return this.missing(scope);
        return [{...scoped(scope),kind:'feedback',id:witness.id,version:witness.version,hash:witness.hash},
          ...record.archive.dependencies.flatMap(source=>source.evidence.kind==='memory'?this.roots(scope,source.evidence.id,source.evidence.revision)
            :[this.timeline(scope,source.evidence.ref,source.evidence.contentHash)])];
      }
      if(['dafeiyu_memory_open','dafeiyu_memory_search','dafeiyu_memory_recall'].includes(name)){
        const result=z.object({item:memoryView.optional(),items:z.array(memoryView).optional()}).parse(data);
        const refs=result.item?[result.item]:result.items??[];
        return refs.flatMap(ref=>{
          const root=this.memory.read(scope,ref.id,'normal',ref.revision);
          if(!root||root.version!==ref.version||root.contentHash!==ref.contentHash)return this.missing(scope);
          return ref.sourceVersions&&ref.sourceFences?[...ref.sourceVersions.map(s=>({...scoped(scope),kind:'memory' as const,id:s.id,revision:s.revision,version:s.version,hash:s.contentHash})),
            ...ref.sourceFences.map(s=>({...scoped(scope),kind:'timeline' as const,ref:s.ref,hash:s.contentHash,fence:s.fence}))]
            :[{...scoped(scope),kind:'legacy' as const,epoch:this.epoch(scope)}];
        });
      }
      // Commands with receipt-only return values expose no remembered body.
      if(['dafeiyu_memory_record','dafeiyu_memory_revise','dafeiyu_memory_delete','dafeiyu_memory_restore',
        'dafeiyu_memory_working_set','dafeiyu_memory_context_select','dafeiyu_memory_context_retrieve','dafeiyu_memory_context_clear',
        'dafeiyu_memory_context_status','dafeiyu_memory_analyze','dafeiyu_memory_analysis_status','dafeiyu_memory_analysis_cancel',
        'dafeiyu_tool_feedback_delete','dafeiyu_tool_feedback_restore'].includes(name))return [];
      return [{...scoped(scope),kind:'legacy',epoch:this.epoch(scope)}];
    }catch{return this.missing(scope);}
  }
  validate(scope:CompactionScope,dep:SourceDependency):boolean {
    if(dep.agentId!==scope.agentId||dep.route!==scope.route)return false;
    try{switch(dep.kind){
      case 'capability':return this.ctx.dafeiyu.capabilityObservationCurrent(scope,dep.ref);
      case 'memory':{const item=this.memory.read(scope,dep.id,'normal',dep.revision);return !!item&&item.version===dep.version&&item.contentHash===dep.hash;}
      case 'inbound':{const text=this.message(scope,dep.id),match=this.inboundMatch(scope,dep.id);return text!==null&&digest(text)===dep.hash&&!this.memory.suppressedEvidence(scope,dep.hash,match)&&this.memory.sourceFence(scope,dep.hash,match)===dep.fence;}
      case 'timeline':{const match=this.match(scope,dep.ref);return this.ctx.dafeiyuTimeline.checkArchivedSource(scope,dep.ref,dep.hash)&&!this.memory.suppressedEvidence(scope,dep.hash,match)&&this.memory.sourceFence(scope,dep.hash,match)===dep.fence;}
      case 'working':{const item=this.working?.sourceItem(scope,dep.id);return !!item&&item.taskId===dep.taskId&&item.revision===dep.revision&&item.hash===dep.hash;}
      case 'feedback':{const item=this.feedback?.sourceRecord(scope,dep.id);return !!item&&item.version===dep.version&&item.archive.hash===dep.hash;}
      case 'ephemeral':return dep.traceId===scope.traceId;
      case 'legacy':return dep.epoch===this.epoch(scope);
      default:return false;
    }}catch{return false;}
  }
}
