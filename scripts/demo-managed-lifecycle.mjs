import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const root=resolve('.runtime/demos',`managed-lifecycle-${randomUUID()}`);await mkdir(root,{recursive:true});
process.env.DSH_HOME=join(root,'dsh-home');
const {harness}=await import('../build-tests/harness.js');
const {Journal}=await import('@dafeiyu/journal');
const Query=(await import('@deepseek-ai/dsh-session-query-sqlite')).default;
const Timeline=await import('@dafeiyu/timeline'),Memory=await import('@dafeiyu/memory');
const report={stage:'1B',kind:'real-dsh-scripted-model-simulated-channel',at:new Date().toISOString(),serverAccess:false,realQQ:false,checks:[],passed:false};
const coreRoot=join(root,'core'),journal=new Journal(join(coreRoot,'journal.sqlite'));
const accepted=journal.accept('dafeiyu','channel-simulator','fixture',{id:'fictional-before-restart',occurredAt:new Date().toISOString(),
  conversation:{channel:'simulator',account:'local',kind:'local',id:'fixture'},sender:{id:'fictional-user',displayName:'虚构测试用户'},text:'这是一条已接收的本地测试消息。'});journal.close();
let h,query,timeline,memory;
try{
  h=await harness(coreRoot,undefined,undefined,10000,undefined,undefined,true);
  query=await h.ctx.plugin(Query,{path:join(root,'query.sqlite'),openAt:'never'});
  timeline=await h.ctx.plugin(Timeline,{agentId:'dafeiyu'});
  memory=await h.ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:join(root,'memory'),analysis:{},context:{}});
  await h.core.whenIdle();
  report.checks.push({name:'no-processing-during-registration',passed:h.adapter.requests.length===0&&h.core.journal.get(accepted.id).state==='accepted'});
  let rejected=false;try{h.simulator.send('fixture','未就绪不能受理',{id:'early'});}catch(error){rejected=error.message==='HOST_NOT_READY';}
  report.checks.push({name:'reject-before-acceptance',passed:rejected&&h.core.journal.list().length===1});
  h.core.recover();let dependencyRejected=false;try{h.core.activate();}catch(error){dependencyRejected=error.message==='DEPENDENCY_UNAVAILABLE';}
  report.checks.push({name:'require-memory-readiness',passed:dependencyRejected});
  h.ctx.dafeiyuMemory.recover();h.ctx.dafeiyuMemory.activate();
  report.checks.push({name:'model-still-not-started',passed:h.adapter.requests.length===0});
  h.core.activate();await h.core.whenIdle();await h.ctx.dafeiyuMemory.whenIdle();
  report.checks.push({name:'one-pending-message-delivered',passed:h.core.journal.get(accepted.id).state==='delivered'&&h.adapter.requests.length===1&&h.simulator.deliveries.length===1});
  h.core.quiesce();let lateRejected=false;try{h.simulator.send('fixture','关闭期间不能受理',{id:'late'});}catch(error){lateRejected=error.message==='HOST_NOT_READY';}
  report.checks.push({name:'quiesce-stops-new-acceptance',passed:lateRejected&&h.core.journal.list().length===1});
  report.phases={core:h.core.lifecycleState,memory:h.ctx.dafeiyuMemory.lifecycleState};
  report.passed=report.checks.every(check=>check.passed);
}finally{
  if(h){h.core.quiesce();await h.core.whenIdle();}
  await memory?.dispose();await timeline?.dispose();await query?.dispose();await h?.close();
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');
  await mkdir(resolve('docs/results'),{recursive:true});await writeFile(resolve('docs/results/phase1b-lifecycle.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
