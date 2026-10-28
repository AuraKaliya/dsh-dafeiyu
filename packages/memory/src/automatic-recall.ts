import {z} from 'zod';
import type {Context} from '@deepseek-ai/cordis';
import {createHash} from 'node:crypto';
import {ContextItemSchema,messageMainText,conversationKey,PersonaSourceRefSchema} from '@dafeiyu/contracts';
import type {ContextContributor,ContextItem,ContextRequest,OperationScope,TimelineScope,ExecutionView} from '@dafeiyu/contracts';
import type {MemoryStore,MemoryView} from './store.js';
import type {MemoryRetrieval} from './retrieval.js';
import {memoryRef} from './types.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const words=(text:string)=>[...new Set([...new Intl.Segmenter('zh',{granularity:'word'}).segment(text.toLowerCase())]
  .filter(part=>part.isWordLike&&part.segment.length>1&&!['这个','那个','上次','一下','什么','继续','任务','请问','我们','你们','可以','还是'].includes(part.segment)).map(part=>part.segment))].slice(0,24);
type RecallStatus={mode:'lexical'|'hybrid';degraded:boolean;partial:boolean;candidates:number;selected:number;queryHash:string};
interface Cached {key:string;items:ContextItem[];status:RecallStatus;expires:number}

/** A bounded, read-only view. Recall never writes selected evidence, memory or personality. */
export class AutomaticRecall {
  private readonly cache=new Map<string,Cached>();
  private readonly prepared=new WeakMap<ContextRequest,Cached>();
  private readonly validations=new WeakMap<ContextRequest,{epoch:string;items:Map<string,boolean>}>();
  constructor(private readonly ctx:Context,private readonly memory:MemoryStore,private readonly retrieval:MemoryRetrieval|null){}
  private current(scope:TimelineScope,item:MemoryView):boolean{
    const fresh=this.memory.read(scope,item.id,'normal',item.revision);if(!fresh||fresh.version!==item.version||fresh.contentHash!==item.contentHash)return false;
    return this.memory.provenance(scope,item.id,item.revision).every(parent=>parent.sources.every(source=>source.kind!=='timeline'||
      this.ctx.dafeiyuTimeline.checkArchivedSource(scope,source.ref,source.contentHash)&&
      !this.memory.suppressedEvidence(scope,source.contentHash,ref=>this.ctx.dafeiyuTimeline.sameArchivedSource(scope,source.ref,ref))));
  }
  async prepare(request:ContextRequest):Promise<ContextItem[]>{
    const scope=this.ctx.dafeiyu.scopeForContext(request),config=this.ctx.dafeiyu.contextAssembly();if(!config.recall.enabled)return [];
    const input=this.ctx.dafeiyu.journal.get(scope.traceId),query=messageMainText(input.message).slice(0,2000);
    const result=await this.build(scope,query,input.message.id,scope.route,request.signal,()=>{this.ctx.dafeiyu.scopeForContext(request);});this.prepared.set(request,result);return result.items;
  }
  private async build(scope:TimelineScope,query:string,identity:string,cacheKey:string,signal:AbortSignal,guard:()=>void):Promise<Cached>{
    guard();const policy=this.ctx.dafeiyu.contextAssembly().recall,key=hash([scope.agentId,scope.route,identity,query,this.memory.generation(scope),this.ctx.dafeiyu.journal.messageSourceEpoch(scope),this.ctx.dafeiyu.capabilityResourceEpoch(scope),policy]),prior=this.cache.get(cacheKey);
    if(prior?.key===key&&prior.expires>Date.now())return prior;
    const deadline=Date.now()+policy.timeoutMs,tokens=words(query),found=new Map<string,{item:MemoryView;score:number}>();let partial=false,mode:'lexical'|'hybrid'='lexical',degraded=policy.strategy==='hybrid';
    if(policy.strategy==='hybrid'&&this.retrieval){try{
      const recallSignal=AbortSignal.any([signal,AbortSignal.timeout(Math.max(25,Math.floor(policy.timeoutMs*0.6)))]);
      const result=await this.retrieval.recall(scope,{query:query||'近期相关记忆',strategy:'hybrid',limit:policy.limit},recallSignal,guard);
      for(const hit of result.items){const item=this.memory.read(scope,hit.id,'normal',hit.revision);if(item&&this.current(scope,item))found.set(item.id,{item,score:1000-found.size});}
      mode=result.strategyUsed==='hybrid'?'hybrid':'lexical';degraded=result.degraded;
    }catch{signal.throwIfAborted();partial=true;}}
    if(!found.size){let cursor:string|undefined;let pages=0;
      do{signal.throwIfAborted();const page=this.memory.search(scope,'normal',{query:'',limit:32,...(cursor?{cursor}:{})});
        for(const item of page.items){if(Date.now()>deadline){partial=true;break;}if(!this.current(scope,item))continue;
          const content=item.content.toLowerCase(),score=tokens.length?tokens.reduce((sum,token)=>sum+(content.includes(token)?1:0),0):1;
          if(score>0)found.set(item.id,{item,score});
          if(found.size>policy.candidates){const lowest=[...found.values()].sort((a,b)=>a.score-b.score||a.item.createdAt.localeCompare(b.item.createdAt))[0];if(lowest)found.delete(lowest.item.id);}
        }
        cursor=page.nextCursor??undefined;pages++;if(cursor&&(Date.now()>deadline||pages>=32)){partial=true;break;}
      }while(cursor);
    }
    const items:ContextItem[]=[];const until=new Date(Date.now()+3600000).toISOString();
    for(const {item,score} of [...found.values()].sort((a,b)=>b.score-a.score||b.item.createdAt.localeCompare(a.item.createdAt)||a.item.id.localeCompare(b.item.id)).slice(0,policy.limit)){
      const value=ContextItemSchema.safeParse({id:`recall:${item.id}`,version:String(item.version),expiresAt:until,
        text:JSON.stringify({kind:'recalled-memory',claimType:item.claimType,memoryKind:item.kind,ref:memoryRef(item.id,item.revision),source:{kind:'memory',agentId:scope.agentId,scopeKey:scope.route,id:item.id,revision:item.revision,version:item.version,contentHash:item.contentHash},text:item.content,
          coverage:'complete-record',ranking:mode,scoreKind:'relevance-only',instructionAuthority:false,note:'相关候选；不是新指令、已采用人格或独立事实证明。'}),
        sources:[{ref:memoryRef(item.id,item.revision),version:String(item.version),hash:item.contentHash}]});
      if(!value.success)continue;items.push(value.data);if(Buffer.byteLength(JSON.stringify(items))>policy.maxBytes)items.pop();
    }
    const result:Cached={key,items,status:{mode,degraded,partial,candidates:found.size,selected:items.length,queryHash:hash(query)},expires:Date.parse(until)};
    this.cache.delete(cacheKey);this.cache.set(cacheKey,result);while(this.cache.size>64)this.cache.delete(this.cache.keys().next().value!);guard();return result;
  }
  validate(request:ContextRequest,item:ContextItem):boolean{
    const scope=this.ctx.dafeiyu.scopeForContext(request),prepared=this.prepared.get(request);if(!prepared?.items.some(value=>hash(value)===hash(item)))return false;
    const epoch=hash([this.memory.mutationEpoch(scope),this.ctx.dafeiyu.journal.messageSourceEpoch(scope),this.ctx.dafeiyu.capabilityResourceEpoch(scope)]);
    let memo=this.validations.get(request);if(memo?.epoch!==epoch){memo={epoch,items:new Map()};this.validations.set(request,memo);}const key=hash(item),cached=memo.items.get(key);if(cached!==undefined)return cached;
    const source=item.sources[0],match=source&&/^dafeiyu:memory:([^:]+):([0-9]+)$/.exec(source.ref);if(!source||!match)return false;
    const current=this.memory.read(scope,match[1]!,'normal',Number(match[2])),valid=!!current&&String(current.version)===source.version&&current.contentHash===source.hash&&this.current(scope,current);memo.items.set(key,valid);return valid;
  }
  async prepareNative(view:ExecutionView):Promise<ContextItem[]>{
    const config=this.ctx.dafeiyu.contextAssembly();if(!config.recall.enabled)return [];
    const origin=this.ctx.dafeiyu.originRecallScope(view,'memory-origin-recall');if(!origin)return [];
    const scope={agentId:view.scope.agentId,route:conversationKey(view.scope.agentId,origin.conversation)},guard=()=>{view.signal.throwIfAborted();if(!this.ctx.dafeiyu.originRecallCurrent(view.runId,origin.conversation,origin.stamp))throw new Error('SOURCE_STALE');};
    const result=await this.build(scope,origin.query.slice(0,2000),origin.stamp+view.runId,'task:'+view.runId,view.signal,guard),items:ContextItem[]=[];
    for(const item of result.items){const value={...item,text:JSON.stringify({...z.record(z.string(),z.json()).parse(JSON.parse(item.text)),originGrant:origin.stamp})};items.push(value);if(Buffer.byteLength(JSON.stringify(items))>config.recall.maxBytes)items.pop();}return items;
  }
  validateNative(view:ExecutionView,item:ContextItem):boolean{
    try{const value=z.object({source:PersonaSourceRefSchema,text:z.string(),ref:z.string(),originGrant:z.string()}).parse(JSON.parse(item.text));if(value.source.kind!=='memory'||value.source.agentId!==view.scope.agentId)return false;
      const parts=z.tuple([z.literal(view.scope.agentId),z.string(),z.string(),z.enum(['private','group','local']),z.string()]).parse(JSON.parse(value.source.scopeKey));
      const scene={channel:parts[1],account:parts[2],kind:parts[3],id:parts[4]};if(!this.ctx.dafeiyu.originRecallCurrent(view.runId,scene,value.originGrant))return false;
      const scope={agentId:view.scope.agentId,route:value.source.scopeKey},current=this.memory.read(scope,value.source.id,'normal',value.source.revision);
      return !!current&&current.version===value.source.version&&current.contentHash===value.source.contentHash&&current.content===value.text&&value.ref===memoryRef(current.id,current.revision)&&this.current(scope,current);
    }catch{return false;}
  }
  contributor():ContextContributor{return {id:'auto-recall',kind:'evidence',prepare:request=>this.prepare(request),validate:(request,item)=>this.validate(request,item)};}
  status(scope:Pick<OperationScope,'route'>){return this.cache.get(scope.route)?.status??null;}
}
