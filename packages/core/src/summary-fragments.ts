import { z } from 'zod';
import { pluginRecordOf,SessionSeq,foldSurface } from '@deepseek-ai/dsh-session';
import type { Session,SessionEvent } from '@deepseek-ai/dsh-session';
import { SummaryFragmentSchema } from '@dafeiyu/contracts';
import type { SourceDependency,TimelineScope } from '@dafeiyu/contracts';
import { dependenciesSchema,digestSource,unionDependencies,readProvenance,eventText } from './source-records.js';
declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap {
  'dafeiyu-summary-view':{kind:'dafeiyu-summary-view';compactionId:string};
} }

const inputSchema=z.strictObject({seq:z.number().int().nonnegative(),role:z.enum(['user','assistant']),hash:z.string().length(64)});
const parentSchema=z.strictObject({ref:z.string(),manifestSeq:z.number().int().nonnegative(),viewSeq:z.number().int().nonnegative(),
  checkpointSeq:z.number().int().nonnegative(),revision:z.number().int().positive(),hash:z.string().length(64)});
const compositionSchema=z.strictObject({mode:z.literal('lossless-pack-v1'),generation:z.number().int().min(1).max(16),
  parents:z.array(parentSchema).min(1).max(8),
  lineage:z.array(z.strictObject({id:z.string(),parents:z.array(z.string()).min(1).max(256)})).min(1).max(32)});
export const fragmentManifestSchema=z.strictObject({schemaVersion:z.literal(1),compactionId:z.string(),sessionId:z.string(),agentId:z.string(),route:z.string(),owner:z.string(),
  producerVersion:z.string(),epoch:z.string(),taskId:z.string().nullable(),versions:z.record(z.string(),z.number()),policy:z.string(),policyHash:z.string(),
  model:z.strictObject({provider:z.string(),model:z.string()}),createdAt:z.number(),
  groups:z.array(z.strictObject({id:z.string().regex(/^G[1-9]\d*$/),taskId:z.string().nullable(),inputs:z.array(inputSchema).min(1),dependencies:dependenciesSchema})).min(1).max(8),
  fragments:z.array(SummaryFragmentSchema.extend({id:z.string().regex(/^F[1-9]\d*$/),version:z.literal(1),group:z.string()})).min(1).max(32),
  composition:compositionSchema.optional(),
}).superRefine((m,c)=>{
  const groups=new Set(m.groups.map(g=>g.id)),ids=new Set(m.fragments.map(f=>f.id)),inputs=m.groups.flatMap(g=>g.inputs.map(i=>i.seq));
  if(groups.size!==m.groups.length||ids.size!==m.fragments.length||(!m.composition&&new Set(inputs).size!==inputs.length)
    ||m.fragments.some(f=>!groups.has(f.group))||m.groups.some(g=>!m.fragments.some(f=>f.group===g.id)))c.addIssue({code:'custom',message:'Invalid fragment partition'});
  if(Buffer.byteLength(JSON.stringify(m))>2097152)c.addIssue({code:'custom',message:'Summary proof capacity exceeded'});
});
export type FragmentManifest=z.infer<typeof fragmentManifestSchema>;
export const fragmentViewSchema=z.strictObject({schemaVersion:z.literal(1),manifestSeq:z.number().int().nonnegative(),revision:z.number().int().positive(),
  previousViewSeq:z.number().int().nonnegative().nullable(),previousCheckpointSeq:z.number().int().nonnegative().nullable(),
  active:z.array(z.string()).max(32),contentHash:z.string().length(64)});
export type FragmentView=z.infer<typeof fragmentViewSchema>;
export const fragmentRecordSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('plugin:dafeiyu/summary-manifest'),seq:z.number().transform(SessionSeq),data:fragmentManifestSchema}),
  z.object({type:z.literal('plugin:dafeiyu/summary-view'),seq:z.number().transform(SessionSeq),data:fragmentViewSchema}),
]);
declare module '@deepseek-ai/dsh-session' { interface PluginRecordMap {
  'plugin:dafeiyu/summary-manifest':FragmentManifest;
  'plugin:dafeiyu/summary-view':FragmentView;
} }
const refPattern=/^(S[a-f0-9]{12}-[0-9a-z]{1,9})(?:\.(F[1-9]\d*))?(?:@([1-9]\d{0,8}))?$/;
export function parseSummaryReference(value:string){const match=refPattern.exec(value);return match?{bundle:match[1]!,fragment:match[2]??null,revision:match[3]?Number(match[3]):null}:null;}
export function summaryReference(seq:number,m:FragmentManifest):string{return `S${digestSource(`${m.sessionId}:${m.compactionId}`).slice(0,12)}-${seq.toString(36)}`;}
export const fragmentCapsuleSchema=z.strictObject({kind:z.literal('dafeiyu-incremental-summary'),schemaVersion:z.literal(3),ref:z.string().regex(/^S[a-f0-9]{12}-[0-9a-z]{1,9}$/),
  fragments:z.array(SummaryFragmentSchema.extend({ref:z.string()})).max(32)});
export function renderFragmentView(seq:number,m:FragmentManifest,active:readonly string[]):string {
  const ref=summaryReference(seq,m),selected=new Set(active);
  return JSON.stringify({kind:'dafeiyu-incremental-summary',schemaVersion:3,ref,
    fragments:m.fragments.filter(f=>selected.has(f.id)).map(f=>({ref:`${ref}.${f.id}`,kind:f.kind,text:f.text}))});
}
type Artifact=z.infer<typeof fragmentRecordSchema>;
const cache=new WeakMap<Session,{revision:number;records:Artifact[]}>();
/** Proofs are log-only; this index is disposable and never an authority for deletion state. */
export function readSummaryArtifacts(session:Session):readonly Artifact[]{
  const old=cache.get(session);if(old?.revision===session.seq)return old.records;
  const records=session.snapshotEvents().flatMap(event=>{const p=pluginRecordOf(event);return p&&(p.type==='plugin:dafeiyu/summary-manifest'||p.type==='plugin:dafeiyu/summary-view')?[fragmentRecordSchema.parse(p)]:[];});
  cache.set(session,{revision:session.seq,records});return records;
}
export interface ResolvedFragmentView {
  manifest:FragmentManifest;manifestSeq:SessionSeq;view:FragmentView;viewSeq:SessionSeq;checkpoint:SessionEvent<'user/message'>;text:string;
}
function inputsVerified(session:Session,manifestSeq:number,m:FragmentManifest):boolean {
  const events=session.snapshotEvents(),records=readProvenance(session).filter(r=>r.type==='plugin:dafeiyu/source-record');
  for(const group of m.groups){
    const expected:SourceDependency[][]=[];
    for(const input of group.inputs){
      const event=events[input.seq],text=eventText(event);
      if(input.seq>=manifestSeq||text===null||digestSource(text)!==input.hash
        ||(input.role==='user'?event?.type!=='user/message'||event.data.source.kind!=='user':event?.type!=='assistant/message'))return false;
      const record=records.find(r=>r.data.targetSeq===input.seq);
      if(record){
        if(record.data.agentId!==m.agentId||record.data.route!==m.route||record.data.owner!==m.owner||record.data.hash!==input.hash)return false;
        expected.push(record.data.dependencies);
      }else{
        const legacy=events.flatMap(e=>{const p=pluginRecordOf(e);if(p?.type!=='plugin:dafeiyu/turn-seal')return [];
          const value=z.object({route:z.string(),owner:z.string(),epoch:z.string(),seqs:z.array(z.number()),precision:z.string().optional()}).parse(p.data);
          return !value.precision&&value.route===m.route&&value.owner===m.owner&&value.seqs.includes(input.seq)?[value]:[];
        })[0];
        if(!legacy)return false;
        expected.push([{kind:'legacy',agentId:m.agentId,route:m.route,epoch:legacy.epoch}]);
      }
    }
    if(JSON.stringify(unionDependencies(...expected))!==JSON.stringify(unionDependencies(group.dependencies)))return false;
  }
  return true;
}
/** Deterministic composition. No model sees the other fragments; dependencies stay local.
 * Equality includes original event identities, task and the complete source-state closure. */
export function composeFragmentContent(views:readonly ResolvedFragmentView[]){
  const groups:FragmentManifest['groups']=[],fragments:FragmentManifest['fragments']=[];
  const lineage:z.infer<typeof compositionSchema>['lineage']=[];
  const groupKeys=new Map<string,string>(),fragmentKeys=new Map<string,number>();
  for(const view of views)for(const f of activeFragments(view)){
    const original=view.manifest.groups.find(g=>g.id===f.group)!;
    const content={taskId:original.taskId,inputs:[...original.inputs].sort((a,b)=>a.seq-b.seq),dependencies:unionDependencies(original.dependencies)};
    const groupKey=JSON.stringify(content);let group=groupKeys.get(groupKey);
    if(!group){group=`G${groups.length+1}`;groupKeys.set(groupKey,group);groups.push({id:group,...content});}
    const key=JSON.stringify([groupKey,f.kind,f.text]),parent=`${summaryReference(view.manifestSeq,view.manifest)}.${f.id}`;
    const duplicate=fragmentKeys.get(key);
    if(duplicate!==undefined){lineage[duplicate]!.parents.push(parent);continue;}
    const id=`F${fragments.length+1}`;fragmentKeys.set(key,fragments.length);
    fragments.push({id,version:1,group,kind:f.kind,text:f.text});lineage.push({id,parents:[parent]});
  }
  const composition=compositionSchema.parse({mode:'lossless-pack-v1',generation:1+Math.max(0,...views.map(v=>v.manifest.composition?.generation??0)),
    parents:views.map(v=>({ref:summaryReference(v.manifestSeq,v.manifest),manifestSeq:v.manifestSeq,viewSeq:v.viewSeq,
      checkpointSeq:v.checkpoint.seq,revision:v.view.revision,hash:digestSource(v.text)})),lineage});
  return {groups,fragments,composition};
}

/** Historical proof validity is separate from current surface selection. A captured parent
 * is checked at the child creation boundary, never against its later display membership. */
export function resolveFragmentProof(session:Session,reference:string,scope:TimelineScope,before=session.seq):ResolvedFragmentView|null {
  return resolveProof(session,reference,scope,before,new Map(),{remaining:256},0);
}
function resolveProof(session:Session,reference:string,scope:TimelineScope,before:number,
  memo:Map<string,ResolvedFragmentView|null>,budget:{remaining:number},depth:number):ResolvedFragmentView|null {
  const key=`${reference}@${before}`;if(memo.has(key))return memo.get(key)!;
  if(depth>16||--budget.remaining<0)return null;
  try{
    const parsed=parseSummaryReference(reference);if(!parsed)return null;
    const artifacts=readSummaryArtifacts(session).filter(r=>r.seq<before),records=artifacts.filter(r=>r.type==='plugin:dafeiyu/summary-manifest'&&summaryReference(r.seq,r.data)===parsed.bundle);
    if(records.length!==1)return null;const record=records[0]!;if(record.type!=='plugin:dafeiyu/summary-manifest')return null;
    const m=record.data,events=session.snapshotEvents().filter(e=>e.seq<before);
    if(m.sessionId!==session.id||m.agentId!==scope.agentId||m.route!==scope.route)return null;
    let inputs=m.groups.flatMap(g=>g.inputs.map(i=>i.seq));
    if(m.composition){
      const parents:ResolvedFragmentView[]=[];
      for(const p of m.composition.parents){
        if(p.manifestSeq>=record.seq||p.checkpointSeq>=record.seq||p.viewSeq>=record.seq)return null;
        const parent=resolveProof(session,p.ref,scope,record.seq,memo,budget,depth+1);
        if(!parent||parent.manifest.owner!==m.owner||parent.manifestSeq!==p.manifestSeq||parent.viewSeq!==p.viewSeq
          ||parent.checkpoint.seq!==p.checkpointSeq||parent.view.revision!==p.revision||digestSource(parent.text)!==p.hash||!parent.view.active.length)return null;
        parents.push(parent);
      }
      const computed=composeFragmentContent(parents);
      if(JSON.stringify(fragmentManifestSchema.parse({...m,...computed}))!==JSON.stringify(m))return null;
      inputs=parents.map(p=>p.checkpoint.seq);
      const surface=foldSurface(events.filter(e=>e.seq<record.seq)).nodes,start=surface.indexOf(SessionSeq(inputs[0]!));
      if(start<0||JSON.stringify(surface.slice(start,start+inputs.length))!==JSON.stringify(inputs))return null;
    }else if(!inputsVerified(session,record.seq,m))return null;
    let previous:ResolvedFragmentView|null=null;
    for(const v of artifacts){
      if(v.type!=='plugin:dafeiyu/summary-view'||v.data.manifestSeq!==record.seq)continue;
      const checkpoints=events.filter(e=>e.type==='user/message'&&(e.data.source.kind==='compact-checkpoint'||e.data.source.kind==='dafeiyu-summary-view')&&e.data.source.compactionId===m.compactionId&&e.sourceEventSeqs?.includes(v.seq));
      if(!checkpoints.length)continue;
      if(checkpoints.length!==1)return null;const checkpoint=checkpoints[0]!;if(checkpoint.type!=='user/message')return null;
      const active=m.fragments.filter(f=>v.data.active.includes(f.id)).map(f=>f.id),text=renderFragmentView(record.seq,m,active);
      if(record.seq>=v.seq||v.seq>=checkpoint.seq||JSON.stringify(active)!==JSON.stringify(v.data.active)
        ||digestSource(text)!==v.data.contentHash||eventText(checkpoint)!==text||!checkpoint.sourceEventSeqs?.includes(record.seq))return null;
      const op=checkpoint.surfaceOp;
      if(!previous){
        const summary=events[checkpoint.seq-1];
        if(v.data.revision!==1||v.data.previousViewSeq!==null||v.data.previousCheckpointSeq!==null||active.length!==m.fragments.length
          ||typeof op!=='object'||op.op!=='replace'||op.startSeq!==inputs[0]||op.endSeq!==inputs.at(-1))return null;
        if(m.composition){
          const surface=foldSurface(events.filter(e=>e.seq<checkpoint.seq)).nodes,start=surface.indexOf(SessionSeq(inputs[0]!));
          if(checkpoint.data.source.kind!=='dafeiyu-summary-view'||summary?.type!=='compaction/prune'
            ||JSON.stringify(summary.data.shadowedSeqs)!==JSON.stringify(inputs)||start<0
            ||JSON.stringify(surface.slice(start,start+inputs.length))!==JSON.stringify(inputs))return null;
        }else if(checkpoint.data.source.kind!=='compact-checkpoint'||summary?.type!=='compaction/summary'||summary.data.compactionId!==m.compactionId
          ||JSON.stringify(summary.data.shadowedSeqs)!==JSON.stringify(inputs)
          ||!events.some(e=>e.seq<record.seq&&e.type==='compaction/start'&&e.data.compactionId===m.compactionId)
          ||!events.some(e=>e.seq>checkpoint.seq&&e.type==='compaction/end'&&e.data.compactionId===m.compactionId&&e.data.error===undefined))return null;
      }else{
        const prune=events[checkpoint.seq-1];
        if(checkpoint.data.source.kind!=='dafeiyu-summary-view'||v.data.revision!==previous.view.revision+1||v.data.previousViewSeq!==previous.viewSeq||v.data.previousCheckpointSeq!==previous.checkpoint.seq
          ||active.length>=previous.view.active.length||active.some(id=>!previous!.view.active.includes(id))||typeof op!=='object'||op.op!=='replace'
          ||op.startSeq!==previous.checkpoint.seq||op.endSeq!==previous.checkpoint.seq||prune?.type!=='compaction/prune'
          ||prune.data.shadowedSeqs.length!==1||prune.data.shadowedSeqs[0]!==previous.checkpoint.seq)return null;
      }
      previous={manifest:m,manifestSeq:record.seq,view:v.data,viewSeq:v.seq,checkpoint,text};
    }
    memo.set(key,previous);return previous;
  }catch{return null;}
}
/** Normal reads require an active view; historical proof inspection cannot grant access. */
export function resolveFragmentView(session:Session,reference:string,scope:TimelineScope):ResolvedFragmentView|null {
  const proof=resolveFragmentProof(session,reference,scope);
  return proof&&session.surface.nodes.includes(proof.checkpoint.seq)?proof:null;
}
/** Display lifecycle only. Neither 'active' nor 'superseded' asserts live source validity. */
export function summarySelectionState(session:Session,reference:string,scope:TimelineScope):'active'|'withdrawn'|'superseded'|'unselected'|'unproven' {
  const proof=resolveFragmentProof(session,reference,scope);if(!proof)return 'unproven';
  if(session.surface.nodes.includes(proof.checkpoint.seq))return proof.view.active.length?'active':'withdrawn';
  for(const record of readSummaryArtifacts(session)){
    if(record.type!=='plugin:dafeiyu/summary-manifest'||!record.data.composition?.parents.some(p=>p.checkpointSeq===proof.checkpoint.seq))continue;
    if(resolveFragmentProof(session,summaryReference(record.seq,record.data),scope))return 'superseded';
  }
  return 'unselected';
}
export function activeFragments(view:ResolvedFragmentView){return view.manifest.fragments.filter(f=>view.view.active.includes(f.id));}
export function fragmentDependencies(view:ResolvedFragmentView,ids:readonly string[]=view.view.active):SourceDependency[]{
  const groups=new Set(view.manifest.fragments.filter(f=>ids.includes(f.id)).map(f=>f.group));
  return unionDependencies(...view.manifest.groups.filter(g=>groups.has(g.id)).map(g=>g.dependencies));
}
/** Uniform developer-side proof inspection; never pass this expanded object to the model. */
export function expandedFragmentProof(view:ResolvedFragmentView){return {
  kind:'dafeiyu-incremental-summary' as const,schemaVersion:2 as const,version:view.manifest.producerVersion,
  agentId:view.manifest.agentId,route:view.manifest.route,owner:view.manifest.owner,epoch:view.manifest.epoch,taskId:view.manifest.taskId,
  versions:view.manifest.versions,policy:view.manifest.policy,policyHash:view.manifest.policyHash,model:view.manifest.model,createdAt:view.manifest.createdAt,
  sources:view.manifest.groups.filter(g=>activeFragments(view).some(f=>f.group===g.id)).flatMap(g=>g.inputs.map(({seq,hash})=>({seq,hash}))),
  summary:activeFragments(view).map(f=>f.text).join('\n'),dependencies:fragmentDependencies(view),
};}
