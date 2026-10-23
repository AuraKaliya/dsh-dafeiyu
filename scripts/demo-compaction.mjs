import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import { readCompactionEvents } from '@dafeiyu/core';
import { memoryFixture } from '../build-tests/memory-fixture.js';

const root=resolve('.runtime/demos',`compaction-${randomUUID()}`);await mkdir(root,{recursive:true});
const h=await memoryFixture(root,{compaction:{inputTokens:5000,cooldownMs:0,minGrowthTokens:0,minSavingsTokens:64,retainTurns:1,maxSummaryChars:400},context:{}});
h.ctx.systemPrompt.context({name:'unrelated-demo',order:1,required:true,text:'独立插件区域不变'});
try{
  const evidence=await h.evidence('a','虚构测试来源：青色纸船尚未通过验证。');
  const memory=await h.probe('a',c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:'虚构纸船实验未确认成功。',sourceRefs:[evidence.ref]}));
  assert.equal(memory.status,'ok');
  for(let i=0;i<6;i++)assert.equal((await h.seed('a',`阶段${i}：`+'虚构纸船仍待验证，不能声称成功。'.repeat(200))).state,'delivered');
  const agent=h.ctx.agents.get(SessionId(evidence.message.sessionId));
  const events=readCompactionEvents(agent.session),checks=events.filter(e=>e.type==='plugin:dafeiyu/compaction-check'&&e.data.status==='compacted');
  const summaries=events.filter(e=>e.type==='compaction/summary');assert.ok(summaries.length>0);
  const report=checks.map(e=>({beforePressureEstimate:e.data.pressure,targetEstimate:e.data.target,savedDshEstimate:e.data.saved}));
  const checkpointCount=summaries.length,shadowedTokens=summaries.reduce((n,e)=>n+e.data.shadowedTokenCount,0);
  const dependentIds=agent.session.deriveMessages().filter(m=>m.role==='user'&&m.source.kind==='compact-checkpoint'
    &&m.content.some(b=>b.type==='text'&&JSON.parse(b.text).dependencies?.some(d=>d.kind==='legacy'))).map(m=>m.id);
  assert.ok(dependentIds.length);
  const originalBytes=summaries.reduce((total,e)=>total+e.data.shadowedSeqs.reduce((n,seq)=>{
    const source=events[seq];const message=source.type==='user/message'?source.data:source.type==='assistant/message'?source.data.message:null;
    return n+Buffer.byteLength(JSON.stringify(message?.content??[]));
  },0),0);
  const summaryBytes=summaries.reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e.data.summary)),0);
  await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:memory.id,expectedVersion:1,reason:'虚构删除验收'}));
  await h.seed('a','当前任务：只检查仍有效内容');
  const chat=h.adapter.requests.findLast(r=>r.purpose!=='compaction');const visible=JSON.stringify(chat.messages);
  assert.ok(!chat.messages.some(m=>dependentIds.includes(m.id)));assert.match(visible,/独立插件区域不变/);
  const result={at:new Date().toISOString(),projectVersion:'0.10.0',dsh:'0.2.1-rc.2',model:'scripted',sample:'fictional-Chinese',serverAccess:false,
    checkpointCount,shadowedTokens,originalBytes,summaryBytes,compressedBytesRatio:Number((summaryBytes/originalBytes).toFixed(4)),checks:report,
    dependentSummariesWithdrawnAfterDelete:true,unrelatedRegionPreserved:true,originalArchiveRetained:agent.session.snapshotEvents().some(e=>e.type==='compaction/summary'),
    measurement:'DSH heuristic plus UTF-8 floor; not provider billing or semantic-quality acceptance'};
  await writeFile(resolve(root,'result.json'),JSON.stringify(result,null,2)+'\n');
  await writeFile(resolve('docs/memory-phase-5b-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await h.close();}
