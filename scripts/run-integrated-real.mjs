import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync,mkdirSync } from 'node:fs';

const repository=resolve(fileURLToPath(new URL('..',import.meta.url))),root=join(repository,'.runtime/acceptance/7c-20261026'),args=process.argv.slice(2);
// Set the isolated home before importing DSH modules. The original credential file is explicitly read-only.
process.env.DSH_HOME=join(root,'dsh-home');process.env.TEMP=join(root,'tmp');process.env.TMP=join(root,'tmp');process.env.NODE_DISABLE_COMPILE_CACHE='1';
let workspace;
try{
  if(args.length===0||args.length===1&&args[0]==='--help'){console.log('7C已授权的唯一验收账本：--prepare / --status / --calibrate [--retry] / --batch 1..9 [--retry] / --report / --recover。真实调用受60元、累计6小时和首次派发起48小时限制。');}
  else{
    const action=args[0],retry=args.includes('--retry');if(!['--prepare','--status','--calibrate','--batch','--report','--recover'].includes(action)||args.some((a,i)=>i>0&&a!=='--retry'&&!(action==='--batch'&&i===1&&/^[1-9]$/.test(a)))||args.filter(a=>a==='--retry').length>1||retry&&!['--calibrate','--batch'].includes(action)||action==='--batch'&&!/^[1-9]$/.test(args[1]??''))throw new Error('EVALUATION_ARGUMENT_INVALID');
    if(process.env.DAFEIYU_TEST_RUN&&['--prepare','--calibrate','--batch'].includes(action))throw new Error('EVALUATION_LIVE_CALLS_DISABLED_IN_TESTS');
    const {EvaluationCatalog}=await import('./evaluation/catalog.ts'),{EvaluationWorkspace}=await import('./evaluation/workspace.ts'),catalog=new EvaluationCatalog(repository);
    if(action==='--prepare'){
      const {cleanEvaluationRevision,captureRuntimeIdentity}=await import('./evaluation/identity.ts');const revision=cleanEvaluationRevision(repository),identity=await captureRuntimeIdentity(repository,{real:true});if(cleanEvaluationRevision(repository)!==revision)throw new Error('EVALUATION_CODE_CHANGED');workspace=await EvaluationWorkspace.createReal(repository,catalog,revision,identity);mkdirSync(join(root,'dsh-home'),{recursive:true});mkdirSync(join(root,'tmp'),{recursive:true});console.log(JSON.stringify({kind:'real-campaign-prepared',root,modelCalls:0,budget:workspace.ledger.budget,execution:workspace.ledger.executionStatus()}));
    }else{
      if(!existsSync(join(root,'workspace.json')))throw new Error('EVALUATION_CAMPAIGN_NOT_PREPARED');workspace=await EvaluationWorkspace.open(repository,root);if(['--calibrate','--batch'].includes(action))mkdirSync(join(root,'tmp'),{recursive:true});
      if(action==='--status'){const report=workspace.ledger.report();console.log(JSON.stringify({kind:'real-campaign-status',budget:report.budget,execution:report.execution,cases:report.cases,attempts:report.attempts.map(({attemptId,caseId,state,ordinal})=>({attemptId,caseId,state,ordinal})),dispatchAttempts:report.calls.filter(c=>c.phase==='started').length,humanAccepted:false}));}
      else if(action==='--recover'){const {acquireEvaluationLease}=await import('./evaluation/lease.ts');const lease=acquireEvaluationLease(workspace);try{console.log(JSON.stringify({kind:'real-campaign-recovery',interrupted:workspace.ledger.recover(),replayed:0,budget:workspace.ledger.budget}));}finally{lease.release();}}
      else if(action==='--report'){const {exportRealEvidence}=await import('./evaluation/real-export.ts');console.log(JSON.stringify({kind:'real-evidence',...await exportRealEvidence(catalog,workspace)}));}
      else{const {runAuthorizedBatch}=await import('./evaluation/real-execution.ts');try{const result=await runAuthorizedBatch(repository,catalog,workspace,{...(action==='--calibrate'?{calibrate:true}:{batch:Number(args[1])}),retry},value=>console.log(JSON.stringify(value)));const {exportRealEvidence}=await import('./evaluation/real-export.ts');const finalized=await exportRealEvidence(catalog,workspace);console.log(JSON.stringify({kind:'real-batch-result',...result,exported:finalized,execution:workspace.ledger.executionStatus(),budget:workspace.ledger.budget}));}catch(error){const {exportRealEvidence}=await import('./evaluation/real-export.ts');try{console.log(JSON.stringify({kind:'real-evidence-after-stop',...await exportRealEvidence(catalog,workspace)}));}catch{console.log(JSON.stringify({kind:'real-evidence-after-stop',status:'raw-evidence-retained'}));}throw error;}}
    }
  }
}catch(error){console.error(error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'EVALUATION_REAL_EXECUTION_FAILED');if(workspace)console.log(JSON.stringify({kind:'stopped-campaign',budget:workspace.ledger.budget,execution:workspace.ledger.executionStatus(),humanAccepted:false}));process.exitCode=1;}
finally{workspace?.close();}
