import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { EvaluationCatalog } from './evaluation/catalog.ts';
import { EvaluationWorkspace } from './evaluation/workspace.ts';
const repository=resolve(fileURLToPath(new URL('..',import.meta.url))),args=process.argv.slice(2);
try{
  if(args.length>1||args[0]!==undefined&&!['--list','--prepare'].includes(args[0]))throw new Error('EVALUATION_ARGUMENT_INVALID');const catalog=new EvaluationCatalog(repository);
  if(args[0]!=='--prepare')console.log(JSON.stringify({kind:'offline-evaluation-plan',...catalog.summary(),executionStarted:false,modelCalls:0}));
  else{const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(),root=join(repository,'.runtime/acceptance','offline-'+randomUUID()),workspace=await EvaluationWorkspace.create(repository,root,catalog,revision);
    try{const report=await workspace.exportReport();console.log(JSON.stringify({kind:'offline-evaluation-workspace',root,report:report.relative,...catalog.summary(),executionStarted:false,modelCalls:0}));}finally{workspace.close();}}
}catch(error){console.error(error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'EVALUATION_PREPARATION_FAILED');process.exitCode=1;}
