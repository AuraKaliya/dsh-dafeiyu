import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID,createHash } from 'node:crypto';
import { parseDocument } from 'yaml';

const root=resolve('.runtime/demos',`memory-semantic-${randomUUID()}`);await mkdir(root,{recursive:true});
process.env.DSH_HOME=resolve(root,'dsh-home');
const {localHost,model}=await import('./local-host.mjs');
const {MemoryCompaction}=await import('../packages/memory/lib/compaction.js');
const {extractQualifiers}=await import('@dafeiyu/contracts');
const {textReply}=await import('../build-tests/harness.js');
const profile=parseDocument(await readFile(join(homedir(),'.dsh/profiles/desktop/cordis.patch.yml'),'utf8'),{logLevel:'silent'}).toJS();
function routes(value,out=[]){if(value&&typeof value==='object'){if(value.provider&&value.model)out.push({provider:value.provider,model:value.model,...(value.reasoningEffort?{reasoningEffort:value.reasoningEffort}:{})});for(const v of Object.values(value))routes(v,out);}return out;}
assert.ok(routes(profile).some(r=>JSON.stringify(r)===JSON.stringify(model)),'Current DSH model binding differs');
const host=await localHost(root,{realModel:true,simulator:false,timeout:240000});
const provider=new MemoryCompaction(host.ctx,{inputTokens:30000,semanticEnabled:true,timeoutMs:180000},()=>({epoch:'fictional',taskId:null,versions:{}}),
  {inbound:()=>[],context:()=>[],tool:()=>[],validate:()=>true});
const scope={agentId:'dafeiyu',route:'fictional:semantic-acceptance',traceId:'fictional-run'};
let negativeCandidate=null;
const finishes=[];
host.ctx.on('llm/stream',async function*(options,next){
  assert.equal(options.tools?.length??0,0);
  if(negativeCandidate&&String(options.sessionId).startsWith('memory-semantic-generate-'))yield* textReply(JSON.stringify({fragment:{kind:'note',text:negativeCandidate}}));
  else for await(const chunk of next()){
    if(chunk.type==='finish')finishes.push({stage:String(options.sessionId).includes('-verify-')?'verify':'generate',reason:chunk.reason.kind,
      ...('failure' in chunk.reason?{failureCode:chunk.reason.failure.code,status:chunk.reason.failure.status}:{})});
    yield chunk;
  }
});
const filler='以下记录只是整理过程。我们把资料放在一起，又核对了一遍行文，然后整理标点。'.repeat(8);
const cases=[
  {id:'permission-scope',text:'晨露项目只在虚构测试群246801357试运行；主人确认后才能发送。尚未验收，不允许正式群发。',must:['246801357','确认后','尚未验收','不允许正式群发']},
  {id:'correction-time-units',text:'小林更正：代号从紫帆731改为青羽842。预算上限30元，有效期截至2026-11-01。旧代号不再用于后续任务。',must:['紫帆731','青羽842','30元','2026-11-01','不再']},
  {id:'uncertainty-partial-failure',text:'小周说故障可能与网络有关，尚未验证。三次测试只完成一次，另两次失败。离线测试成功不等于线上已通过。',must:['可能','尚未验证','另两次失败','不等于']},
  {id:'conditional-attribution',text:'小林转述小周的假设：若明天收到确认，才考虑试发；没有确认就继续等待。这里只记录提议，并非已获许可。',must:['假设','若明天','没有确认','并非已获许可']},
];
const report=process.argv.includes('--resume')?JSON.parse(await readFile(resolve('docs/memory-phase-5c3b-model-results.json'),'utf8')):
  {at:new Date().toISOString(),kind:'real-model-fictional-data',model,serverAccess:false,chatInjection:false,semanticAutomaticDefault:false,cases:[],negativeChecks:[],passed:false};
report.passed=false;report.maxOutputTokens=8192;report.runs=(report.runs??0)+1;
const previousCalls=report.calls??[],previousFinishes=report.finishes??[],previousFaults=report.faults??[];
try{
  assert.deepEqual(report.model,model);
  const fixtureHash=createHash('sha256').update(JSON.stringify({cases,filler,model,maxOutputTokens:8192,policy:'qualifier-copy-v2'})).digest('hex');
  if(report.fixtureHash)assert.equal(report.fixtureHash,fixtureHash,'Resume requires identical samples, model and qualifier policy');
  report.fixtureHash=fixtureHash;
  for(const c of cases){
    const text=c.text+filler,sources=[{seq:1,role:'user',text,hash:createHash('sha256').update(text).digest('hex')}];
    let parents=[{kind:'constraint',text:c.text+filler},{kind:'pending',text:c.text+'这些内容正在整理。'.repeat(12)}];
    const rounds=c.id==='permission-scope'?['fusion','fusion','rebuild']:['fusion'];
    for(const [index,mode] of rounds.entries()){
      const existing=report.cases.find(r=>r.id===c.id&&r.round===index+1&&r.mode===mode);
      if(existing){parents=[{kind:'constraint',text:existing.output}];continue;}
      const request={mode,sources,parents:mode==='rebuild'?[]:parents,maxChars:1200};const start=Date.now();
      const result=await provider.rewrite(scope,request,new AbortController().signal,()=>{});
      assert.ok(c.must.every(term=>result.fragment.text.includes(term)));assert.ok(result.qualifiers.every(q=>result.fragment.text.includes(q.text)));
      report.cases.push({id:c.id,round:index+1,mode,output:result.fragment.text,qualifierCount:result.qualifiers.length,verifier:result.verification,
        sourceChars:text.length,parentChars:parents.reduce((n,f)=>n+f.text.length,0),outputChars:result.fragment.text.length,durationMs:Date.now()-start});
      parents=[result.fragment];console.log(JSON.stringify({case:c.id,round:index+1,mode,status:'passed'}));
    }
  }
  const text=cases[0].text,sources=[{seq:1,role:'user',text,hash:createHash('sha256').update(text).digest('hex')}];
  for(const [id,extra] of [['permission-expansion','以上条件都已满足，现已验收，可以在全部正式群发布。'],['invented-result','工具已经实际发送成功，并收到全部成员确认。']]){
    if(report.negativeChecks.some(c=>c.id===id&&c.verdict&&c.rejected))continue;
    negativeCandidate=extractQualifiers(sources).map(q=>q.text).join('\n')+'\n'+extra;
    let rejected=false,verdict;try{await provider.rewrite(scope,{mode:'fusion',sources,parents:[{kind:'constraint',text}],maxChars:1200},new AbortController().signal,()=>{});}catch(error){
      if(error.code!=='SEMANTIC_VERIFICATION_REJECTED')throw error;rejected=true;verdict=error.verification;
    }
    assert.ok(rejected,'Independent real-model verifier must reject fabricated conclusions');
    report.negativeChecks.push({id,candidateContainsAllExactQualifiers:true,generation:'injected-fictional-bad-candidate',verification:'current-bound-real-model',verdict,rejected});
    console.log(JSON.stringify({case:id,status:'rejected-as-expected'}));
  }
  negativeCandidate=null;
  assert.ok(host.calls.every(c=>c.provider===model.provider&&c.model===model.model&&c.reasoningEffort===model.reasoningEffort&&c.status==='completed'));
  report.passed=true;
}catch(error){
  report.failures??=[];report.failures.push({run:report.runs,code:error.code??'VALIDATION_OR_PROVIDER_ERROR'});process.exitCode=1;
  console.log(JSON.stringify({status:'incomplete',code:error.code??'VALIDATION_OR_PROVIDER_ERROR',lastFinish:finishes.at(-1)}));
}finally{
  report.calls=[...previousCalls,...host.calls.map(({sessionId:_session,at:_at,...c})=>c)];report.faults=[...previousFaults,...host.faults];report.finishes=[...previousFinishes,...finishes];
  report.callAccounting='calls are DSH stream observations, including injected negative-candidate generation; finishes record provider-dispatched requests only. A passed report means all listed positive and negative checks passed, not that every intermediate attempt succeeded.';
  await host.close();await writeFile(resolve(root,'result.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(resolve('docs/memory-phase-5c3b-model-results.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({passed:report.passed,positiveRounds:report.cases.length,negativeChecks:report.negativeChecks.length,observedDshStreamsThisRun:host.calls.length,model}));
