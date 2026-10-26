import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readdir,lstat,statfs } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { EvaluationCatalog,EvaluationCase } from './catalog.ts';
import type { EvaluationWorkspace } from './workspace.ts';
import { acquireEvaluationLease } from './lease.ts';
import { cleanEvaluationRevision,captureRuntimeIdentity,runtimeIdentityHash } from './identity.ts';
import { CALIBRATION_CASES,readRealAuthorization } from './authorization.ts';
import { validateAppliedBudgetAuthorization } from './budget-amendment.ts';
import { freezeRealCandidate,latestCandidateAttempt,requireRealCalibration } from './real-candidate.ts';
import { runBoundaryReal } from './real-boundary.ts';
import { runContinuityReal } from './real-continuity.ts';
import { RealCaseRecord,checkFoundation,stableEvaluationError } from './real-support.ts';
import type { RealDriverOptions } from './real-support.ts';
import { openRealEvaluationRuntime } from './real-runtime.ts';
import { nativeAnswer } from './boundary.ts';
import { exportRealEvidence } from './real-export.ts';
import { sha256 } from './catalog.ts';

export interface RealSelection {calibrate?:boolean;calibrationCase?:string;batch?:number;retry?:boolean}
export function selectedRealCases(catalog:EvaluationCatalog,selection:RealSelection){
  if(Number(selection.calibrate===true)+Number(selection.calibrationCase!==undefined)+Number(selection.batch!==undefined)!==1||selection.batch!==undefined&&(!Number.isInteger(selection.batch)||selection.batch<1||selection.batch>9)||selection.calibrationCase!==undefined&&!CALIBRATION_CASES.includes(selection.calibrationCase))throw new Error('EVALUATION_SELECTION_INVALID');
  if(selection.calibrate||selection.calibrationCase){const templates=['B01-neutral-1','B06-neutral-1','H06-full-1','H06-compressed-1','H06-compressed-restarted-1'];return CALIBRATION_CASES.map((id,index)=>({...catalog.case(templates[index]!),id,reviewId:id})).filter(item=>!selection.calibrationCase||item.id===selection.calibrationCase);}
  return catalog.manifest.cases.slice((selection.batch!-1)*18,selection.batch!*18);
}
async function evidenceBytes(root:string):Promise<number>{let total=0;for(const entry of await readdir(root,{withFileTypes:true})){const path=join(root,entry.name),info=await lstat(path);if(info.isSymbolicLink())throw new Error('EVALUATION_LINK_DENIED');if(info.isDirectory())total+=await evidenceBytes(path);else if(info.isFile())total+=info.size;else throw new Error('EVALUATION_FILE_TYPE_DENIED');}return total;}
async function routeProbe(catalog:EvaluationCatalog,item:EvaluationCase,workspace:EvaluationWorkspace,options:RealDriverOptions){const record=await RealCaseRecord.begin(workspace,item,options);let runtime:Awaited<ReturnType<typeof openRealEvaluationRuntime>>|undefined;
  try{runtime=await openRealEvaluationRuntime({repository:options.repository,campaignRoot:workspace.root,root:record.profile,foundationFile:join(workspace.root,'sources/persona.foundation.md'),ledger:workspace.ledger,attemptId:record.attemptId,caseDeadline:record.startedAt+300000,policies:[{id:'case',producers:['evaluation'],actions:[],allowLocalWrite:false,sourceRules:[],resources:[]}],...(options.testBackend?{testBackend:options.testBackend}:{})});const prompt='这是本机隔离的连接校准。请只简短确认收到，不调用工具，不声称已经执行其他事情。',task=runtime.port.submitTask({requestId:'route',title:'连接校准',goal:prompt,policyId:'case'});await runtime.core.whenIdle();record.check('native-run-completed',runtime.port.status(task.run).state==='completed',runtime.port.status(task.run));record.check('single-model-route',runtime.requests.length===1&&runtime.requests[0]!.reasoningEffort==='max',{calls:runtime.requests.length});record.turns.push({prompt,answer:nativeAnswer(runtime,record.profile,task.run.id)});await checkFoundation(record);}catch(error){record.fail(error);}finally{try{await runtime?.close();}catch(error){record.fail(error);}}return record.finish();}

/** Real calls are admitted only here, under one campaign lease, one clock, and one cumulative ledger. */
export async function runAuthorizedBatch(repository:string,catalog:EvaluationCatalog,workspace:EvaluationWorkspace,selection:RealSelection,onProgress:(value:unknown)=>void=()=>{}){
  if(process.env.DAFEIYU_TEST_RUN)throw new Error('EVALUATION_LIVE_CALLS_DISABLED_IN_TESTS');const {authorization,hash}=readRealAuthorization(repository);if(workspace.config.executionBounds?.authorizationHash!==hash||workspace.config.budget.maximumMicroCny!==authorization.maximumMicroCny)throw new Error('EVALUATION_AUTHORIZATION_CHANGED');
  validateAppliedBudgetAuthorization(repository,workspace.ledger);
  const selected=selectedRealCases(catalog,selection),isCalibration=!!(selection.calibrate||selection.calibrationCase),lease=acquireEvaluationLease(workspace),batchId=randomUUID(),startedAt=new Date().toISOString(),usage=process.resourceUsage();let completed=false,verified=false,error:string|null=null,controllerHead:string|null=null;const dispositions:{caseId:string;attemptId:string;state:string;action:'executed'|'skipped'}[]=[];let frozen:Awaited<ReturnType<typeof freezeRealCandidate>>|undefined;
  try{
    if(workspace.ledger.report().attempts.some(a=>a.state==='running'))throw new Error('EVALUATION_EXPLICIT_RECOVERY_REQUIRED');if(workspace.ledger.budget.unknown)throw new Error('EVALUATION_UNKNOWN_COST');if(!workspace.ledger.phaseBudgetStatus())throw new Error('EVALUATION_PHASE_ALLOCATION_REQUIRED');
    workspace.ledger.startExecution(isCalibration?'calibration':selection.retry?'retest':'formal');
    const revision=cleanEvaluationRevision(repository);controllerHead=revision;const identity=await captureRuntimeIdentity(repository,{real:true});if(cleanEvaluationRevision(repository)!==revision)throw new Error('EVALUATION_CODE_CHANGED');frozen=await freezeRealCandidate(workspace,revision,identity);if(!isCalibration)await requireRealCalibration(workspace,frozen.candidate);
    if(selection.batch!==undefined)for(const previous of catalog.manifest.cases.slice(0,(selection.batch-1)*18)){const prior=await latestCandidateAttempt(workspace,previous.id,frozen.candidate);if(!prior?.matches||prior.attempt.state!=='needs-human-review')throw new Error('EVALUATION_PREVIOUS_BATCH_INCOMPLETE');}
    const disk=await statfs(workspace.root);if(Number(disk.bavail)*Number(disk.bsize)<20*1024**3)throw new Error('EVALUATION_DISK_RESERVE_REQUIRED');
    for(const item of selected){workspace.ledger.remainingExecutionMs();if(workspace.ledger.budget.unknown)throw new Error('EVALUATION_UNKNOWN_COST');if(await evidenceBytes(workspace.root)>10*1024**3)throw new Error('EVALUATION_EVIDENCE_CAPACITY_REACHED');const prior=await latestCandidateAttempt(workspace,item.id,frozen.candidate);
      if(prior&&(!selection.retry||selection.calibrate&&prior.matches&&prior.attempt.state==='needs-human-review')){if(!prior.matches)throw new Error('EVALUATION_RETRY_MUST_BE_EXPLICIT');dispositions.push({caseId:item.id,attemptId:prior.attempt.attemptId,state:prior.attempt.state,action:'skipped'});if(prior.attempt.state!=='needs-human-review')throw new Error('EVALUATION_RETRY_MUST_BE_EXPLICIT');continue;}
      onProgress({kind:'real-case',caseId:item.id,state:'running',budget:workspace.ledger.budget,execution:workspace.ledger.executionStatus()});const options:RealDriverOptions={repository,candidate:frozen.candidate,candidateArtifact:frozen.artifact,retry:selection.retry??false};const result=item.id==='CAL-route'?await routeProbe(catalog,item,workspace,options):item.kind==='boundary'?await runBoundaryReal(catalog,item,workspace,options):await runContinuityReal(catalog,item,workspace,options);
      dispositions.push({caseId:item.id,attemptId:result.attemptId,state:result.state,action:'executed'});onProgress({kind:'real-case',caseId:item.id,state:result.state,code:result.code,budget:workspace.ledger.budget,execution:workspace.ledger.executionStatus()});if(workspace.ledger.budget.unknown)throw new Error('EVALUATION_UNKNOWN_COST');if(result.state!=='needs-human-review')throw new Error(result.state==='blocked'&&result.code?result.code:'EVALUATION_CASE_REQUIRES_INSPECTION');
    }
    if(runtimeIdentityHash(await captureRuntimeIdentity(repository,{real:true}))!==frozen.candidate.runtimeHash)throw new Error('EVALUATION_RUNTIME_CHANGED');cleanEvaluationRevision(repository);verified=true;
    const exported=await exportRealEvidence(catalog,workspace,{leaseHeld:true});
    if(selection.calibrate){const attempts=dispositions.map(d=>d.attemptId),marker=`calibrated/${sha256(JSON.stringify(frozen.candidate))}/${sha256(JSON.stringify(attempts))}.json`;if(!existsSync(join(workspace.root,marker)))await workspace.write(marker,JSON.stringify({candidate:frozen.candidate,attempts,export:exported.index,at:new Date().toISOString()},null,2)+'\n');}
    completed=true;return {batchId,dispositions,exported,budget:workspace.ledger.budget,execution:workspace.ledger.executionStatus(),humanAccepted:false};
  }catch(caught){error=stableEvaluationError(caught);throw new Error(error);}
  finally{try{if(workspace.ledger.executionStatus()?.ownerPid===process.pid)workspace.ledger.stopExecution();const resources=process.resourceUsage(),artifact=await workspace.write(`batches/${batchId}.json`,JSON.stringify({schemaVersion:1,batchId,mode:'real',selection:selected.map(c=>c.id),retry:selection.retry??false,candidate:frozen?.candidate??null,controllerHead,startedAt,finishedAt:new Date().toISOString(),completed,runtimeVerified:verified,error,dispositions,resources:{userCpuMicroseconds:resources.userCPUTime-usage.userCPUTime,systemCpuMicroseconds:resources.systemCPUTime-usage.systemCPUTime,processLifetimeMaxRssKiB:resources.maxRSS,endingRssBytes:process.memoryUsage().rss},budget:workspace.ledger.budget,execution:workspace.ledger.executionStatus(),humanAccepted:false},null,2)+'\n');workspace.ledger.recordBatch({batchId,...artifact});}finally{lease.release();}}
}
