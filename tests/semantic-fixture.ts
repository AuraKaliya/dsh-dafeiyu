import assert from 'node:assert/strict';
import { z } from 'zod';
import { extractQualifiers } from '@dafeiyu/contracts';
import type { SemanticRequest,SemanticResult,SourceDependency } from '@dafeiyu/contracts';
import { provenanceFixture } from './provenance-fixture.js';
import { seedCheckpoint } from './composition-fixture.js';
import { textReply } from './harness.js';
import { MemoryCompaction } from '../packages/memory/lib/compaction.js';
import { MemorySourcePolicy } from '../packages/memory/lib/source-policy.js';
import { prepareSummaryRewrite } from '../packages/core/lib/summary-rewrite.js';
import { summaryReference } from '../packages/core/lib/summary-fragments.js';
import type { ResolvedFragmentView } from '../packages/core/lib/summary-fragments.js';

export const raw='晨露项目代号青羽842。仅在测试群1106067626试运行；主人确认后才能发送。尚未验收，不允许正式群发。预算上限30元，有效期截至2026-11-01。';
export function scriptedSemantic(request:{messages:readonly {content:readonly unknown[]}[]}){
  const last=request.messages.at(-1)?.content.find((b):b is {type:'text';text:string}=>typeof b==='object'&&b!==null&&'type' in b&&b.type==='text'&&'text' in b&&typeof b.text==='string');assert.ok(last);
  const body=z.object({stage:z.enum(['generate','verify']),qualifiers:z.array(z.object({text:z.string()}))}).parse(JSON.parse(last.text));
  return textReply(JSON.stringify(body.stage==='generate'?{fragment:{kind:'constraint',text:[...new Set(body.qualifiers.map(q=>q.text))].join('\n')}}:{compatible:true,faithful:true,issues:[]}));
}
export function acceptedResult(request:SemanticRequest):SemanticResult{return {fragment:{kind:'constraint',text:[...new Set(extractQualifiers(request.sources).map(q=>q.text))].join('\n')},
  qualifiers:extractQualifiers(request.sources),verification:{compatible:true,faithful:true,issues:[]},model:{provider:'local-test',model:'scripted'}};}
export async function semanticFixture(){
  const h=await provenanceFixture();await h.run('固定前缀');
  const a=await seedCheckpoint(h,raw,[{kind:'constraint',text:raw+'这段话是过程说明。'.repeat(30)},{kind:'pending',text:'尚未验收，不允许正式群发。'+'重复整理过程。'.repeat(30)}]);
  h.setCompactionResponse(scriptedSemantic);
  const scope={...a.memory.scope},policy=new MemorySourcePolicy(h.ctx,h.store,null,null,()=> 'fixture');
  const validate=(deps:readonly SourceDependency[])=>deps.every(d=>d.kind==='context'||policy.validate(scope,d));
  const provider=new MemoryCompaction(h.ctx,{inputTokens:1000000,semanticEnabled:true,timeoutMs:10000},()=>({epoch:'fixture',taskId:null,versions:{}}),policy);
  const plan=(view:ResolvedFragmentView=a.view,mode:'fusion'|'rebuild'='fusion',group='G1')=>prepareSummaryRewrite(h.session(),scope,summaryReference(view.manifestSeq,view.manifest),group,mode,
    {owner:'memory',version:'test',protectedTaskId:null,maxChars:2000,maxBytes:65536,maxConsecutive:2},validate);
  return {...h,a,scope,validate,provider,plan};
}
