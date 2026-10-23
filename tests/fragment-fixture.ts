import assert from 'node:assert/strict';
import { z } from 'zod';
import { provenanceFixture } from './provenance-fixture.js';
import { textReply } from './harness.js';
import { readSummaryArtifacts,resolveFragmentView } from '@dafeiyu/core';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';

export const fragmentSettings={maxSummaryChars:1600,maxFragmentGroups:8,maxFragments:16,cooldownMs:600000};
export function summaryInputs(request:GenerateOptions){
  const text=request.messages.at(-1)?.content.find(b=>b.type==='text');assert.ok(text&&text.type==='text');
  return z.object({sources:z.array(z.object({seq:z.number(),role:z.string(),text:z.string()}))}).parse(JSON.parse(text.text)).sources;
}
export function fragmentReply(request:GenerateOptions){
  const inputs=summaryInputs(request),text=inputs.map(i=>i.text).join('\n');
  return textReply(JSON.stringify({fragments:text.includes('A_UNIT_ONLY')?[{kind:'fact',text:'A_FACT_ONLY：虚构A资料。'},{kind:'uncertainty',text:'A_PENDING_ONLY：尚未验证，不能认定成功。'}]
    :text.includes('B_UNIT_ONLY')?[{kind:'decision',text:'B_FACT_KEEP：虚构B资料。'},{kind:'constraint',text:'B_CONSTRAINT_KEEP：必须保留限定。'}]
    :[{kind:'note',text:`过程记录${inputs[0]?.seq}；结果未确认。`}]}));
}
export async function fragmentFixture(root?:string){
  const h=await provenanceFixture(root,30000,fragmentSettings);
  h.setCompactionResponse(fragmentReply);
  try{
    await h.run('固定前缀保留');
    const a=await h.remember('A_UNIT_ONLY：'+'虚构A材料只用于本机测试。'.repeat(200));
    const b=await h.remember('B_UNIT_ONLY：'+'虚构B材料需要保留限定。'.repeat(200));
    await h.run('旧阶段结束');await h.run('保留近期尾部');
    await h.run('CURRENT_TASK_KEEP：'+'当前任务仍在进行。'.repeat(2800));
    await h.run('CURRENT_TASK_KEEP：继续当前任务');
    const session=h.session();
    const manifest=readSummaryArtifacts(session).find(e=>e.type==='plugin:dafeiyu/summary-manifest'&&e.data.fragments.some(f=>f.text.includes('A_FACT_ONLY'))&&e.data.fragments.some(f=>f.text.includes('B_FACT_KEEP')));
    assert.ok(manifest&&manifest.type==='plugin:dafeiyu/summary-manifest','fixture must produce A and B in one committed checkpoint');
    const checkpoint=session.deriveMessages().find(m=>m.role==='user'&&m.source.kind==='compact-checkpoint'&&m.source.compactionId===manifest.data.compactionId);assert.ok(checkpoint);
    const capsule=z.object({ref:z.string()}).parse(JSON.parse(checkpoint.content.filter(b=>b.type==='text').map(b=>b.text).join('')));
    const view=()=>{const current=resolveFragmentView(session,capsule.ref,a.scope);assert.ok(current);return current;};
    return {...h,a,b,ref:capsule.ref,manifest,view,modelCalls:()=>h.adapter.requests.filter(r=>r.purpose==='compaction')};
  }catch(error){await h.close();throw error;}
}
