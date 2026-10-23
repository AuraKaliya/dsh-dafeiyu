import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { MemoryStore } from '@dafeiyu/memory/store';
import { LocalTokenizer } from '@dafeiyu/memory/retrieval-clients';
import { loadProfile } from '@dafeiyu/memory/retrieval-profile';
import { memoryFixture } from '../build-tests/memory-fixture.js';

const okay=value=>{assert.equal(value.status,'ok');return value;};
const root=resolve('.runtime/demos',`memory-retrieval-${randomUUID()}`);
await mkdir(root,{recursive:true});
const python=resolve('.runtime/fastembed-bench/venv/Scripts/python.exe');
const modelDir=resolve('.runtime/fastembed-bench/model');
const serviceFile=resolve('benchmarks/fastembed/reference/embedding_service.py');
await Promise.all([access(python),access(modelDir),access(serviceFile)]);
const tokenizerTests=spawnSync(python,['tests/tokenizer_worker_test.py'],{windowsHide:true,stdio:'inherit'});
assert.equal(tokenizerTests.status,0,'Real tokenizer contract tests failed');
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port=reservation.address().port;await new Promise(resolveClose=>reservation.close(resolveClose));
const server=spawn(python,[serviceFile,'--model-dir',modelDir,'--host','127.0.0.1','--port',String(port),'--log-level','warning'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,HF_HUB_OFFLINE:'1',TOKENIZERS_PARALLELISM:'false'}});
server.stdout.resume();server.stderr.resume();
let startupError=null;server.on('error',error=>{startupError=error;});
let h;
const endpoint=`http://127.0.0.1:${port}/v1/embeddings`;
async function stopServer(){
  if(server.exitCode!==null||!server.pid)return;
  const exited=once(server,'exit');
  if(process.platform==='win32'){
    const killer=spawn('taskkill.exe',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await once(killer,'exit');
  }else server.kill();
  await exited;
}
try{
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
    if(startupError||server.exitCode!==null)throw new Error('Local fixture server exited or could not start');
    try{const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(1000)});const health=await response.json();if(health.model_loaded){ready=true;break;}}catch{}
    await new Promise(resolveWait=>setTimeout(resolveWait,100));
  }
  assert.ok(ready,'Local server did not become ready');
  const retrieval={endpoint,python,modelDir,serviceFile};
  const profile=loadProfile();
  const tokenizer=new LocalTokenizer(retrieval,profile.profile,profile.workerHash);
  try{
    const long='普通背景。'.repeat(350)+'尾部暗号是琉璃923。';
    const parts=await tokenizer.chunks(long,AbortSignal.timeout(30000));
    assert.equal(parts.map(item=>item.text).join(''),long);assert.ok(parts.every(item=>item.tokens<=480));assert.ok(parts.at(-1).text.includes('琉璃923'));
    await assert.rejects(tokenizer.query('甲'.repeat(600),AbortSignal.timeout(30000)),/query_too_long/);
  }finally{tokenizer.close();}
  h=await memoryFixture(root,{retrieval});
  const raw=await readFile('benchmarks/embedding/dataset.json');const dataset=JSON.parse(raw);
  const mapping=new Map();
  for(const [scopeName,scene] of [['test','suite'],['other','other-suite']]){
    const evidence=await h.evidence(scene,'本次仅导入公开的虚构中文检索样本，不涉及真实用户资料。');
    await h.probe(scene,async context=>{
      const original=okay(await h.timeline.open(context,{ref:evidence.ref,limit:1}));
      const store=new MemoryStore(join(root,'memory.sqlite'));
      try{
        const scope=h.core.scopeFor(context);
        for(const doc of dataset.documents.filter(doc=>doc.scope===scopeName)){
          const value={kind:'knowledge',claimType:'self_report',content:doc.text,sources:[{kind:'timeline',ref:evidence.ref,contentHash:original.contentHash}]};
          const saved=doc.id==='new'
            ?store.mutate(scope,{action:'revise',requestId:'fixture:new',id:mapping.get('old'),expectedVersion:1,value})
            :store.mutate(scope,{action:'create',requestId:`fixture:${doc.id}`,value});
          mapping.set(doc.id,saved.id);
          if(doc.deleted)store.mutate(scope,{action:'delete',requestId:`delete:${doc.id}`,id:saved.id,expectedVersion:saved.version,reason:'虚构样本已删除'});
        }
      }finally{store.close();}
      return {imported:true};
    });
  }
  const reverse=new Map([...mapping].map(([name,id])=>[id,name]));
  const queries=dataset.queries.filter(query=>query.mode==='normal');
  const evaluations={};
  let cachedRepeat;
  for(const strategy of ['lexical','semantic','hybrid']){
    const rows=[];
    for(const query of queries){
      const started=performance.now();
      const result=okay(await h.probe('suite',context=>h.memory.recall(context,{query:query.text,strategy,limit:10})));
      assert.equal(result.degraded,false);
      const ranked=result.items.map(item=>reverse.get(item.id));
      assert.ok(!ranked.includes('secret')&&!ranked.includes('deleted')&&!ranked.includes('old'));
      rows.push({id:query.id,category:query.category,relevant:query.relevant,ranked,elapsedMs:performance.now()-started,vectorsComputed:result.vectorsComputed,cacheHits:result.cacheHits});
    }
    const answered=rows.filter(row=>row.relevant.length);
    evaluations[strategy]={count:rows.length,answerable:answered.length,
      hit1:answered.filter(row=>row.relevant.includes(row.ranked[0])).length/answered.length,
      recall5:answered.reduce((sum,row)=>sum+row.relevant.filter(id=>row.ranked.slice(0,5).includes(id)).length/row.relevant.length,0)/answered.length,
      mrr10:answered.reduce((sum,row)=>{const rank=row.ranked.findIndex(id=>row.relevant.includes(id));return sum+(rank<0?0:1/(rank+1));},0)/answered.length,rows};
    console.log(JSON.stringify({strategy,...Object.fromEntries(Object.entries(evaluations[strategy]).filter(([key])=>key!=='rows'))}));
  }
  cachedRepeat=okay(await h.probe('suite',c=>h.memory.recall(c,{query:queries[0].text,strategy:'semantic'})));
  assert.equal(cachedRepeat.vectorsComputed,0);
  const longText='普通背景。'.repeat(350)+'最后确认尾部暗号是琉璃923。';
  const source=await h.evidence('long',longText);
  const longItem=okay(await h.probe('long',c=>h.memory.create(c,{requestId:'long',kind:'knowledge',claimType:'self_report',content:longText,sourceRefs:[source.ref]})));
  const tail=okay(await h.probe('long',c=>h.memory.recall(c,{query:'琉璃923',strategy:'hybrid'})));
  assert.equal(tail.items[0]?.id,longItem.id);assert.ok(tail.items[0].chunk.start>512);assert.match(tail.items[0].chunk.text,/琉璃923/);
  await h.probe('long',c=>h.memory.delete(c,{requestId:'long-delete',id:longItem.id,expectedVersion:1,reason:'虚构删除验收'}));
  const afterDelete=okay(await h.probe('long',c=>h.memory.recall(c,{query:'琉璃923',strategy:'hybrid',rebuild:true})));
  assert.equal(afterDelete.items.length,0);
  const deleted=okay(await h.probe('long',c=>h.memory.readDeleted(c,{id:longItem.id})));assert.equal(deleted.item.content,longText);
  const result={timestamp:new Date().toISOString(),projectVersion:JSON.parse(await readFile('package.json','utf8')).version,
    memoryVersion:JSON.parse(await readFile('packages/memory/package.json','utf8')).version,profile:profile.hash,datasetSha256:createHash('sha256').update(raw).digest('hex'),
    sourceDocuments:dataset.documents.length,normalQueries:queries.length,excludedQueries:dataset.queries.filter(q=>q.mode!=='normal').map(q=>q.id),
    note:'Real local BGE HTTP inference and production memory plugin through real DSH with scripted dialogue model. Previous/historical/deleted modes remain M1 dedicated reads.',
    evaluations,checks:{tokenCoverage:true,overlongQueryRejected:true,cacheRepeatComputed:cachedRepeat.vectorsComputed,
      tailChunkStart:tail.items[0].chunk.start,tailChunkEnd:tail.items[0].chunk.end,deletedRebuildCount:afterDelete.items.length,deletedContentPreserved:true,scopeFilter:true},root};
  await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');
  await mkdir('docs/results',{recursive:true});await writeFile('docs/results/memory-phase-2.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({checks:result.checks,root}));
}finally{
  if(h)await h.close();await stopServer();
}
