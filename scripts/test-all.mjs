import {fork,spawn} from 'node:child_process';
import {readdir,mkdir,writeFile,unlink,stat} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
async function runBatch(files){
  let report=null;
  const code=await new Promise((done,reject)=>{
    const child=fork(join(repository,'scripts/run-tests.mjs'),files,{cwd:repository,windowsHide:true,stdio:['ignore','inherit','inherit','ipc']});
    child.on('message',message=>{if(message&&typeof message==='object'&&message.type==='test-report')report=message.report;});
    child.once('error',reject);child.once('exit',code=>done(code??1));
  });
  return {files,code,report};
}
async function check(args){return new Promise((done,reject)=>{const child=spawn(process.execPath,args,{cwd:repository,windowsHide:true,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>done(code??1));});}
const requested=process.argv.slice(2);
if(requested.length){process.exitCode=(await runBatch(requested)).code;}
else {
  const runId=randomUUID(),startedAt=new Date().toISOString(),groups=[],counts={tests:0,passed:0,failed:0,cancelled:0,skipped:0,todo:0};
  let code=await check(['scripts/build.mjs']);
  if(!code)code=await check(['node_modules/typescript/bin/tsc','-p','tests/tsconfig.json','--noEmit']);
  if(!code)code=await check(['node_modules/typescript/bin/tsc','-p','scripts/testing/tsconfig.json']);
  const available=[...(await readdir(join(repository,'tests'))).filter(name=>name.endsWith('.test.ts')).map(name=>'build-tests/'+name.replace(/\.ts$/,'.js')),
    ...(await readdir(join(repository,'tests/tooling'))).filter(name=>name.endsWith('.test.ts')).map(name=>'tests/tooling/'+name)].sort();
  if(!code)for(let offset=0;offset<available.length;offset+=12){
    const files=available.slice(offset,offset+12);console.log(`Regression batch ${Math.floor(offset/12)+1}/${Math.ceil(available.length/12)}`);
    const group=await runBatch(files);groups.push(group);
    for(const name of Object.keys(counts))counts[name]+=group.report?.summary?.counts?.[name]??0;
    if(group.code||!group.report?.summary?.success)code=1;
    if(group.report?.cleanup?.blocked?.length)break;
  }
  const completed=groups.flatMap(group=>group.files).length===available.length;
  const report={schemaVersion:1,runId,startedAt,finishedAt:new Date().toISOString(),passed:code===0&&completed,completed,counts,files:available,groups,realModel:false,realPlatform:false,serverAccess:false};
  const directory=join(repository,'.runtime/test-reports');await mkdir(directory,{recursive:true});
  const file=join(directory,'full-'+runId+'.json');await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  const prior=await Promise.all((await readdir(directory)).filter(name=>/^full-[a-f0-9-]{36}\.json$/.test(name)).map(async name=>({name,time:(await stat(join(directory,name))).mtimeMs})));
  for(const old of prior.sort((a,b)=>b.time-a.time).slice(10))await unlink(join(directory,old.name));
  console.log(JSON.stringify({runId,passed:report.passed,completed,counts,report:file}));process.exitCode=report.passed?0:1;
}
