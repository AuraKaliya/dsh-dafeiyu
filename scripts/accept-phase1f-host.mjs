import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
const execute=promisify(execFile),cli=resolve('scripts/dafeiyu-host.mjs'),root=resolve('.runtime/phase1-probes',`host-${randomUUID()}`);await mkdir(root,{recursive:true});
const configFile=join(root,'host.json'),requestFile=join(root,'request.json'),marker=randomUUID();
const route={provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'max'},credentialFile=join(homedir(),'.dsh','.credentials.yaml');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),before=hash(await readFile(credentialFile));
const config={schemaVersion:1,profileId:'host-real-acceptance',agent:{id:'dafeiyu'},paths:{core:'./core',memory:'./memory',sessions:'./sessions',query:'./query.sqlite'},modelRoutes:{chat:route},persona:{fixedFile:resolve('profiles/persona.foundation.md'),kind:'formal'},
  plugins:[{id:'model-deepseek',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory',required:true}],authorityPolicies:[{id:'probe',producers:['host-cli'],actions:['dafeiyu_task_intent'],allowLocalWrite:false}]};
await writeFile(configFile,JSON.stringify(config,null,2));await writeFile(requestFile,JSON.stringify({requestId:'host-probe',title:'统一入口虚构验收',policyId:'probe',goal:`这是本机接口验收，不是实际生活经历。请实际调用dafeiyu_task_intent核对本任务的动机；随后简短说明核对结果，完整写出标记${marker}。不要声称调用未提供的能力，不新增人格候选，不向任何渠道发送。`},null,2));
const report={stage:'1F-3',kind:'real-model-real-dsh-through-host-cli-fictional-task',at:new Date().toISOString(),model:route,serverAccess:false,realPlatformAccess:false,checks:[],modelRequests:[],passed:false};
report.node=process.versions.node;report.sqlite=process.versions.sqlite;
report.sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
report.sourceWorktreeDirty=!!execFileSync('git',['status','--porcelain'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
async function command(args){try{const {stdout}=await execute(process.execPath,[cli,...args],{cwd:resolve('.'),timeout:300000,maxBuffer:300000});return {code:0,value:JSON.parse(stdout.trim().split('\n').at(-1))};}catch(error){let value={code:'HOST_CLI_FAILED'};try{value=JSON.parse(String(error.stdout).trim().split('\n').at(-1));}catch{}return {code:Number(error.code)||1,value};}}
try{
  const inspect=await command(['inspect','--config',configFile]);report.checks.push({name:'offline-inspection-identifies-uninitialized-profile',passed:inspect.code===2&&inspect.value.canInitialize===true&&inspect.value.networkChecked===false});
  const initialized=await command(['init','--config',configFile]);report.checks.push({name:'explicit-init-creates-only-selected-profile',passed:initialized.code===0&&initialized.value.ready===true});
  report.configHash=initialized.value.configHash;report.foundationHash=initialized.value.foundationHash;report.plugins=initialized.value.plugins?.map(({id,version})=>({id,version}));
  if(!report.checks.every(c=>c.passed))throw new Error('HOST_INITIALIZATION_ACCEPTANCE_FAILED');
  const first=await command(['run','--config',configFile,'--request',requestFile]);if(first.value.modelRequests)report.modelRequests.push(first.value.modelRequests);
  const db=new DatabaseSync(join(root,'core/runtime.sqlite'),{readOnly:true});let operations;try{operations=db.prepare("SELECT action,state,json_extract(outcome,'$.status') AS status,json_extract(outcome,'$.effects') AS effects FROM run_operations ORDER BY ordinal").all();}finally{db.close();}
  report.operations=operations;report.checks.push({name:'real-task-and-actual-intent-tool-through-cli',passed:first.code===0&&first.value.state==='completed'&&first.value.modelKind==='real'&&first.value.result.includes(marker)&&operations.some(op=>op.action==='dafeiyu_task_intent'&&op.status==='succeeded')});
  if(!report.checks.at(-1).passed)throw new Error(first.value.code??'HOST_REAL_TASK_FAILED');
  const repeated=await command(['run','--config',configFile,'--request',requestFile]);if(repeated.value.modelRequests)report.modelRequests.push(repeated.value.modelRequests);
  report.checks.push({name:'new-process-repeat-reads-the-same-run-without-model-replay',passed:repeated.code===0&&repeated.value.runId===first.value.runId&&repeated.value.result===first.value.result&&repeated.value.modelRequests.started===0});
  const status=await command(['status','--config',configFile]);report.checks.push({name:'stopped-status-is-not-online-and-has-no-task-text',passed:status.code===0&&status.value.online===false&&status.value.snapshot.phase==='stopped'&&!JSON.stringify(status.value).includes(marker)});
}catch(error){report.error=error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'HOST_REAL_ACCEPTANCE_FAILED';}
finally{
  const {containsPrivateModelState}=await import('../build-tests/phase1-probe-fixture.js');let files=0,clean=true;
  for(const file of await readdir(join(root,'sessions'),{recursive:true}).catch(()=>[])){if(!file.endsWith('.jsonl'))continue;files++;for(const line of(await readFile(join(root,'sessions',file),'utf8')).split('\n').filter(Boolean)){try{if(containsPrivateModelState(JSON.parse(line)))clean=false;}catch{clean=false;}}}
  report.checks.push({name:'dsh-persists-visible-content-without-reasoning-or-opaque-replay',passed:files>0&&clean});
  report.checks.push({name:'existing-credential-file-unchanged',passed:before===hash(await readFile(credentialFile))});
  report.finishedAt=new Date().toISOString();report.passed=!report.error&&report.checks.length===7&&report.checks.every(c=>c.passed);
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve('docs/results/phase1f3-host-real.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}
