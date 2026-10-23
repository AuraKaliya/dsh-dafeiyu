import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { access,mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { taskMemoryFixture,scenes,currentVersion,resultSchema } from '../build-tests/task-memory-fixture.js';
import { observationReport } from '../build-tests/observation-fixture.js';

const root=resolve('.runtime/demos',`task-memory-${randomUUID()}`);await mkdir(root,{recursive:true});
const python=resolve('.runtime/fastembed-bench/venv/Scripts/python.exe'),modelDir=resolve('.runtime/fastembed-bench/model'),serviceFile=resolve('benchmarks/fastembed/reference/embedding_service.py');
await Promise.all([access(python),access(modelDir),access(serviceFile)]);
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(done=>reservation.close(done));
const server=spawn(python,[serviceFile,'--model-dir',modelDir,'--host','127.0.0.1','--port',String(port),'--log-level','warning'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,HF_HUB_OFFLINE:'1',TOKENIZERS_PARALLELISM:'false'}});
server.stdout.resume();server.stderr.resume();let startupError;server.on('error',e=>{startupError=e;});let h;
try{
  let ready=false;for(let i=0;i<150;i++){if(startupError||server.exitCode!==null)throw new Error('Fixture embedding process failed');
    try{const health=await(await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(1000)})).json();if(health.model_loaded){ready=true;break;}}catch{}
    await new Promise(done=>setTimeout(done,100));}
  assert.ok(ready,'Local ONNX fixture did not become ready');
  h=await taskMemoryFixture(root,{config:{endpoint:`http://127.0.0.1:${port}/v1/embeddings`,python,modelDir,serviceFile}});
  for(const i of [0,1])for(const [j,body] of ['虚构读书笔记：唐代诗人的作品按年代整理。','虚构菜谱：蒸鸡蛋使用温水并小火烹饪。','虚构维修记录：更换键盘开关后测试输入。'].entries()){
    const key=`distractor-${i}-${j}`;h.handles[i].observeMemory(observationReport({conversation:scenes[i],sources:[{key,occurredAt:'2026-10-20T00:00:00Z',archive:{kind:'text',text:body}}],contributions:[{id:key,form:'original',source:key,exposure:[key]}]}));
  }
  const task=h.create();h.policy();const reader=h.grant(task);const expected=h.receipts.slice(0,2).map(r=>r.contributions[0].memoryId),evaluations=[];
  for(const [strategy,query] of [['lexical','下雨 雨具'],['semantic','有降水的天气出门要携带哪些防护用品'],['hybrid','下雨外出要准备什么']]){
    const start=performance.now(),result=resultSchema.parse(await reader.recall({query,strategy,limit:2},AbortSignal.timeout(60000)));
    assert.deepEqual(new Set(result.items.map(i=>i.id)),new Set(expected));assert.ok(result.scenes.every(s=>!s.degraded));assert.ok(!JSON.stringify(result).includes('C_DENIED'));
    evaluations.push({strategy,query,elapsedMs:Math.round(performance.now()-start),relevantRetrieved:2,returned:2,scenes:result.scenes});
  }
  const result=resultSchema.parse(await reader.recall({query:'下雨外出要准备什么',strategy:'hybrid',limit:2}));assert.ok(result.scenes.every(s=>s.vectorsComputed===0));
  reader.select({requestId:randomUUID(),expectedVersion:currentVersion(task),hitIds:result.items.map(i=>i.hitId)});assert.match(JSON.stringify(task.read()),/B_INTERNAL_ONLY/);
  task.memory.revoke({requestId:randomUUID(),id:reader.id,expectedVersion:1});await assert.rejects(reader.recall({query:'雨具'}));assert.throws(()=>reader.open({hitId:result.items[0].hitId}));
  assert.ok(!JSON.stringify(task.read()).includes('B_INTERNAL_ONLY'));
  const other=h.create(),fresh=h.grant(other),freshResult=resultSchema.parse(await fresh.recall({query:'下雨外出要准备什么',strategy:'hybrid',limit:2}));assert.ok(freshResult.scenes.some(s=>s.vectorsComputed>0));
  h.handles[0].changeObservationSource({conversation:scenes[0],ref:h.receipts[0].sources[0].ref,requestId:'delete',expectedVersion:1,action:'delete'});
  assert.ok(!JSON.stringify(await fresh.recall({query:'下雨外出要准备什么',limit:2})).includes('A_ONLY'));
  const report={at:new Date().toISOString(),projectVersion:'0.17.0',samples:'fictional-only',serverAccess:false,realGenerationModel:false,
    realEmbedding:'BAAI/bge-small-zh-v1.5 / FastEmbed + ONNX',evaluations,cacheRepeatComputedNoVectors:true,taskGrantCacheIsolation:true,
    unauthorizedSceneExcluded:true,internalMemoryRetrievedWithoutExpressionGrant:true,revocationInvalidatedSelectedEvidence:true,revocationBlockedRecallAndOpen:true,
    deletionFilteredCachedEvidence:true,modelCalls:h.adapter.requests.length,externalDeliveries:0};
  await writeFile(resolve(root,'result.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve('docs/agent-memory-phase-d1-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{
  try{await h?.close();}finally{if(server.exitCode===null&&server.pid){const exited=once(server,'exit');if(process.platform==='win32'){const killer=spawn('taskkill.exe',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await once(killer,'exit');}else server.kill();await exited;}}
}
