import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import type { Session,SessionEvent } from '@deepseek-ai/dsh-session';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { SourceDependencySchema } from '@dafeiyu/contracts';
import type { CompactionProvider,CompactionScope,SourceDependency } from '@dafeiyu/contracts';
import type { ContextEvidenceView } from './context-runtime.js';
import type { HistoryFrame } from './history-frame.js';
import { digestSource,unionDependencies,readProvenance,eventText } from './source-records.js';
import type { SourceRecord } from './source-records.js';
export * from './source-records.js';
import { z } from 'zod';
import { dependenciesSchema } from './source-records.js';
import { fragmentCapsuleSchema,resolveFragmentView,fragmentDependencies } from './summary-fragments.js';

type Binding={owner:string;version:string;provider:CompactionProvider};

/** Immutable per-message provenance. Requests inherit every actually exposed input; model
 * citations never reduce this union. The reverse map is a rebuildable in-process index. */
export class SourceTracker {
  private item:HistoryFrame|undefined;
  private session:Session|undefined;
  private offset=0;
  private inputId:string|undefined;
  private admitted:SourceDependency[]=[];
  private records=new Map<number,SourceRecord>();
  private indexed=-1;
  private reverse=new Map<string,Set<number>>();
  private validationStamp='';
  private validationProvider:CompactionProvider|undefined;
  private validationCache=new Map<string,boolean>();
  constructor(private readonly agentId:string,private readonly binding:()=>Binding|undefined,private readonly context:ContextEvidenceView){}
  begin(item:HistoryFrame,session:Session,offset:number):void{this.item=item;this.session=session;this.offset=offset;this.admitted=[];this.indexed=-1;this.inputId=undefined;}
  expectInput(id:string):void{this.inputId=id;}
  end():void{this.item=undefined;this.admitted=[];}
  exposed():readonly SourceDependency[]{return structuredClone(this.admitted);}
  private scope():CompactionScope{if(!this.item)throw new Error('No source scope');return {agentId:this.agentId,route:this.item.route,traceId:this.item.id};}
  private common(){const b=this.binding();if(!b)throw new Error('Source provider unavailable');return {...this.scope(),owner:b.owner,producerVersion:b.version};}
  private index():void{
    if(!this.session||this.indexed===this.session.seq)return;
    const records=new Map<number,SourceRecord>(),reverse=new Map<string,Set<number>>();
    const provenance=readProvenance(this.session),requests=new Map(provenance.filter(e=>e.type==='plugin:dafeiyu/request-sources').map(e=>[Number(e.seq),e.data]));
    for(const event of provenance)if(event.type==='plugin:dafeiyu/source-record'){
      const r=event.data;
      if(r.targetSeq>=event.seq||r.parents.some(p=>p>=r.targetSeq)||records.has(r.targetSeq))throw new Error('Invalid source ancestry');
      if(r.requestSeq!==undefined){
        const request=requests.get(r.requestSeq);
        if(!request||r.requestSeq>=r.targetSeq||request.route!==r.route||request.agentId!==r.agentId||request.traceId!==r.traceId
          ||JSON.stringify(unionDependencies(r.dependencies))!==JSON.stringify(unionDependencies(request.dependencies)))throw new Error('Source exposure mismatch');
      }
      records.set(r.targetSeq,r);
      for(const dep of r.dependencies){const key=JSON.stringify(dep),targets=reverse.get(key)??new Set<number>();targets.add(r.targetSeq);reverse.set(key,targets);}
    }
    this.records=records;this.reverse=reverse;this.indexed=this.session.seq;
  }
  get(seq:number):SourceRecord|undefined{this.index();return this.records.get(seq);}
  validate(dependencies:readonly SourceDependency[]):boolean {
    const b=this.binding();if(!b||!this.item)return false;
    const scope=this.scope();
    const basis=b.provider.basis(scope),stamp=JSON.stringify([scope,basis.epoch,basis.versions]);
    if(stamp!==this.validationStamp||this.validationProvider!==b.provider){this.validationCache.clear();this.validationStamp=stamp;this.validationProvider=b.provider;}
    return dependencies.every(dep=>dep.agentId===scope.agentId&&dep.route===scope.route&&(dep.kind==='context'
      ?this.context.validateHistorical(dep):(()=>{
        const key=JSON.stringify(dep),cached=this.validationCache.get(key);if(cached!==undefined)return cached;
        const valid=b.provider.sources?.validate(scope,dep)??(dep.kind==='legacy'&&dep.epoch===b.provider.basis(scope).epoch);
        if(this.validationCache.size>=8192)this.validationCache.clear();this.validationCache.set(key,valid);return valid;
      })()));
  }
  valid(record:SourceRecord):boolean {
    return !!this.session&&record.agentId===this.agentId&&record.route===this.item?.route&&record.owner===this.binding()?.owner
      &&digestSource(eventText(this.session.snapshotEvents()[record.targetSeq])??'')===record.hash&&this.validate(record.dependencies);
  }
  invalid():Set<number>{
    this.index();const invalid=new Set<number>();
    for(const [key,seqs] of this.reverse)if(!this.validate([SourceDependencySchema.parse(JSON.parse(key))]))for(const seq of seqs)invalid.add(seq);
    const events=this.session?.snapshotEvents();
    for(const [seq,record] of this.records)if(record.agentId!==this.agentId||record.route!==this.item?.route||record.owner!==this.binding()?.owner
      ||digestSource(eventText(events?.[seq])??'')!==record.hash)invalid.add(seq);
    return invalid;
  }
  private write(event:SessionEvent,dependencies:readonly SourceDependency[],parents:number[],requestSeq?:number):void{
    if(this.get(event.seq))return;const text=eventText(event);if(text===null)return;
    appendPluginRecord(this.session!,'plugin:dafeiyu/source-record',{...this.common(),schemaVersion:1,targetSeq:event.seq,hash:digestSource(text),
      parents:[...new Set(parents)].sort((a,b)=>a-b),dependencies:unionDependencies(dependencies),...(requestSeq===undefined?{}:{requestSeq})});
  }
  /** Capture completed outputs before any pruning; record input hashes at first dispatch. */
  sync():void{
    const b=this.binding();if(!this.item||!this.session||!b?.provider.sources)return;
    const events=this.session.snapshotEvents(),requests=readProvenance(this.session).filter(e=>e.type==='plugin:dafeiyu/request-sources');
    const open=events.slice(this.offset).find(e=>e.type==='turn/start');const turn=open?.type==='turn/start'?open.data.turn:-1;
    for(const event of events.slice(this.offset)){
      if(this.get(event.seq))continue;
      if(event.type==='user/message'&&event.data.source.kind===this.item.inputKind&&event.data.id===this.inputId)this.write(event,b.provider.sources.inbound(this.scope(),this.item.inputSourceId),[]);
      if(event.type==='assistant/message'&&event.data.turn===turn){
        const request=requests.findLast(r=>r.data.turn===event.data.turn&&r.data.step===event.data.step&&r.seq<event.seq);
        this.write(event,request?.data.dependencies??[{agentId:this.agentId,route:this.item!.route,kind:'unavailable',reason:'missing-request-record'}],request?.data.parents??[],request?.seq);
      }
      if(event.type==='tool/result'&&event.data.turn===turn){
        const caller=events.findLast(e=>e.seq<event.seq&&e.type==='assistant/message'&&e.data.turn===turn
          &&e.data.message.content.some(block=>block.type==='tool-call'&&block.id===event.data.message.toolCallId));
        const call=events.find(e=>e.type==='tool/call'&&e.data.callId===event.data.message.toolCallId);
        const inherited=caller?this.get(caller.seq)?.dependencies:undefined;
        // SDK error receipts are diagnostics, not newly observed world evidence. Keep
        // their caller's dependencies so later withdrawal still retires the pair.
        const observed=event.data.message.isError===true?[]:b.provider.sources.tool(this.scope(),call?.type==='tool/call'?call.data.name:'',eventText(event)??'',event.data.meta);
        this.write(event,unionDependencies(inherited??[{agentId:this.agentId,route:this.item!.route,kind:'unavailable',reason:'missing-call-source'}],observed),caller?[caller.seq]:[]);
      }
    }
  }
  dependenciesFor(seq:number,legacyEpoch?:string):SourceDependency[]{
    const record=this.get(seq);if(record)return record.dependencies;
    const event=this.session?.snapshotEvents()[seq],text=eventText(event);
    if(event?.type==='user/message'&&(event.data.source.kind==='compact-checkpoint'||event.data.source.kind==='dafeiyu-summary-view')&&text){
      const compact=fragmentCapsuleSchema.safeParse((()=>{try{return JSON.parse(text);}catch{return null;}})());
      if(compact.success){const view=resolveFragmentView(this.session!,compact.data.ref,this.scope());return view&&view.text===text
        ?fragmentDependencies(view):[{agentId:this.agentId,route:this.item!.route,kind:'unavailable',reason:'invalid-fragment-view'}];}
      try {const value=z.object({schemaVersion:z.number(),dependencies:dependenciesSchema.optional(),epoch:z.string()}).parse(JSON.parse(text));
        if(value.schemaVersion===2&&value.dependencies)return value.dependencies;
        return [{agentId:this.agentId,route:this.item!.route,kind:'legacy',epoch:value.epoch}];
      }catch{return [{agentId:this.agentId,route:this.item!.route,kind:'unavailable',reason:'unknown-checkpoint'}];}
    }
    return [{agentId:this.agentId,route:this.item!.route,kind:'legacy',epoch:legacyEpoch??'untracked'}];
  }
  admit(options:GenerateOptions,legacy:(seq:number)=>string|undefined):void {
    if(!this.session||!this.item||!this.binding()?.provider.sources)return;
    this.sync();const b=this.binding()!,events=this.session.snapshotEvents(),visible=new Set(options.messages.map(m=>m.id));
    const deps:(readonly SourceDependency[])[]=[],parents:number[]=[];
    for(const seq of this.session.surface.nodes){
      const e=events[seq];const message=e?.type==='user/message'?e.data:e?.type==='assistant/message'||e?.type==='tool/result'?e.data.message:undefined;
      if(!message||!visible.has(message.id))continue;
      if(e?.type==='user/message'&&e.data.source.kind!==this.item.inputKind&&e.data.source.kind!=='compact-checkpoint'&&e.data.source.kind!=='dafeiyu-summary-view')continue;
      deps.push(this.dependenciesFor(seq,legacy(seq)));parents.push(seq);
    }
    for(const region of this.context.sourceItems()){
      deps.push(region.owner===b.owner?b.provider.sources!.context(this.scope(),region.region,region.item):[{
        agentId:this.agentId,route:this.item.route,kind:'context',owner:region.owner,region:region.region,id:region.item.id,version:region.item.version,
        hash:digestSource(JSON.stringify([region.item.text,region.item.sources])),
      }]);
    }
    deps.push(this.context.nativeDependencies(this.scope()));this.admitted=unionDependencies(...deps);
    if(!this.validate(this.admitted))throw new Error('Invalid exposed source');
    const step=events.findLast(e=>e.type==='step/start');if(step?.type!=='step/start')throw new Error('Missing DSH step');
    appendPluginRecord(this.session,'plugin:dafeiyu/request-sources',{...this.common(),turn:step.data.turn,step:step.data.step,parents,dependencies:this.admitted,
      contexts:this.context.sourceItems().map(r=>({owner:r.owner,region:r.region,id:r.item.id,version:r.item.version,hash:digestSource(r.item.text),sources:r.item.sources}))});
  }
  guard():void{if(this.item&&this.binding()?.provider.sources&&!this.validate(this.admitted))throw new Error('Exposed source changed after admission');}
}
