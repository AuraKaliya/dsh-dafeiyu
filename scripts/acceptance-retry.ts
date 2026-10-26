import { readFile,lstat,readdir,statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EvaluationCatalog } from './evaluation/catalog.ts';
import { sha256 } from './evaluation/catalog.ts';
import type { EvaluationWorkspace } from './evaluation/workspace.ts';
import type { RealCandidate } from './evaluation/real-support.ts';
import { stableEvaluationError } from './evaluation/real-support.ts';
import { readRealAuthorization } from './evaluation/authorization.ts';
import { acquireEvaluationLease } from './evaluation/lease.ts';
import { cleanEvaluationRevision,captureRuntimeIdentity,runtimeIdentityHash } from './evaluation/identity.ts';
import { freezeRealCandidate,latestCandidateAttempt,requireRealCalibration } from './evaluation/real-candidate.ts';
import { runBoundaryReal } from './evaluation/real-boundary.ts';
import { runContinuityReal } from './evaluation/real-continuity.ts';
import { exportRealEvidence } from './evaluation/real-export.ts';
import { readFailureTriage,recognizedFailure } from './acceptance-triage.ts';
import type { FailureTriage } from './acceptance-triage.ts';
import { loadScopeCompatibility,scopedPrior,admitCompatibleBaseline } from './acceptance-scope.ts';
import type { ScopeCompatibility } from './acceptance-scope.ts';

/** Operator recovery: the model/driver candidate stays unchanged; this controller is independently archived. */
export async function eligibleCaseRetry(catalog:EvaluationCatalog,workspace:EvaluationWorkspace,candidate:RealCandidate,caseId:string,triage:readonly FailureTriage[]=[],scope:ScopeCompatibility|null=null){
  const item=catalog.case(caseId),index=catalog.manifest.cases.findIndex(c=>c.id===item.id),prior=await latestCandidateAttempt(workspace,item.id,candidate);
  if(index<0||!prior?.matches||!['failed','blocked','interrupted'].includes(prior.attempt.state))throw new Error('EVALUATION_FAILED_CASE_REQUIRED');
  if(await recognizedFailure(workspace,candidate,prior,triage))throw new Error('EVALUATION_RETAINED_FAILURE_REQUIRES_FIX');
  for(const previous of catalog.manifest.cases.slice(0,index)){const {prior:result,basisCandidate}=await scopedPrior(workspace,previous,candidate,scope);if((!result?.matches||result.attempt.state!=='needs-human-review')&&!await recognizedFailure(workspace,basisCandidate,result,triage))throw new Error('EVALUATION_PREVIOUS_CASE_INCOMPLETE');}
  return item;
}
async function controllerSources(repository:string){const files=[];for(const path of ['scripts/acceptance-retry.ts','scripts/retry-integrated-case.mjs','scripts/acceptance-triage.ts','scripts/acceptance-scope.ts','evaluation/phase7c/failure-triage.v1.json','evaluation/phase7c/scope-compatibility.v1.json']){const source=await readFile(join(repository,path),'utf8');files.push({path,source,hash:sha256(source)});}return files;}
async function evidenceBytes(root:string):Promise<number>{let total=0;for(const e of await readdir(root,{withFileTypes:true})){const p=join(root,e.name),s=await lstat(p);if(s.isSymbolicLink())throw new Error('EVALUATION_LINK_DENIED');if(s.isDirectory())total+=await evidenceBytes(p);else if(s.isFile())total+=s.size;else throw new Error('EVALUATION_FILE_TYPE_DENIED');}return total;}

export async function retryOneRealCase(repository:string,catalog:EvaluationCatalog,workspace:EvaluationWorkspace,caseId:string,onProgress:(value:unknown)=>void=()=>{}){
  if(process.env.DAFEIYU_TEST_RUN)throw new Error('EVALUATION_LIVE_CALLS_DISABLED_IN_TESTS');
  const {authorization,hash}=readRealAuthorization(repository);if(workspace.config.executionBounds?.authorizationHash!==hash||workspace.config.budget.maximumMicroCny!==authorization.maximumMicroCny)throw new Error('EVALUATION_AUTHORIZATION_CHANGED');
  const lease=acquireEvaluationLease(workspace),batchId=randomUUID(),startedAt=new Date().toISOString(),resourcesBefore=process.resourceUsage();let error:string|null=null,completed=false,controllerRevision:string|null=null,candidate:RealCandidate|undefined,controllerArtifact:{relative:string;hash:string}|undefined;
  const dispositions:{caseId:string;attemptId:string;state:string;action:'executed'}[]=[];
  try{
    if(workspace.ledger.report().attempts.some(a=>a.state==='running'))throw new Error('EVALUATION_EXPLICIT_RECOVERY_REQUIRED');if(workspace.ledger.budget.unknown)throw new Error('EVALUATION_UNKNOWN_COST');if(!workspace.ledger.phaseBudgetStatus())throw new Error('EVALUATION_PHASE_ALLOCATION_REQUIRED');
    workspace.ledger.startExecution('retest');controllerRevision=cleanEvaluationRevision(repository);const identity=await captureRuntimeIdentity(repository,{real:true});if(cleanEvaluationRevision(repository)!==controllerRevision)throw new Error('EVALUATION_CODE_CHANGED');
    const frozen=await freezeRealCandidate(workspace,controllerRevision,identity);candidate=frozen.candidate;const scope=await loadScopeCompatibility(repository,workspace,candidate,identity);if(!scope)await requireRealCalibration(workspace,candidate);const item=await eligibleCaseRetry(catalog,workspace,candidate,caseId,await readFailureTriage(repository),scope);
    const disk=await statfs(workspace.root);if(Number(disk.bavail)*Number(disk.bsize)<20*1024**3)throw new Error('EVALUATION_DISK_RESERVE_REQUIRED');if(await evidenceBytes(workspace.root)>10*1024**3)throw new Error('EVALUATION_EVIDENCE_CAPACITY_REACHED');
    const sources=await controllerSources(repository),sourceHash=sha256(JSON.stringify(sources)),admission=await admitCompatibleBaseline(workspace,item,candidate,scope);controllerArtifact=await workspace.write(`controllers/${batchId}.json`,JSON.stringify({candidate,identity,candidateArtifact:frozen.artifact,controllerRevision,sourceHash,files:sources,operatorOnly:true,compatibility:scope,...(admission?{baselineAdmission:{...admission,record:JSON.parse((await workspace.read(admission.relative,admission.hash)).toString())}}:{})},null,2)+'\n');
    onProgress({kind:'explicit-case-retry',caseId:item.id,candidate,controllerRevision,controllerArtifact,budget:workspace.ledger.budget});
    const options={repository,candidate,candidateArtifact:controllerArtifact,retry:true};const result=item.kind==='boundary'?await runBoundaryReal(catalog,item,workspace,options):await runContinuityReal(catalog,item,workspace,options);dispositions.push({caseId:item.id,attemptId:result.attemptId,state:result.state,action:'executed'});
    onProgress({kind:'explicit-case-retry-result',caseId:item.id,state:result.state,code:result.code,budget:workspace.ledger.budget});
    if(workspace.ledger.budget.unknown)throw new Error('EVALUATION_UNKNOWN_COST');if(result.state!=='needs-human-review')throw new Error(result.state==='blocked'&&result.code?result.code:'EVALUATION_CASE_REQUIRES_INSPECTION');
    if(runtimeIdentityHash(await captureRuntimeIdentity(repository,{real:true}))!==candidate.runtimeHash||sha256(JSON.stringify(await controllerSources(repository)))!==sourceHash)throw new Error('EVALUATION_RUNTIME_CHANGED');cleanEvaluationRevision(repository);
    const exported=await exportRealEvidence(catalog,workspace,{leaseHeld:true});completed=true;return {result,exported,candidate,controllerArtifact};
  }catch(caught){error=stableEvaluationError(caught);throw new Error(error);}
  finally{try{if(workspace.ledger.executionStatus()?.ownerPid===process.pid)workspace.ledger.stopExecution();const resources=process.resourceUsage(),artifact=await workspace.write(`batches/${batchId}.json`,JSON.stringify({schemaVersion:1,batchId,mode:'real',recovery:true,selection:[caseId],retry:true,candidate:candidate??null,controllerRevision,controllerArtifact:controllerArtifact??null,startedAt,finishedAt:new Date().toISOString(),completed,error,dispositions,resources:{userCpuMicroseconds:resources.userCPUTime-resourcesBefore.userCPUTime,systemCpuMicroseconds:resources.systemCPUTime-resourcesBefore.systemCPUTime,processLifetimeMaxRssKiB:resources.maxRSS,endingRssBytes:process.memoryUsage().rss},budget:workspace.ledger.budget,execution:workspace.ledger.executionStatus(),humanAccepted:false},null,2)+'\n');workspace.ledger.recordBatch({batchId,...artifact});}finally{lease.release();}}
}
