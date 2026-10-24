import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';

const root=resolve('.runtime/phase1-probes',`execution-${randomUUID()}`);
await mkdir(root,{recursive:true});process.env.DSH_HOME=resolve(root,'dsh-home');
const {localHost,model}=await import('./local-host.mjs');
const Memory=await import('@dafeiyu/memory');
const {containsPrivateModelState}=await import('../build-tests/phase1-probe-fixture.js');
const report={stage:'1D',kind:'real-model-real-dsh-fictional-capability',model,at:new Date().toISOString(),serverAccess:false,realPlatformAccess:false,formalPersona:false,checks:[],calls:[],passed:false};
const receipts=[randomUUID(),randomUUID(),randomUUID()],steps=[];let host,memory,port,accepted;
const extension={protocolVersion:3,id:'execution-fixture',version:'1',agentId:'dafeiyu',actions:[{id:'phase1d_step',version:'1',description:'本机虚构验收步骤，无外部副作用；receipt是真实执行回执，不可猜测。',effects:'local-write',requiresTask:true,
  inputSchema:z.strictObject({stage:z.number().int().min(1).max(3),proof:z.string().max(100)}),outputSchema:z.strictObject({receipt:z.string()}),
  execute:async(raw,context)=>{host.core.executionAuthority(context,'execution-fixture');const input=z.object({stage:z.number(),proof:z.string()}).parse(raw);
    if(input.stage!==steps.length+1||input.proof!==(input.stage===1?'':receipts[input.stage-2]))throw new Error('FIXTURE_SEQUENCE');
    steps.push(input.stage);return {status:'succeeded',effects:'confirmed',completeness:'complete',data:{receipt:receipts[input.stage-1]},sources:[],receipts:[{id:receipts[input.stage-1],kind:'fictional-step'}]};}}]};
const setup=async create=>{
  host=await localHost(root,{simulator:false,realModel:true,timeline:true,lifecycleMode:'managed',timeout:240000});
  memory=await host.ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:join(root,'memory'),lifecycleMode:'managed'});
  host.core.registerExtensionV3(extension);host.core.configureExecution({profileId:'phase1d-real',createStore:create,policies:[{id:'probe',producers:['probe-driver'],actions:['phase1d_step'],allowLocalWrite:true,sourceRules:[]}]});
  host.ctx.dafeiyuMemory.recover();host.ctx.dafeiyuMemory.activate();await host.core.recoverExecutions();host.core.recover();host.core.activate();port=host.core.executionProducer('probe-driver');
};
const close=async()=>{if(!host)return;const current=host;host=undefined;report.calls.push(...current.calls.map(({sessionId:_id,at:_at,...call})=>call));
  try{current.core.quiesce();await current.core.whenIdle();}finally{try{await current.core.close();}finally{try{await memory?.dispose();}finally{await current.close();memory=undefined;}}}};
const input={requestId:'first',policyId:'probe',title:'1D本机虚构执行验收',goal:'依据本DSH会话的真实工具回执执行：如果尚未取得第1步回执，先调用phase1d_step(stage=1,proof="")，然后调用stage=2且proof是第1步receipt，本轮到此为止。如果会话中已经有第2步成功回执，则只调用stage=3且proof是第2步receipt。最终仅输出本轮最后一步的receipt。不要猜测回执，不执行多余分支。'};
try{
  await setup(true);accepted=port.submitTask(input);await host.core.whenIdle();let status=port.status(accepted.run);
  report.checks.push({name:'native-two-step-run',passed:status.state==='completed'&&steps.join(',')==='1,2'&&(await port.readResult(accepted.run))?.trim()===receipts[1]});
  report.firstRun={state:status.state,error:status.error};if(!report.checks[0].passed)throw new Error('FIRST_RUN_NOT_COMPLETED');
  report.checks.push({name:'no-channel-or-inbox',passed:host.core.journal.list().length===0});const sessionId=status.result?.sessionId,firstRunId=accepted.run.id,taskId=accepted.task.id;await close();
  await setup(false);const previous=port.submitTask(input);report.checks.push({name:'restart-no-replay',passed:previous.run.id===firstRunId&&port.status(previous.run).state==='completed'&&host.calls.length===0});
  const task=port.openTask(taskId),continued=port.submitTask({requestId:'next',taskId,expectedVersion:1,policyId:'probe'},task);await host.core.whenIdle();status=port.status(continued.run);
  report.checks.push({name:'persisted-session-tool-continuation',passed:status.state==='completed'&&status.result?.sessionId===sessionId&&steps.join(',')==='1,2,3'&&(await port.readResult(continued.run))?.trim()===receipts[2]});
}catch{report.error='EXECUTION_ACCEPTANCE_FAILED';}
finally{
  try{await close();}catch{report.error='CLOSE_OR_CREDENTIAL_INTEGRITY_FAILED';}
  let clean=true,files=0;for(const file of await readdir(join(root,'sessions'),{recursive:true}).catch(()=>[])){if(!file.endsWith('.jsonl'))continue;files++;
    for(const line of (await readFile(join(root,'sessions',file),'utf8')).split('\n').filter(Boolean)){try{if(containsPrivateModelState(JSON.parse(line)))clean=false;}catch{clean=false;}}}
  report.checks.push({name:'no-private-model-state-on-disk',passed:files>0&&clean});report.steps=steps;report.finishedAt=new Date().toISOString();
  report.passed=!report.error&&report.checks.length===5&&report.checks.every(check=>check.passed)&&report.calls.length>0&&report.calls.every(call=>call.status==='completed');
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve('docs/results/phase1d-execution-real.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,checks:report.checks,calls:report.calls.length,steps,error:report.error??null},null,2));if(!report.passed)process.exitCode=1;
}
