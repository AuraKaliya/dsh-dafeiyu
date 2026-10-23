import { z } from 'zod';
import { resolve } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { ToolFeedbackSchema,redactJson,redactContent,FeedbackWitnessSchema,FeedbackCaptureError } from '@dafeiyu/contracts';
import type { ActionContext,FeedbackDelivery,FeedbackRequest,FeedbackWitness,FeedbackProvider,ToolFeedback,Json,OperationScope } from '@dafeiyu/contracts';
import { FeedbackStore,digestText } from './feedback-store.js';
import type { FeedbackRecord,FeedbackHeaderRecord,FeedbackDependency } from './feedback-store.js';
import type { Evidence } from './types.js';
import { MemoryError,keySchema } from './types.js';
import { MemoryStore } from './store.js';

export const feedbackConfigSchema=z.strictObject({maxArchiveBytes:z.number().int().min(1024).max(8388608).default(2097152),
  maxBriefBytes:z.number().int().min(4096).max(65536).default(8192),maxPageChars:z.number().int().min(100).max(4000).default(1500)});
const refPattern=/^dafeiyu:feedback:([a-f0-9-]{36}):1$/;
const ref=(id:string)=>`dafeiyu:feedback:${id}:1`;
const pageSchema=z.strictObject({ref:z.string().max(200),expectedVersion:z.number().int().positive(),mode:z.enum(['normal','history']).default('normal'),
  section:z.enum(['document','data','diagnostics','receipts']).default('document'),
  offset:z.number().int().nonnegative().default(0),limit:z.number().int().positive().max(4000).optional(),cursor:z.string().max(2048).optional()});
const changeSchema=z.strictObject({ref:z.string().max(200),expectedVersion:z.number().int().positive(),requestId:keySchema,reason:z.string().min(1).max(500)});
const listSchema=z.strictObject({mode:z.enum(['normal','history','deleted']).default('normal'),limit:z.number().int().min(1).max(50).default(20)});
type Scope=Pick<OperationScope,'agentId'|'route'|'traceId'>;
type State='valid'|'changed'|'deleted'|'unavailable';
export function unknownFeedback(code:string):ToolFeedback{return {schemaVersion:1,outcome:'unknown',effects:'unknown',completeness:'unknown',resourceVersion:'unknown',
  summary:'未获得可验证的完整工具结果；确认已有副作用后再决定后续操作。',diagnostics:[{code,message:'不能将此状态解释为操作成功或确定未执行。'}],receipts:[],sourceRefs:[],data:null};}
const json=(value:unknown):Json=>z.json().parse(value);

/** Opt-in, deterministic presentation. No model summarizer and no tool replay. */
export class ToolFeedbackArchive implements FeedbackProvider {
  private readonly store:FeedbackStore;
  private readonly config:z.output<typeof feedbackConfigSchema>;
  constructor(private readonly ctx:Context,private readonly memories:MemoryStore,directory:string,config:z.input<typeof feedbackConfigSchema>,
    private readonly evidence:(context:ActionContext,refs:readonly string[])=>Promise<Evidence[]>,private readonly strictSources=false){
    this.config=feedbackConfigSchema.parse(config);this.store=new FeedbackStore(resolve(directory,'feedback.sqlite'));this.flush();
  }
  private scope(context:ActionContext){return this.ctx.dafeiyu.scopeFor(context);}
  mutationEpoch(scope:Scope):number{return this.store.mutationEpoch(scope);}
  sourceRecord(scope:Scope,id:string){const record=this.store.header(scope,id);return record&&this.state(scope,record)==='valid'?record:null;}
  private match(scope:Scope,ref:string){return (other:string)=>this.ctx.dafeiyuTimeline.sameArchivedSource(scope,ref,other);}
  private id(value:string):string{const match=refPattern.exec(value);if(!match)throw new MemoryError('not_found');return z.uuid().parse(match[1]);}
  private state(scope:Scope,record:FeedbackHeaderRecord):State{
    if(record.archive.rejectedSources)return 'unavailable';
    let changed=false,deleted=record.deleted;
    for(const source of record.archive.dependencies){
      if(this.strictSources&&(!source.sourceFences||(source.evidence.kind==='memory'&&!source.ancestors)))changed=true;
      if(source.sourceFences?.some(s=>this.memories.sourceFence(scope,s.contentHash,this.match(scope,s.ref))!==s.fence))changed=true;
      if(source.ancestors?.some(s=>{const parent=this.memories.read(scope,s.id,'normal',s.revision);return !parent||parent.version!==s.version||parent.contentHash!==s.contentHash;}))changed=true;
      const e=source.evidence;
      if(e.kind==='memory'){
        if(this.memories.read(scope,e.id,'deleted',e.revision)){deleted=true;continue;}
        const current=this.memories.read(scope,e.id,'normal',e.revision);
        if(!current||current.version!==source.version||current.contentHash!==e.contentHash)changed=true;
      }else{
        if(this.memories.suppressedEvidence(scope,e.contentHash,this.match(scope,e.ref))){deleted=true;continue;}
        if(!this.ctx.dafeiyuTimeline.checkArchivedSource(scope,e.ref,e.contentHash))return 'unavailable';
      }
    }
    return deleted?'deleted':changed?'changed':'valid';
  }
  private admitted(state:State,mode:FeedbackWitness['mode']):boolean{return mode==='deleted'?state==='deleted':mode==='history'?state==='valid'||state==='changed':state==='valid';}
  validate(scope:Scope,witness:FeedbackWitness):boolean{
    try{
      const record=this.store.header(scope,witness.id);
      return !!record&&record.version===witness.version&&record.archive.hash===witness.hash
        &&(witness.mode==='normal'&&witness.view==='brief'||witness.traceId===scope.traceId)&&this.admitted(this.state(scope,record),witness.mode);
    }catch{return false;}
  }
  private witness(scope:Scope,record:FeedbackRecord,mode:FeedbackWitness['mode']):FeedbackWitness{
    return {id:record.archive.id,version:record.version,hash:record.archive.hash,mode,view:'brief',traceId:scope.traceId};
  }
  private brief(record:FeedbackRecord):Json{
    const a=record.archive,r=a.report;
    const result:Record<string,Json>={kind:'dafeiyu-tool-feedback',outcome:r.outcome,effects:r.effects,completeness:r.completeness,resourceVersion:r.resourceVersion,
      diagnosticCodes:r.diagnostics.map(d=>d.code),diagnosticCount:r.diagnostics.length,receiptCount:r.receipts.length,
      archive:{ref:ref(a.id),version:record.version,hash:a.hash,contentRevision:1,redacted:a.redacted,origin:a.origin,capturedAt:a.createdAt},
      untrustedEvidence:true,useRestriction:'historical_tool_observation',snapshotOnly:true,readTool:'dafeiyu_tool_feedback_open',
      presentation:'abridged',omittedFields:[]};
    const omitted:string[]=[];
    for(const [key,value] of Object.entries({summary:r.summary,diagnostics:r.diagnostics,receipts:r.receipts})){
      const candidate={...result,[key]:value};
      if(Buffer.byteLength(JSON.stringify(candidate),'utf8')<=this.config.maxBriefBytes-1024)result[key]=json(value);else omitted.push(key);
    }
    const data=a.preview.text;
    let text='';let count=0;
    for(const point of data){if(count>=600)break;const candidate={...result,preview:{text:text+point,offsetUnit:'unicode-codepoint',hasMore:true},omittedFields:omitted};
      if(Buffer.byteLength(JSON.stringify(candidate),'utf8')>this.config.maxBriefBytes-640)break;text+=point;count++;}
    result.preview={text,path:'$.data',offsetUnit:'unicode-codepoint',hasMore:count<a.preview.totalChars};result.omittedFields=omitted;
    if(Buffer.byteLength(JSON.stringify(result),'utf8')>this.config.maxBriefBytes-512)throw new Error('Feedback brief budget exhausted');
    return result;
  }
  async capture(request:FeedbackRequest,raw:Json):Promise<FeedbackDelivery>{
    const scope=this.scope(request.context),clean=redactJson(raw),body=JSON.stringify(clean.value,null,2);
    const parsed=ToolFeedbackSchema.safeParse(clean.value);
    const report=parsed.success?parsed.data:unknownFeedback('INVALID_FEEDBACK_REPORT');
    if(Buffer.byteLength(body,'utf8')>this.config.maxArchiveBytes)throw new FeedbackCaptureError('ARCHIVE_CAPACITY_EXCEEDED');
    let rejectedSources=false;const dependencies:FeedbackDependency[]=[];
    try{
      for(const e of await this.evidence(request.context,report.sourceRefs)){
        this.scope(request.context);
        if(e.kind==='memory'){
          const memory=this.memories.read(scope,e.id,'normal',e.revision);if(!memory||memory.contentHash!==e.contentHash)throw new MemoryError('source_unavailable');
          dependencies.push({evidence:e,version:memory.version,ancestors:[...memory.sourceVersions],sourceFences:this.memories.evidenceFences(scope,memory.id,memory.revision,(left,right)=>this.ctx.dafeiyuTimeline.sameArchivedSource(scope,left,right))});
        }else{
          if(!this.ctx.dafeiyuTimeline.checkWorkingSource(request.context,e.ref,e.contentHash))throw new MemoryError('source_unavailable');
          dependencies.push({evidence:e,version:null,sourceFences:[{ref:e.ref,contentHash:e.contentHash,fence:this.memories.sourceFence(scope,e.contentHash,this.match(scope,e.ref))}]});
        }
      }
    }catch{this.scope(request.context);rejectedSources=true;}
    this.scope(request.context);
    const {data,...metadata}=report;const dataText=typeof data==='string'?data:JSON.stringify(data);let preview='',totalChars=0;
    for(const point of dataText){if(totalChars<600)preview+=point;totalChars++;}
    const record=this.store.put(scope,{body,hash:digestText(body),report:metadata,preview:{text:preview,totalChars},origin:request.origin==='exception'?'exception':parsed.success?'returned':'invalid-result',
      redacted:clean.redacted,pluginId:request.pluginId,pluginVersion:request.pluginVersion,action:request.action,
      operationId:scope.operationId,startedEventId:scope.startedEventId,traceId:scope.traceId,dependencies,rejectedSources});
    this.flush();
    if(!this.admitted(this.state(scope,record),'normal'))return {value:{kind:'dafeiyu-tool-feedback',outcome:report.outcome,effects:report.effects,
      archiveStatus:'source_unavailable',ref:ref(record.archive.id),untrustedEvidence:true},witness:null};
    return {value:this.brief(record),witness:this.witness(scope,record,'normal')};
  }
  open(context:ActionContext,raw:unknown,deleted=false):Json{
    const scope=this.scope(context),input=pageSchema.parse(raw),mode=deleted?'deleted':input.mode;
    this.flush();
    if(deleted&&input.mode!=='normal')throw new MemoryError('not_found');
    const record=this.store.get(scope,this.id(input.ref));if(!record||!this.admitted(this.state(scope,record),mode))throw new MemoryError('not_found');
    if(record.version!==input.expectedVersion)throw new MemoryError('version_conflict');
    const fingerprint=digestText(JSON.stringify([scope.agentId,scope.route,input.ref,record.version,record.archive.hash,mode,input.section]));
    let offset=input.offset;
    if(input.cursor){
      let cursor;try{cursor=z.strictObject({fingerprint:z.string(),offset:z.number().int().nonnegative()}).parse(JSON.parse(Buffer.from(input.cursor,'base64url').toString('utf8')));}catch{throw new MemoryError('invalid_cursor');}
      if(cursor.fingerprint!==fingerprint)throw new MemoryError('stale_cursor');if(input.offset!==0)throw new MemoryError('invalid_cursor');offset=cursor.offset;
    }
    let original=record.archive.body;
    if(input.section!=='document'){
      if(record.archive.origin==='invalid-result')throw new MemoryError('not_found');
      const raw=ToolFeedbackSchema.parse(JSON.parse(original)),value=raw[input.section];
      original=typeof value==='string'?value:JSON.stringify(value,null,2);
    }
    const points=Array.from(original),limit=Math.min(input.limit??this.config.maxPageChars,this.config.maxPageChars);
    if(offset>points.length)throw new MemoryError('invalid_cursor');
    const end=Math.min(points.length,offset+limit),nextCursor=end<points.length?Buffer.from(JSON.stringify({fingerprint,offset:end})).toString('base64url'):null;
    const a=record.archive;
    this.ctx.dafeiyu.journal.append({agentId:scope.agentId,route:scope.route,traceId:scope.traceId,operationId:scope.operationId,causedBy:scope.startedEventId,
      type:'feedback.opened',plugin:'memory',pluginVersion:'0.7.0',occurredAt:new Date().toISOString(),sources:[{kind:'event',id:a.startedEventId,route:scope.route}],
      data:{archiveId:a.id,version:record.version,mode,offset,end}});
    return json({status:'ok',kind:'dafeiyu-feedback-page',ref:input.ref,version:record.version,hash:a.hash,mode,
      outcome:a.report.outcome,effects:a.report.effects,originalCompleteness:a.report.completeness,resourceVersion:a.report.resourceVersion,
      source:{plugin:a.pluginId,pluginVersion:a.pluginVersion,action:a.action,operationId:a.operationId,traceId:a.traceId,ref:`dafeiyu:event:${a.startedEventId}`,dependencies:a.dependencies},
      redacted:a.redacted,origin:a.origin,capturedAt:a.createdAt,section:input.section,dependencyState:this.state(scope,record),text:points.slice(offset,end).join(''),offset,end,totalChars:points.length,
      offsetUnit:'unicode-codepoint',hasMore:nextCursor!==null,nextCursor,untrustedEvidence:true,
      useRestriction:mode==='deleted'?'deleted_lookup_only':mode==='history'?'historical_evidence_only':'archive_read_only'});
  }
  present(context:ActionContext,raw:Json):FeedbackDelivery{
    const scope=this.scope(context);
    const parsed=z.object({status:z.literal('ok'),kind:z.literal('dafeiyu-feedback-page'),ref:z.string(),version:z.number(),hash:z.string(),mode:z.enum(['normal','history','deleted'])}).safeParse(raw);
    if(!parsed.success)return {value:raw,witness:null};
    const p=parsed.data,witness=FeedbackWitnessSchema.parse({id:this.id(p.ref),version:p.version,hash:p.hash,mode:p.mode,view:'page',traceId:scope.traceId});
    if(!this.validate(scope,witness))return {value:{status:'source_unavailable'},witness:null};
    return {value:raw,witness};
  }
  list(context:ActionContext,raw:unknown):Json{
    const scope=this.scope(context),input=listSchema.parse(raw),items=[];
    this.flush();
    for(const record of this.store.list(scope)){
      const state=this.state(scope,record);if(!this.admitted(state,input.mode))continue;
      const a=record.archive;items.push({ref:ref(a.id),version:record.version,hash:a.hash,action:a.action,plugin:a.pluginId,
        createdAt:a.createdAt,outcome:a.report.outcome,dependencyState:state});if(items.length>=input.limit)break;
    }
    return {status:'ok',mode:input.mode,items,untrustedEvidence:true};
  }
  change(context:ActionContext,raw:unknown,deleted:boolean):Json{
    const scope=this.scope(context),input=changeSchema.parse(raw);
    const receipt=this.store.change(scope,{id:this.id(input.ref),expectedVersion:input.expectedVersion,requestId:input.requestId,reason:redactContent(input.reason).value},deleted);
    const current=this.store.get(scope,receipt.id)!;
    this.flush();return {status:'ok',...receipt,visibleNow:this.state(scope,current)==='valid',deletionScope:'feedback-archive-and-controlled-views',sourceMemoriesUnchanged:true};
  }
  private flush():void{this.store.flush((event,id)=>{this.ctx.dafeiyu.journal.appendOnce(event,id);});}
  close():void{this.store.close();}
}
