import { readFile,lstat,readdir,statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { EvaluationCatalog,EvaluationCase } from './evaluation/catalog.ts';
import { sha256 } from './evaluation/catalog.ts';
import type { EvaluationWorkspace } from './evaluation/workspace.ts';
import type { RealCandidate } from './evaluation/real-support.ts';
import { stableEvaluationError } from './evaluation/real-support.ts';
import { readRealAuthorization } from './evaluation/authorization.ts';
import { validateAppliedBudgetAuthorization } from './evaluation/budget-amendment.ts';
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

type Step={item:EvaluationCase;action:'execute';retry:boolean}|{item:EvaluationCase;action:'skip-pass'|'retain-failure';attemptId:string;basisCandidate:RealCandidate;scopeReused:boolean};
const matrixOptionsSchema=z.strictObject({scopeReuse:z.boolean().default(true)});
export type MatrixContinuationOptions=z.input<typeof matrixOptionsSchema>;
/** Retrying a case ordinal in this controller remains formal matrix work. */
export function matrixContinuationSettings(options:MatrixContinuationOptions={}){return Object.freeze({...matrixOptionsSchema.parse(options),executionPhase:'formal' as const});}
export async function matrixContinuationPlan(catalog:EvaluationCatalog,workspace:EvaluationWorkspace,candidate:RealCandidate,batch:number,triage:readonly FailureTriage[],scope:ScopeCompatibility|null=null,options:MatrixContinuationOptions={}){
  if(!Number.isInteger(batch)||batch<1||batch>9)throw new Error('EVALUATION_SELECTION_INVALID');const settings=matrixContinuationSettings(options),start=(batch-1)*18,end=batch*18,steps:Step[]=[],retained:FailureTriage[]=[];
  for(const [index,item]of catalog.manifest.cases.slice(0,end).entries()){const {prior,basisCandidate,reused}=settings.scopeReuse?await scopedPrior(workspace,item,candidate,scope):{prior:await latestCandidateAttempt(workspace,item.id,candidate),basisCandidate:candidate,reused:false};let action:'skip-pass'|'retain-failure'|null=null;
    if(prior?.matches&&prior.attempt.state==='needs-human-review')action='skip-pass';else if(settings.scopeReuse){const checked=await recognizedFailure(workspace,basisCandidate,prior,triage);if(checked){action='retain-failure';retained.push(checked);}}
    if(index<start){if(!action)throw new Error('EVALUATION_PREVIOUS_CASE_INCOMPLETE');continue;}
    if(action){steps.push({item,action,attemptId:prior!.attempt.attemptId,basisCandidate,scopeReused:reused});continue;}
    if(prior?.matches)throw new Error('EVALUATION_CASE_REQUIRES_INSPECTION');steps.push({item,action:'execute',retry:!!prior});
  }return {...settings,steps,retained};
}
async function sources(repository:string){const files=[];for(const path of ['scripts/acceptance-matrix.ts','scripts/acceptance-triage.ts','scripts/acceptance-scope.ts','scripts/continue-integrated-matrix.mjs','evaluation/phase7c/failure-triage.v1.json','evaluation/phase7c/scope-compatibility.v1.json']){const source=await readFile(join(repository,path),'utf8');files.push({path,source,hash:sha256(source)});}return files;}
async function evidenceBytes(root:string):Promise<number>{let total=0;for(const e of await readdir(root,{withFileTypes:true})){const p=join(root,e.name),s=await lstat(p);if(s.isSymbolicLink())throw new Error('EVALUATION_LINK_DENIED');if(s.isDirectory())total+=await evidenceBytes(p);else if(s.isFile())total+=s.size;else throw new Error('EVALUATION_FILE_TYPE_DENIED');}return total;}

export async function continueRealMatrix(repository:string,catalog:EvaluationCatalog,workspace:EvaluationWorkspace,batch:number,onProgress:(value:unknown)=>void=()=>{},options:MatrixContinuationOptions={}){
  if(process.env.DAFEIYU_TEST_RUN)throw new Error('EVALUATION_LIVE_CALLS_DISABLED_IN_TESTS');const {authorization,hash}=readRealAuthorization(repository);if(workspace.config.executionBounds?.authorizationHash!==hash||workspace.config.budget.maximumMicroCny!==authorization.maximumMicroCny)throw new Error('EVALUATION_AUTHORIZATION_CHANGED');
  validateAppliedBudgetAuthorization(repository,workspace.ledger);
  const settings=matrixContinuationSettings(options),lease=acquireEvaluationLease(workspace),batchId=randomUUID(),startedAt=new Date().toISOString(),resourcesBefore=process.resourceUsage();let completed=false,error:string|null=null,candidate:RealCandidate|undefined,controllerRevision:string|null=null,controllerArtifact:{relative:string;hash:string}|undefined,retained:FailureTriage[]=[];
  const dispositions:{caseId:string;attemptId:string;state:string;action:string;basisCandidate?:RealCandidate;scopeReused?:boolean}[]=[];
  try{if(workspace.ledger.report().attempts.some(a=>a.state==='running'))throw new Error('EVALUATION_EXPLICIT_RECOVERY_REQUIRED');if(workspace.ledger.budget.unknown)throw new Error('EVALUATION_UNKNOWN_COST');if(!workspace.ledger.phaseBudgetStatus())throw new Error('EVALUATION_PHASE_ALLOCATION_REQUIRED');workspace.ledger.startExecution(settings.executionPhase);
    controllerRevision=cleanEvaluationRevision(repository);const identity=await captureRuntimeIdentity(repository,{real:true});if(cleanEvaluationRevision(repository)!==controllerRevision)throw new Error('EVALUATION_CODE_CHANGED');const frozen=await freezeRealCandidate(workspace,controllerRevision,identity);candidate=frozen.candidate;const scope=settings.scopeReuse?await loadScopeCompatibility(repository,workspace,candidate,identity):null;if(!scope)await requireRealCalibration(workspace,candidate);
    const triage=settings.scopeReuse?await readFailureTriage(repository):[],plan=await matrixContinuationPlan(catalog,workspace,candidate,batch,triage,scope,{scopeReuse:settings.scopeReuse});retained=plan.retained;const files=await sources(repository),sourceHash=sha256(JSON.stringify(files)),controllerBody={...settings,candidate,identity,candidateArtifact:frozen.artifact,controllerRevision,sourceHash,files,operatorOnly:true,compatibility:scope,retainedFailures:retained,releaseBlocked:retained.length>0};controllerArtifact=await workspace.write(`controllers/${batchId}.json`,JSON.stringify(controllerBody,null,2)+'\n');
    for(const step of plan.steps){workspace.ledger.remainingExecutionMs();if(workspace.ledger.budget.unknown)throw new Error('EVALUATION_UNKNOWN_COST');if(sha256(JSON.stringify(await sources(repository)))!==sourceHash)throw new Error('EVALUATION_CONTROLLER_CHANGED');
      if(step.action!=='execute'){dispositions.push({caseId:step.item.id,attemptId:step.attemptId,state:step.action==='retain-failure'?'failed':'needs-human-review',action:step.action,basisCandidate:step.basisCandidate,scopeReused:step.scopeReused});continue;}
      const disk=await statfs(workspace.root);if(Number(disk.bavail)*Number(disk.bsize)<20*1024**3)throw new Error('EVALUATION_DISK_RESERVE_REQUIRED');if(await evidenceBytes(workspace.root)>10*1024**3)throw new Error('EVALUATION_EVIDENCE_CAPACITY_REACHED');
      const admission=settings.scopeReuse?await admitCompatibleBaseline(workspace,step.item,candidate,scope):null,caseArtifact=admission?await workspace.write(`controllers/${batchId}-${step.item.id}.json`,JSON.stringify({...controllerBody,baselineAdmission:{...admission,record:JSON.parse((await workspace.read(admission.relative,admission.hash)).toString())}},null,2)+'\n'):controllerArtifact;
      onProgress({kind:'matrix-case',caseId:step.item.id,state:'running',budget:workspace.ledger.budget});const driverOptions={repository,candidate,candidateArtifact:caseArtifact,retry:step.retry},result=step.item.kind==='boundary'?await runBoundaryReal(catalog,step.item,workspace,driverOptions):await runContinuityReal(catalog,step.item,workspace,driverOptions);
      dispositions.push({caseId:step.item.id,attemptId:result.attemptId,state:result.state,action:'executed'});onProgress({kind:'matrix-case',caseId:step.item.id,state:result.state,code:result.code,budget:workspace.ledger.budget});if(workspace.ledger.budget.unknown)throw new Error('EVALUATION_UNKNOWN_COST');if(result.state!=='needs-human-review')throw new Error(result.state==='blocked'&&result.code?result.code:'EVALUATION_CASE_REQUIRES_INSPECTION');
    }
    if(runtimeIdentityHash(await captureRuntimeIdentity(repository,{real:true}))!==candidate.runtimeHash||sha256(JSON.stringify(await sources(repository)))!==sourceHash)throw new Error('EVALUATION_RUNTIME_CHANGED');cleanEvaluationRevision(repository);
    const failedReview=[];for(const entry of retained){const prior=await latestCandidateAttempt(workspace,entry.caseId,entry.candidate),answer=prior?.attempt.result?.artifacts.find(a=>a.relative===`cases/${entry.attemptId}/answer.json`);if(!answer)throw new Error('EVALUATION_TRIAGE_PROOF_MISSING');failedReview.push({triage:entry,answer:JSON.parse((await workspace.read(answer.relative,answer.hash)).toString()),criteria:catalog.criteria(entry.caseId),programState:'failed',humanAccepted:false});}
    const supplement=await workspace.write(`reports/${batchId}/retained-failures.json`,JSON.stringify({schemaVersion:1,candidate,humanAccepted:false,releaseBlocked:retained.length>0,items:failedReview},null,2)+'\n'),exported=await exportRealEvidence(catalog,workspace,{leaseHeld:true});completed=true;return {...settings,batchId,dispositions,retainedFailures:retained,programPassed:dispositions.every(d=>d.state==='needs-human-review'),releaseBlocked:retained.length>0,supplement,exported};
  }catch(caught){error=stableEvaluationError(caught);throw new Error(error);}
  finally{try{if(workspace.ledger.executionStatus()?.ownerPid===process.pid)workspace.ledger.stopExecution();const resource=process.resourceUsage(),artifact=await workspace.write(`batches/${batchId}.json`,JSON.stringify({schemaVersion:1,...settings,batchId,batch,mode:'real',matrixContinuation:true,candidate:candidate??null,controllerRevision,controllerArtifact:controllerArtifact??null,startedAt,finishedAt:new Date().toISOString(),completed,programPassed:completed&&dispositions.every(d=>d.state==='needs-human-review'),releaseBlocked:retained.length>0||!completed,retainedFailures:retained,error,dispositions,resources:{userCpuMicroseconds:resource.userCPUTime-resourcesBefore.userCPUTime,systemCpuMicroseconds:resource.systemCPUTime-resourcesBefore.systemCPUTime,endingRssBytes:process.memoryUsage().rss},budget:workspace.ledger.budget,execution:workspace.ledger.executionStatus(),humanAccepted:false},null,2)+'\n');workspace.ledger.recordBatch({batchId,...artifact});}finally{lease.release();}}
}
