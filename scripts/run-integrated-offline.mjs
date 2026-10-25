import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvaluationCatalog } from './evaluation/catalog.ts';
import { EvaluationWorkspace } from './evaluation/workspace.ts';
import { cleanEvaluationRevision,captureRuntimeIdentity,runtimeIdentityHash } from './evaluation/identity.ts';
import { parseOfflineArguments } from './evaluation/arguments.ts';

const repository=resolve(fileURLToPath(new URL('..',import.meta.url)));
if(process.argv.length===3&&process.argv[2]==='--help'){
  console.log('node scripts/run-integrated-offline.mjs --workspace <D盘证据目录> [--case <案例ID> ... | --all] [--retry] [--recover] [--report]\n仅离线脚本模型。--all选择162项冻结场景；--retry追加复测；--recover只将遗留运行标记为中断，不自动重放。');
}else{
  let workspace;
  try{
    const args=parseOfflineArguments(process.argv.slice(2)),catalog=new EvaluationCatalog(repository);
    workspace=await EvaluationWorkspace.open(repository,args.workspace);
    const selected=args.all||args.cases.length>0;
    const verifyRuntime=async()=>{if(!workspace.config.runtimeHash)throw new Error('EVALUATION_RUNTIME_NOT_FROZEN');if(workspace.config.codeRevision!==cleanEvaluationRevision(repository))throw new Error('EVALUATION_CODE_CHANGED');if(workspace.config.runtimeHash!==runtimeIdentityHash(await captureRuntimeIdentity(repository)))throw new Error('EVALUATION_RUNTIME_CHANGED');};
    if(selected)await verifyRuntime();
    const {runOfflineBatch,recoverOfflineWorkspace}=await import('./evaluation/execution.ts');
    if(selected){const result=await runOfflineBatch(catalog,workspace,{...(args.all?{all:true}:{cases:args.cases}),retry:args.retry,recover:args.recover},progress=>console.log(JSON.stringify({kind:'offline-case',...progress})));await verifyRuntime();console.log(JSON.stringify({kind:'offline-batch',...result}));if(result.dispositions.some(d=>['failed','blocked','interrupted'].includes(d.state)))process.exitCode=1;}
    else if(args.recover)console.log(JSON.stringify({kind:'offline-recovery',interrupted:recoverOfflineWorkspace(workspace),replayed:0}));
    if(selected||args.report){const {exportOfflineEvidence}=await import('./evaluation/export.ts');console.log(JSON.stringify({kind:'offline-evidence',...await exportOfflineEvidence(catalog,workspace)}));}
  }catch(error){console.error(error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'EVALUATION_OFFLINE_EXECUTION_FAILED');process.exitCode=1;}
  finally{workspace?.close();}
}
