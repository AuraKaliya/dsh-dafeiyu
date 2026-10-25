import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { Session } from '@deepseek-ai/dsh-session';
import { executionHarness } from './execution-fixture.js';
import { textReply } from './harness.js';
import { testTempDir } from './test-temp.js';
import { readSummaryArtifacts,summaryReference,resolveFragmentView } from '../packages/core/lib/summary-fragments.js';
import { z } from 'zod';

test('native summary proofs recognize actual task inputs and reject forged task or sender identities',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-summary-proof-')),long='虚构原生历史：保留未确认的数量与反证，不声称已经完成。'.repeat(75),h=await executionHarness(root,r=>r.purpose==='compaction'?textReply('{"fragments":[{"kind":"constraint","text":"原生历史仍未确认，反证未排除，不得虚称完成。"}]}'):textReply(long),undefined,true,{compaction:{inputTokens:2048,thresholdRatio:0.6,targetRatio:0.3,minGrowthTokens:0,minSavingsTokens:64,cooldownMs:0,retainTurns:1,maxSummaryChars:400},sourceTracking:true});
  try{const first=h.port.submitTask({requestId:'first',title:'原生摘要证明',goal:'只读取虚构历史并保留限定',policyId:'test-policy'});await h.core.whenIdle();let sessionId=h.port.status(first.run).result!.sessionId;
    for(let i=0;i<5;i++){const run=h.port.submitTask({requestId:'next-'+i,taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await h.core.whenIdle();assert.equal(h.port.status(run.run).state,'completed');sessionId=h.port.status(run.run).result!.sessionId;}
    const session=h.ctx.agents.get(SessionId(sessionId))!.session,manifests=readSummaryArtifacts(session).filter(r=>r.type==='plugin:dafeiyu/summary-manifest');assert.ok(manifests.length);const resolved=manifests.map(m=>({m,view:resolveFragmentView(session,summaryReference(m.seq,m.data),{agentId:m.data.agentId,route:m.data.route})})).find(p=>p.view);assert.ok(resolved,'a committed native summary must remain resolvable');
    const sourceSeq=resolved.m.data.groups.flatMap(g=>g.inputs).find(i=>i.role==='user')!.seq,original=session.snapshotEvents();
    const altered=(mode:'unchanged'|'other-run'|'human')=>{const events=[...structuredClone(original)],event=events[sourceSeq]!;assert.equal(event.type,'user/message');if(event.type==='user/message'&&mode!=='unchanged')events[sourceSeq]={...event,data:{...event.data,source:mode==='human'?{kind:'user'}:{...event.data.source,runId:randomUUID()} as typeof event.data.source}};
      return new Proxy(session,{get(target,key){if(key==='snapshotEvents')return ()=>events;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}) as Session;};
    const ref=summaryReference(resolved.m.seq,resolved.m.data),scope={agentId:resolved.m.data.agentId,route:resolved.m.data.route};assert.ok(resolveFragmentView(altered('unchanged'),ref,scope));assert.equal(resolveFragmentView(altered('other-run'),ref,scope),null);assert.equal(resolveFragmentView(altered('human'),ref,scope),null);
  }finally{await h.close();}
});

test('native tasks forward guarded semantic generation and verification into a live second-generation view',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-rewrite-')),long='虚构记录仍未核验，反证未排除。'+'白帆轻轻掠过水面，远处是连绵的山影。'.repeat(130),verboseA='这一条虚构记录的数量尚未被确认，需要保留尚未确认的限定。'.repeat(8),verboseB='另一条虚构记录的反证仍未排除，需要保留尚未排除的限定。'.repeat(8);
  const h=await executionHarness(root,r=>{const session=String(r.sessionId);if(session.startsWith('memory-semantic-verify-'))return textReply('{"compatible":true,"faithful":true,"issues":[]}');if(session.startsWith('memory-semantic-generate-')){const block=r.messages.at(-1)!.content.find(b=>b.type==='text')!;assert.equal(block.type,'text');const input=z.object({qualifiers:z.array(z.object({text:z.string()}))}).parse(JSON.parse(block.type==='text'?block.text:''));return textReply(JSON.stringify({fragment:{kind:'constraint',text:input.qualifiers.map(q=>q.text).join('')||'虚构记录仍未核验，不能当作完成，也不能删除反证。'}}));}return r.purpose==='compaction'?textReply(JSON.stringify({fragments:[{kind:'uncertainty',text:verboseA},{kind:'constraint',text:verboseB}]})):textReply(long);},undefined,true,{sourceTracking:true,compaction:{inputTokens:2048,thresholdRatio:0.6,targetRatio:0.3,minGrowthTokens:0,minSavingsTokens:64,cooldownMs:0,retainTurns:1,maxSummaryChars:4000,semanticEnabled:true,semanticMaxOutputTokens:8192}});
  try{const first=h.port.submitTask({requestId:'first',title:'原生重写接线',goal:'只检查虚构记录。尚未核验。',policyId:'test-policy'});await h.core.whenIdle();let sessionId=h.port.status(first.run).result!.sessionId;for(let i=0;i<7;i++){const run=h.port.submitTask({requestId:'next-'+i,taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await h.core.whenIdle();assert.equal(h.port.status(run.run).state,'completed');sessionId=h.port.status(run.run).result!.sessionId;}
    assert.ok(h.adapter.requests.some(r=>String(r.sessionId).startsWith('memory-semantic-generate-')));assert.ok(h.adapter.requests.some(r=>String(r.sessionId).startsWith('memory-semantic-verify-')));const session=h.ctx.agents.get(SessionId(sessionId))!.session,manifests=readSummaryArtifacts(session).filter(e=>e.type==='plugin:dafeiyu/summary-manifest');assert.ok(manifests.some(m=>m.data.rewrite&&resolveFragmentView(session,summaryReference(m.seq,m.data),{agentId:m.data.agentId,route:m.data.route})?.view.active.length));
  }finally{await h.close();}
});
