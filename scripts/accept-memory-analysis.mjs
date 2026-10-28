import {z} from 'zod';
import {fixtureAction} from '../tests/fixture-action.js';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parseDocument } from 'yaml';

const root=resolve('.runtime/demos',`memory-analysis-${randomUUID()}`);
await mkdir(root,{recursive:true});
process.env.DSH_HOME=resolve(root,'dsh-home');
const {localHost,model}=await import('./local-host.mjs');
const {textReply,call}=await import('../build-tests/harness.js');
const Memory=await import('@dafeiyu/memory');
const {API_VERSION}=await import('@dafeiyu/contracts');
const {SessionId}=await import('@deepseek-ai/dsh-session');
// Read the current binding without displaying arbitrary configuration or credentials.
const profile=parseDocument(await readFile(join(homedir(),'.dsh/profiles/desktop/cordis.patch.yml'),'utf8'),{logLevel:'silent'}).toJS();
function routes(value,found=[]){
  if(value&&typeof value==='object'){
    if(value.provider&&value.model)found.push({provider:value.provider,model:value.model,...(value.reasoningEffort?{reasoningEffort:value.reasoningEffort}:{})});
    for(const item of Object.values(value))routes(item,found);
  }
  return found;
}
assert.ok(routes(profile).some(route=>JSON.stringify(route)===JSON.stringify(model)),'Current DSH route differs; update the local host binding before acceptance');
const h=await localHost(root,{realModel:true,timeline:true});
let fiber;
let mainResponse=()=>textReply('虚构样本已接收');
h.ctx.on('llm/stream',async function*(options,next){
  if(String(options.sessionId).startsWith('memory-analysis-')){
    assert.equal(options.tools?.length??0,0);yield* next();
  }else yield* mainResponse(options);
});
const okay=value=>{assert.equal(value.status,'ok');return value;};
async function probe(work,room='test'){
  let value,step=0;
  const handle=h.core.registerExtension({id:'analysis-acceptance',version:'test',protocolVersion:4,agentId:'dafeiyu',actions:[fixtureAction(h.core,'analysis-acceptance',{id:'acceptance_probe',description:'虚构样本验收操作',inputSchema:z.strictObject({}),work:async(_args,context)=>{value=await work(context);return value;}})]});
  mainResponse=()=>++step===1?call('acceptance_probe',{}):textReply('验收步骤完成');
  try{h.simulator.send(room,'执行本机虚构样本验收',{id:randomUUID()});await h.core.whenIdle();assert.ok(value);return value;}
  finally{handle.dispose();}
}
async function source(text){
  mainResponse=()=>textReply('虚构样本已接收');
  const receipt=h.simulator.send('test',text,{id:randomUUID(),sender:'fictional-author'});await h.core.whenIdle();
  const message=h.core.journal.get(receipt.id),event=h.core.journal.events(message.route).find(e=>e.traceId===message.id&&e.type==='message.accepted');
  assert.ok(event);return {ref:`dafeiyu:source:${event.id}:0`,message};
}
async function analyze(input,targetIds=[]){
  const job=okay(await probe(c=>h.ctx.dafeiyuMemory.analyze(c,{requestId:randomUUID(),sourceRefs:[input.ref],targetIds})));
  const session=h.ctx.agents.get(SessionId(input.message.sessionId));const before=session.session.snapshotEvents().length;
  const deliveries=h.simulator.deliveries.length;
  await h.ctx.dafeiyuMemory.whenAnalysisIdle();
  assert.equal(session.session.snapshotEvents().length,before,'No unsolicited analysis injection');
  assert.equal(h.simulator.deliveries.length,deliveries);
  const status=okay(await probe(c=>h.ctx.dafeiyuMemory.analysisStatus(c,job.jobId)));
  assert.equal(status.state,'completed',JSON.stringify(status));
  const report=okay(await probe(c=>h.ctx.dafeiyuMemory.analysisInspect(c,job.jobId)));
  return {state:status.state,counts:status.counts,candidates:report.candidates.map(c=>({status:c.status,reason:c.reason}))};
}
try{
  fiber=await h.ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:resolve(root,'memory'),analysis:{timeoutMs:180000}});
  const first=await source('晨露项目的代号是紫帆731。');
  const add=await analyze(first);assert.equal(add.counts.committed,1);
  const items=okay(await probe(c=>h.ctx.dafeiyuMemory.search(c,{}))).items;assert.equal(items.length,1);
  const change=await source('更正：晨露项目的代号改为青鱼888。');
  const revise=await analyze(change,[items[0].id]);assert.equal(revise.counts.committed,1);
  const after=okay(await probe(c=>h.ctx.dafeiyuMemory.search(c,{}))).items;assert.equal(after[0].version,2);assert.match(after[0].content,/青鱼888/);
  const joke=await source('开玩笑：晨露项目的代号是红糖999，仅限本次聊天。');
  const held=await analyze(joke);assert.equal(held.counts.committed,0);
  const beforeForeign=h.calls.filter(c=>String(c.sessionId).startsWith('memory-analysis-')).length;
  assert.equal((await probe(c=>h.ctx.dafeiyuMemory.analyze(c,{requestId:randomUUID(),sourceRefs:[first.ref]}),'other')).status,'source_unavailable');
  assert.equal(h.calls.filter(c=>String(c.sessionId).startsWith('memory-analysis-')).length,beforeForeign);
  const calls=h.calls.filter(c=>String(c.sessionId).startsWith('memory-analysis-'));
  assert.equal(calls.length,3);assert.ok(calls.every(c=>c.provider===model.provider&&c.model===model.model&&c.reasoningEffort===model.reasoningEffort&&c.status==='completed'));
  const report={at:new Date().toISOString(),kind:'real-model-fictional-data',model,isolatedFromServer:true,
    mainChannel:'simulated',automaticContextInjection:false,add,revise,held,foreignSourceRejected:true,
    calls:calls.map(({sessionId:_session,at:_at,...entry})=>entry),faults:h.faults};
  await writeFile(resolve('docs/memory-phase-3-results.json'),JSON.stringify(report,null,2)+'\n','utf8');
  console.log(JSON.stringify(report,null,2));
}finally{await fiber?.dispose();await h.close();}
