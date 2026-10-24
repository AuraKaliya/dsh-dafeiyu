import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';

const root=resolve('.runtime/phase1-probes',`continuity-${randomUUID()}`);await mkdir(root,{recursive:true});process.env.DSH_HOME=resolve(root,'dsh-home');
const {localHost,model}=await import('./local-host.mjs'),Memory=await import('@dafeiyu/memory');
const {containsPrivateModelState}=await import('../build-tests/phase1-probe-fixture.js');
const marker=randomUUID(),text=`虚构文字样本的随机核验标记为${marker}。蓝灯是否亮起尚无定论，存在反证。本工具只提供文字片段，没有提供画面或音频，不得声称已观看或听过。`;
const report={stage:'1E-3',kind:'real-model-real-dsh-fictional-observation-and-continuity',model,at:new Date().toISOString(),serverAccess:false,realPlatformAccess:false,newFoundationUsed:true,fullPersonaEvaluation:false,checks:[],calls:[],passed:false};
let host,memory,port,observations=0,summaryTask,summarySession;
const query=(sql,kind='memory')=>{const db=new DatabaseSync(join(root,kind,kind==='core'?'runtime.sqlite':'memory.sqlite'),{readOnly:true});try{return db.prepare(sql).all();}finally{db.close();}};
const setup=async create=>{
  host=await localHost(root,{simulator:false,realModel:true,timeline:true,lifecycleMode:'managed',personaFile:resolve('profiles/persona.foundation.md'),timeout:240000});
  memory=await host.ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:join(root,'memory'),lifecycleMode:'managed',compaction:{inputTokens:4096,thresholdRatio:0.5,targetRatio:0.3,minGrowthTokens:0,minSavingsTokens:64,cooldownMs:0,retainTurns:1,maxSummaryChars:600,timeoutMs:120000}});
  host.core.registerExtensionV3({protocolVersion:3,id:'fixture-reader',version:'1',agentId:'dafeiyu',actions:[{id:'fixture_read_text',version:'1',description:'读取本机虚构文字样本；没有网络访问，没有音频或画面。',requiresTask:true,effects:'read',inputSchema:z.strictObject({}),outputSchema:z.json(),execute:async(_input,context)=>{
    const source=host.ctx.dafeiyuMemory.persona.recordObservation(context,{requestId:'fixture-observation',occurredAt:'2026-10-24T00:00:00.000Z',kind:'primary',text,completeness:'partial',resource:'fixture:continuity-acceptance',coverage:['仅文字片段；没有音频和画面'],dependencies:[]},'fixture-reader');observations++;
    return {status:'partial',effects:'none',completeness:'partial',data:{source,text,coverage:['仅文字']},sources:[{id:source.id,scopeKey:source.scopeKey,version:source.version,contentHash:source.contentHash}],receipts:[]};}}]});
  host.core.configureExecution({profileId:'continuity-fixture',createStore:create,policies:[
    {id:'probe',producers:['probe-driver'],actions:['fixture_read_text','dafeiyu_execution_contribute','dafeiyu_execution_select','dafeiyu_task_object','dafeiyu_task_intent'],allowLocalWrite:true,sourceRules:[]},
    {id:'summary-probe',producers:['probe-driver'],actions:[],allowLocalWrite:false,sourceRules:[]}]});
  host.ctx.dafeiyuMemory.recover();host.ctx.dafeiyuMemory.activate();await host.core.recoverExecutions();host.core.recover();host.core.activate();port=host.core.executionProducer('probe-driver');
};
const close=async()=>{if(!host)return;const current=host;host=undefined;report.calls.push(...current.calls.map(({sessionId,at:_at,...call})=>({...call,kind:sessionId?.startsWith('memory-compaction-')?'compaction':'task'})));
  try{current.core.quiesce();await current.core.whenIdle();}finally{try{await current.core.close();}finally{try{await memory?.dispose();}finally{await current.close();memory=undefined;}}}};
try{
  await setup(true);
  report.active='observe-contribute-select-object';
  const first=port.submitTask({requestId:'first',title:'内部观察与接续接口验收',policyId:'probe',goal:'这是本机虚构材料接口测试，不是你的真实生活经历。若当前已选内部证据中已有随机核验标记，不要重复读取或写入，直接报告完整标记、未决结论及材料局限。否则实际调用fixture_read_text一次，按其source的id与version用dafeiyu_execution_contribute保存一份mode=summary的摘要，保留完整随机标记、反证和未定结论，以及未提供画面音频的限制；requestId使用contribute。再用dafeiyu_execution_select选择贡献回执的source，expectedVersion为0，requestId使用select。最后用dafeiyu_task_object记录category=method、blocking=false、actions=[]的建议“未来应补核验画面与音频，当前先完成文字接口测试”，requestId使用method-note。不要因此改变目标或声称完整观看。最终报告实际工具状态和完整随机标记。'});
  await host.core.whenIdle();let status=port.status(first.run);
  report.checks.push({name:'real-observation-contribution-selection-and-nonblocking-objection',passed:status.state==='completed'&&observations===1&&['fixture_read_text','dafeiyu_execution_contribute','dafeiyu_execution_select','dafeiyu_task_object'].every(action=>status.operations.some(op=>op.action===action&&['succeeded','partial'].includes(op.status)))});
  const boundaries=query('SELECT body FROM memory_boundaries').map(row=>JSON.parse(row.body));report.checks.push({name:'task-internal-contribution-no-external-expression',passed:boundaries.length===1&&boundaries[0].schemaVersion===2&&boundaries[0].internalUse.kind==='task'&&boundaries[0].externalExpression.kind==='none'});
  if(!report.checks.every(check=>check.passed))throw new Error('FIRST_RUN_FAILED');
  const taskId=first.task.id,firstSession=status.result.sessionId;await close();
  report.active='restart';await setup(false);const task=port.openTask(taskId),continued=port.submitTask({requestId:'after-restart',taskId,expectedVersion:1,policyId:'probe'},task);await host.core.whenIdle();status=port.status(continued.run);const answer=await port.readResult(continued.run);
  const manifest=JSON.parse(query(`SELECT body FROM run_persona_manifests WHERE run_id='${continued.run.id}'`,'core')[0]?.body??'null');
  report.checks.push({name:'restart-reuses-dsh-with-checkpoint-and-does-not-repeat-observation',passed:status.state==='completed'&&status.result?.sessionId===firstSession&&manifest?.continuityCheckpointId===first.run.id&&observations===1&&answer?.includes(marker)===true});
  const other=port.submitTask({requestId:'other',title:'另一内部任务隔离检查',policyId:'summary-probe',goal:'仅检查本轮是否装入先前测试的随机核验标记，没有资料时只回答NO_AVAILABLE_RECORD。不要猜测，不获取新材料。'});await host.core.whenIdle();
  report.checks.push({name:'other-task-cannot-read-private-material',passed:port.status(other.run).state==='completed'&&(await port.readResult(other.run))?.trim()==='NO_AVAILABLE_RECORD'});
  report.active='real-compression';
  const goal='以下都是虚构的文字学习记录，只用于压缩验收。'+('蓝灯尚未确认，反证未排除，声音和画面从未提供。临时计划是先核验文字，未决问题是是否需要更换证据。'.repeat(29))+'\n请只用一句话报告：尚未确认、保留反证、未验证音频画面。不要增加新事实，不调用工具。';
  const firstSummary=port.submitTask({requestId:'summary-first',title:'原生任务真实压缩验收',goal,policyId:'summary-probe'});summaryTask=firstSummary.task.id;await host.core.whenIdle();if(port.status(firstSummary.run).state!=='completed')throw new Error('SUMMARY_FIRST_RUN_FAILED');summarySession=port.status(firstSummary.run).result.sessionId;
  for(let i=0;i<4;i++){const run=port.submitTask({requestId:`summary-${i}`,taskId:summaryTask,expectedVersion:1,policyId:'summary-probe'},firstSummary.task);await host.core.whenIdle();if(port.status(run.run).state!=='completed')throw new Error('SUMMARY_RUN_FAILED');}
  await close();await setup(false);const summaryRef=port.openTask(summaryTask),last=port.submitTask({requestId:'summary-after-restart',taskId:summaryTask,expectedVersion:1,policyId:'summary-probe'},summaryRef);await host.core.whenIdle();const final=await port.readResult(last.run),finalState=port.status(last.run);
  report.checks.push({name:'real-summary-and-restart-retain-uncertainty-and-unseen-modalities',passed:finalState.state==='completed'&&finalState.result.sessionId===summarySession&&/尚未|未确认|不能确认/.test(final??'')&&/反证/.test(final??'')&&/音频|声音/.test(final??'')&&/画面/.test(final??'')});
}catch(error){report.error=error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'CONTINUITY_ACCEPTANCE_FAILED';}
finally{
  try{await close();}catch{report.error??='CLOSE_OR_CREDENTIAL_INTEGRITY_FAILED';}
  let files=0,clean=true,compactions=0;for(const file of await readdir(join(root,'sessions'),{recursive:true}).catch(()=>[])){if(!file.endsWith('.jsonl'))continue;files++;
    for(const line of(await readFile(join(root,'sessions',file),'utf8')).split('\n').filter(Boolean)){try{const value=JSON.parse(line);if(containsPrivateModelState(value))clean=false;if(value.type==='compaction/end'&&!value.data.error)compactions++;}catch{clean=false;}}}
  report.observationCalls=observations;report.committedCompactions=compactions;
  report.checks.push({name:'real-compaction-actually-committed',passed:compactions>0&&report.calls.some(call=>call.kind==='compaction'&&call.status==='completed')});
  report.checks.push({name:'persisted-visible-content-only',passed:files>0&&clean});
  try{report.operations=query("SELECT action,state,json_extract(outcome,'$.status') AS status,json_extract(outcome,'$.effects') AS effects,json_extract(outcome,'$.errorCode') AS errorCode FROM run_operations ORDER BY ordinal",'core');report.checkpointCount=query('SELECT count(*) AS n FROM continuity_checkpoints')[0].n;}catch{report.error??='REPORT_UNAVAILABLE';}
  report.finishedAt=new Date().toISOString();report.passed=!report.error&&report.checks.length===7&&report.checks.every(check=>check.passed)&&report.calls.every(call=>call.status==='completed'&&(call.kind!=='compaction'||call.finish==='stop'));
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve('docs/results/phase1e3-continuity-real.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks,calls:report.calls.length,compactions,error:report.error??null},null,2));if(!report.passed)process.exitCode=1;
}
