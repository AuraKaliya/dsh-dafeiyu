import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repository=resolve(fileURLToPath(new URL('..',import.meta.url))),root=join(repository,'.runtime/acceptance/7c-20261026'),args=process.argv.slice(2);
process.env.DSH_HOME=join(root,'dsh-home');process.env.TEMP=join(root,'tmp');process.env.TMP=join(root,'tmp');process.env.NODE_DISABLE_COMPILE_CACHE='1';
let workspace;
try{
  const flags=args.filter(arg=>arg==='--no-scope-reuse'),cases=args.filter(arg=>/^[BH][0-9]{2}-[a-z-]+-[1-3]$/.test(arg));if(flags.length>1||cases.length!==1||args.length!==flags.length+cases.length)throw new Error('EVALUATION_ARGUMENT_INVALID');if(process.env.DAFEIYU_TEST_RUN)throw new Error('EVALUATION_LIVE_CALLS_DISABLED_IN_TESTS');
  const {EvaluationCatalog}=await import('./evaluation/catalog.ts'),{EvaluationWorkspace}=await import('./evaluation/workspace.ts'),{retryOneRealCase}=await import('./acceptance-retry.ts'),catalog=new EvaluationCatalog(repository);workspace=await EvaluationWorkspace.open(repository,root);
  const result=await retryOneRealCase(repository,catalog,workspace,cases[0],value=>console.log(JSON.stringify(value)),{scopeReuse:flags.length===0});console.log(JSON.stringify({kind:'explicit-case-retry-complete',...result,budget:workspace.ledger.budget,execution:workspace.ledger.executionStatus()}));
}catch(error){console.error(error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'EVALUATION_CASE_RECOVERY_FAILED');process.exitCode=1;}
finally{if(workspace){try{const {EvaluationCatalog}=await import('./evaluation/catalog.ts'),{exportRealEvidence}=await import('./evaluation/real-export.ts');console.log(JSON.stringify({kind:'recovery-evidence',...await exportRealEvidence(new EvaluationCatalog(repository),workspace),budget:workspace.ledger.budget,execution:workspace.ledger.executionStatus()}));}catch{console.log(JSON.stringify({kind:'recovery-evidence',status:'raw-evidence-retained'}));}workspace.close();}}
