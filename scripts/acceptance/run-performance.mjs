import {mkdirSync,existsSync,readFileSync,openSync,closeSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {repository,fingerprint,saveJson} from './io.mjs';
import {summarizeCpuProfile} from './performance-profile.mjs';

const runId=randomUUID(),directory=join(repository,'.runtime','performance',new Date().toISOString().replaceAll(':','-')+'-'+runId);
if(existsSync(directory))throw new Error('PERFORMANCE_NEW_DIRECTORY_REQUIRED');mkdirSync(directory,{recursive:true});
const version=JSON.parse(readFileSync(join(repository,'package.json'),'utf8')).version;
let revision=null;try{const options={cwd:repository,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']};
  if(resolve(execFileSync('git',['rev-parse','--show-toplevel'],options).trim())===repository)revision=execFileSync('git',['rev-parse','HEAD'],options).trim();
}catch{/* A source archive is identified by content; do not borrow an enclosing repository's revision. */}
const manifest={schemaVersion:1,runId,version,mode:'offline-sdk',revision,sourceHash:fingerprint('source'),driverHash:fingerprint('driver'),
  thresholds:{maxLoopDelayMs:1000,cancelResponseMs:1000,cancelSettledMs:1500},concurrency:1,profileEnabled:true,paidCalls:false,realPlatforms:false};saveJson(join(directory,'manifest.json'),manifest);
console.log(JSON.stringify({runId,directory,mode:manifest.mode}));const log=openSync(join(directory,'tests.log'),'wx');let code;
try{code=await new Promise((done,reject)=>{const child=spawn(process.execPath,['scripts/run-tests.mjs','tests/heavy-task-performance.test.ts','tests/heavy-task-cancellation.test.ts','tests/heavy-task-recovery.test.ts','tests/cooperative-stream.test.ts'],{cwd:repository,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,DAFEIYU_TEST_CONCURRENCY:'1',DAFEIYU_PERFORMANCE_SLO:'1',DAFEIYU_PERFORMANCE_DIR:directory}});child.once('error',reject);child.once('exit',done);});}finally{closeSync(log);}
const read=file=>JSON.parse(readFileSync(join(directory,file),'utf8'));let report;
try{const heavy=read('heavy.json'),cancel=read('cancellation.json'),recovery=read('recovery.json'),baseline=JSON.parse(readFileSync(join(repository,'tests/fixtures/acceptance/heavy-baseline.json'),'utf8'));
  const checks={process:code===0,sourceUnchanged:manifest.sourceHash===fingerprint('source'),driverUnchanged:manifest.driverHash===fingerprint('driver'),
    sameWork:heavy.reads===baseline.reads&&heavy.requests===baseline.requests&&heavy.sent===baseline.sent&&heavy.taskRuns===1&&heavy.capacity===1000000,
    responsive:heavy.maxLoopDelayMs<manifest.thresholds.maxLoopDelayMs,cancelled:cancel.reads===48&&cancel.sent===null&&cancel.cancelResponseMs<1000&&cancel.cancelSettledMs<1500,
    recovered:recovery.reads===0&&recovery.requests===0&&recovery.storedRequests===67&&recovery.taskRuns===1&&recovery.sent===baseline.sent};
  report={runId,runtimeHash:fingerprint('runtime'),passed:Object.values(checks).every(Boolean),checks,baseline,heavy,cancel,recovery,profile:summarizeCpuProfile(read('heavy.cpuprofile')),releaseAccepted:false,realCost:null};
}catch(error){report={runId,passed:false,code:'PERFORMANCE_EVIDENCE_INCOMPLETE',testExitCode:code};}
saveJson(join(directory,'audit.json'),report);console.log(JSON.stringify({runId,passed:report.passed,report:join(directory,'audit.json')}));if(!report.passed)process.exitCode=1;
