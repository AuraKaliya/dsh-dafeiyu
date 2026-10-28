import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const root=resolve('.runtime/phase1-probes',`persona-${randomUUID()}`);await mkdir(root,{recursive:true});process.env.DSH_HOME=resolve(root,'dsh-home');
const {localHost,model}=await import('./local-host.mjs'),Memory=await import('@dafeiyu/memory');
const {containsPrivateModelState}=await import('../build-tests/phase1-probe-fixture.js');
const marker=randomUUID(),report={stage:'1E-2',kind:'real-model-real-dsh-fictional-persona-data',model,at:new Date().toISOString(),serverAccess:false,realPlatformAccess:false,
  newFoundationUsed:true,fullPersonaEvaluation:false,checks:[],calls:[],passed:false};let host,memory,port;
const setup=async create=>{host=await localHost(root,{simulator:false,realModel:true,timeline:true,personaFile:resolve('profiles/persona.foundation.md'),timeout:240000});
  memory=await host.ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:join(root,'memory'),});
  host.core.configureExecution({profileId:'persona-fixture',createStore:create,policies:[{id:'probe',producers:['probe-driver'],actions:['dafeiyu_persona_status','dafeiyu_persona_propose','dafeiyu_persona_review','dafeiyu_persona_publish'],allowLocalWrite:true,sourceRules:[]}]});
  host.ctx.dafeiyuMemory.recover();host.ctx.dafeiyuMemory.activate();await host.core.recoverExecutions();host.core.recover();host.core.activate();port=host.core.executionProducer('probe-driver');};
const close=async()=>{if(!host)return;const current=host;host=undefined;report.calls.push(...current.calls.map(({sessionId:_id,at:_at,...call})=>call));
  try{current.core.quiesce();await current.core.whenIdle();}finally{try{await current.core.close();}finally{try{await memory?.dispose();}finally{await current.close();memory=undefined;}}}};
try{await setup(true);const accepted=port.submitTask({requestId:'first',title:'人格接口隔离验收',policyId:'probe',goal:`这是本机隔离的接口测试，不代表你的真实长期偏好，也没有实际观看素材。请实际调用人格工具：先status读取版本，再propose一条kind=interest的虚构候选，text中完整包含“接口验收标记：${marker}；暂定探索方向为蓝灯水彩，未实际观看素材”，sources与counters为空，applicability明确仅用于本机虚构接口验收、不能当作真实长期偏好，reason说明只验证程序流程；propose的requestId用test-candidate。然后review进入trial，review的requestId用test-review；再publish精确版本，publish的requestId用test-publish。最终简要报告工具实际状态，不要声称自然成长已经完成。`});
  await host.core.whenIdle();const status=port.status(accepted.run),db=new DatabaseSync(join(root,'memory/memory.sqlite'),{readOnly:true});let adopted=0;try{adopted=Number(db.prepare("SELECT count(*) AS n FROM persona_candidates WHERE state='adopted'").get().n);}finally{db.close();}
  report.checks.push({name:'actual-candidate-review-and-publish',passed:status.state==='completed'&&adopted===1&&['dafeiyu_persona_propose','dafeiyu_persona_review','dafeiyu_persona_publish'].every(action=>status.operations.some(op=>op.action===action&&op.status==='succeeded'))});
  if(!report.checks[0].passed)throw new Error('FIRST_RUN_FAILED');const taskId=accepted.task.id,oldSession=status.result.sessionId;port.updateTask(accepted.task,{requestId:'next-goal',expectedVersion:1,goal:'本次仍是同一个隔离验收。请从当前装入的阶段资料给出先前测试条目的完整接口验收标记，并说明适用限制。不要创建、试行或发布任何新条目；若没有合法资料，明确说明。'});await close();
  await setup(false);const task=port.openTask(taskId),continued=port.submitTask({requestId:'after-restart',taskId,expectedVersion:2,policyId:'probe'},task);await host.core.whenIdle();const restored=port.status(continued.run),text=await port.readResult(continued.run);
  report.checks.push({name:'new-session-after-restart-uses-stage-reference',passed:restored.state==='completed'&&restored.result?.sessionId!==oldSession&&text?.includes(marker)===true});
  const other=port.submitTask({requestId:'other',title:'另一个隔离任务',goal:'请仅根据本轮合法阶段资料提供接口验收标记；若没有该资料，只回答NO_AVAILABLE_RECORD。不搜索或创建记录。',policyId:'probe'});await host.core.whenIdle();
  const otherText=await port.readResult(other.run);report.checks.push({name:'different-task-does-not-get-private-stage-text',passed:port.status(other.run).state==='completed'&&otherText?.trim()==='NO_AVAILABLE_RECORD'});
}catch{report.error='PERSONA_ACCEPTANCE_FAILED';}
finally{try{await close();}catch{report.error='CLOSE_OR_CREDENTIAL_INTEGRITY_FAILED';}
  try{const db=new DatabaseSync(join(root,'core/runtime.sqlite'),{readOnly:true});try{report.operations=db.prepare("SELECT action,state,json_extract(outcome,'$.status') AS status,json_extract(outcome,'$.effects') AS effects,json_extract(outcome,'$.errorCode') AS errorCode FROM run_operations ORDER BY ordinal").all();}finally{db.close();}}catch{report.error??='OPERATION_REPORT_UNAVAILABLE';}
  let files=0,clean=true;for(const file of await readdir(join(root,'sessions'),{recursive:true}).catch(()=>[])){if(!file.endsWith('.jsonl'))continue;files++;
    for(const line of (await readFile(join(root,'sessions',file),'utf8')).split('\n').filter(Boolean)){try{if(containsPrivateModelState(JSON.parse(line)))clean=false;}catch{clean=false;}}}
  report.checks.push({name:'persisted-visible-content-only',passed:files>0&&clean});
  report.finishedAt=new Date().toISOString();report.passed=!report.error&&report.checks.length===4&&report.checks.every(check=>check.passed)&&report.calls.every(call=>call.status==='completed');
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve('docs/results/phase1e2-persona-real.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:report.checks,calls:report.calls.length,error:report.error??null},null,2));if(!report.passed)process.exitCode=1;}
