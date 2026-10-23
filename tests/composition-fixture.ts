import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendPluginRecord,SessionSeq } from '@deepseek-ai/dsh-session';
import { CompactionId,compactCheckpointSource } from '@deepseek-ai/dsh-compaction';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { SummaryFragment } from '@dafeiyu/contracts';
import { readCompactionEvents,readProvenance,resolveFragmentView } from '@dafeiyu/core';
import { provenanceFixture } from './provenance-fixture.js';
import { digestSource,eventText } from '../packages/core/lib/source-records.js';
import { fragmentManifestSchema,renderFragmentView,summaryReference } from '../packages/core/lib/summary-fragments.js';
import { prepareSummaryComposition,commitSummaryComposition } from '../packages/core/lib/summary-composition.js';
import type { ResolvedFragmentView } from '../packages/core/lib/summary-fragments.js';

export type CompositionHarness=Awaited<ReturnType<typeof provenanceFixture>>;
/** Scripted root summaries on real, tracked DSH turns. No unproven/raw message injection. */
export async function seedCheckpoint(h:CompositionHarness,text:string,fragments:SummaryFragment[],taskId:string|null=null){
  const memory=await h.remember(text),session=h.session();
  const seal=readCompactionEvents(session).findLast(e=>e.type==='plugin:dafeiyu/turn-seal');assert.ok(seal?.type==='plugin:dafeiyu/turn-seal');
  const seqs=seal.data.seqs.map(SessionSeq),records=readProvenance(session),events=session.snapshotEvents();
  const groups=seqs.map((seq,index)=>{
    const record=records.find(r=>r.type==='plugin:dafeiyu/source-record'&&r.data.targetSeq===seq);assert.ok(record?.type==='plugin:dafeiyu/source-record');
    return {id:`G${index+1}`,taskId,inputs:[{seq,role:events[seq]!.type==='user/message'?'user' as const:'assistant' as const,hash:digestSource(eventText(events[seq])!)}],dependencies:record.data.dependencies};
  });
  const id=CompactionId(randomUUID());
  const manifest=fragmentManifestSchema.parse({schemaVersion:1,compactionId:id,sessionId:session.id,agentId:'dafeiyu',route:memory.scope.route,owner:'memory',
    producerVersion:'test',epoch:'test',taskId,versions:{},policy:'fictional-root',policyHash:digestSource('test'),
    model:{provider:'local-test',model:'scripted'},createdAt:Date.now(),groups,
    fragments:[...fragments.map((f,i)=>({...f,id:`F${i+1}`,version:1,group:'G1'})),
      ...groups.slice(1).map((g,i)=>({kind:'note',text:'虚构助手状态：结果未确认。',id:`F${fragments.length+i+1}`,version:1,group:g.id}))]});
  // Use the registered memory owner's identity, just as the runtime does.
  const tracked=records.find(r=>r.type==='plugin:dafeiyu/source-record'&&r.data.targetSeq===seqs[0]);assert.ok(tracked?.type==='plugin:dafeiyu/source-record');
  manifest.owner=tracked.data.owner;
  session.append('compaction/start',{compactionId:id,turn:null});
  const manifestSeq=appendPluginRecord(session,'plugin:dafeiyu/summary-manifest',manifest),active=manifest.fragments.map(f=>f.id),body=renderFragmentView(manifestSeq,manifest,active);
  const viewSeq=appendPluginRecord(session,'plugin:dafeiyu/summary-view',{schemaVersion:1,manifestSeq,revision:1,previousViewSeq:null,previousCheckpointSeq:null,active,contentHash:digestSource(body)});
  const selected=new Set(seqs),meter=h.ctx.get('tokenMeter')!;
  session.append('compaction/summary',{compactionId:id,summary:[{type:'text',text:body}],shadowedRange:{start:seqs[0]!,end:seqs.at(-1)!},shadowedSeqs:seqs,
    shadowedTokenCount:meter.measure(session).nodes.filter(n=>selected.has(n.seq)).reduce((n,v)=>n+v.heuristicTokens,0),provider:'local-test',model:'scripted'});
  session.append('user/message',createUserMessage({source:compactCheckpointSource(id),content:[{type:'text',text:body}]}),
    {surfaceOp:{op:'replace',startSeq:seqs[0]!,endSeq:seqs.at(-1)!},sourceEventSeqs:[...seqs,manifestSeq,viewSeq]});
  session.append('compaction/end',{compactionId:id,turn:null});
  const ref=summaryReference(manifestSeq,manifest),view=resolveFragmentView(session,ref,memory.scope);assert.ok(view);
  return {memory,view,ref};
}
export function prepare(h:CompositionHarness,views:ResolvedFragmentView[],validate=()=>true){
  const first=views[0]!;
  return prepareSummaryComposition(h.session(),{agentId:'dafeiyu',route:first.manifest.route},views.map(v=>summaryReference(v.manifestSeq,v.manifest)),
    {owner:first.manifest.owner,version:'test',protectedTaskId:null,maxFragments:32,maxGroups:8,maxBytes:65536},validate);
}
/** Exercise lineage depth independently of the runtime's positive-savings scheduling gate. */
export function compose(h:CompositionHarness,views:ResolvedFragmentView[]){
  const plan=prepare(h,views);assert.ok(plan);return commitSummaryComposition(h.ctx,h.session(),plan,()=>true);
}
