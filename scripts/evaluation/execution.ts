import { EvaluationCatalog } from './catalog.ts';
import type { EvaluationWorkspace } from './workspace.ts';
import { acquireEvaluationLease } from './lease.ts';
import { runBoundaryOffline } from './boundary.ts';
import { runContinuityOffline } from './continuity.ts';
import { randomUUID } from 'node:crypto';

export interface BatchSelection {cases?:string[];all?:boolean;retry?:boolean;recover?:boolean}
export function selectEvaluationCases(catalog:EvaluationCatalog,selection:BatchSelection){
  if(selection.all===true&&selection.cases?.length||selection.all!==true&&!selection.cases?.length)throw new Error('EVALUATION_SELECTION_REQUIRED');
  const ids=selection.all===true?catalog.manifest.cases.map(c=>c.id):selection.cases!;
  if(new Set(ids).size!==ids.length)throw new Error('EVALUATION_DUPLICATE_SELECTION');
  ids.forEach(id=>catalog.case(id));
  return catalog.manifest.cases.filter(c=>ids.includes(c.id));
}
export function verifyCatalogIdentity(catalog:EvaluationCatalog,workspace:EvaluationWorkspace){
  if(workspace.config.mode!=='offline')throw new Error('EVALUATION_OFFLINE_ONLY');
  if(workspace.config.suiteHash!==catalog.suiteHash||workspace.config.manifestHash!==catalog.manifestHash||workspace.config.foundationHash!==catalog.foundationHash||JSON.stringify(workspace.config.cases)!==JSON.stringify(catalog.manifest.cases.map(({id,reviewId})=>({id,reviewId}))))throw new Error('EVALUATION_CATALOG_CHANGED');
}
export async function runOfflineBatch(catalog:EvaluationCatalog,workspace:EvaluationWorkspace,selection:BatchSelection,onProgress?:(value:{caseId:string;state:string})=>void){
  verifyCatalogIdentity(catalog,workspace);
  const selected=selectEvaluationCases(catalog,selection),lease=acquireEvaluationLease(workspace),startedAt=new Date().toISOString(),started=performance.now(),usage=process.resourceUsage(),batchId=randomUUID();let completed=false;
  try{
    const recovered=selection.recover?workspace.ledger.recover():0,initial=workspace.ledger.report();
    if(initial.attempts.some(a=>a.state==='running'))throw new Error('EVALUATION_EXPLICIT_RECOVERY_REQUIRED');
    const dispositions:{caseId:string;state:string;action:'executed'|'skipped';attemptId:string|null}[]=[];
    for(const item of selected){
      const previous=initial.attempts.findLast(a=>a.caseId===item.id);
      if(previous&&!selection.retry){dispositions.push({caseId:item.id,state:previous.state,action:'skipped',attemptId:previous.attemptId});continue;}
      onProgress?.({caseId:item.id,state:'running'});
      const result=item.kind==='boundary'?await runBoundaryOffline(catalog,item,workspace,{retry:selection.retry??false}):await runContinuityOffline(catalog,item,workspace,{retry:selection.retry??false});
      dispositions.push({caseId:item.id,state:result.state,action:'executed',attemptId:result.attemptId});
      onProgress?.({caseId:item.id,state:result.state});
    }
    completed=true;return {mode:'offline' as const,batchId,recovered,dispositions,humanAccepted:false,realModel:false,realPlatform:false};
  }finally{try{const after=process.resourceUsage(),artifact=await workspace.write(`batches/${batchId}.json`,JSON.stringify({schemaVersion:1,batchId,mode:'offline',selection:selected.map(c=>c.id),retry:selection.retry??false,recover:selection.recover??false,startedAt,finishedAt:new Date().toISOString(),durationMs:performance.now()-started,executorCompleted:completed,processResources:{userCpuMicroseconds:after.userCPUTime-usage.userCPUTime,systemCpuMicroseconds:after.systemCPUTime-usage.systemCPUTime,processLifetimeMaxRssKiB:after.maxRSS,endingRssBytes:process.memoryUsage().rss},realModel:false,realPlatform:false},null,2)+'\n');workspace.ledger.recordBatch({batchId,...artifact});}finally{lease.release();}}
}
export function recoverOfflineWorkspace(workspace:EvaluationWorkspace){
  if(workspace.config.mode!=='offline')throw new Error('EVALUATION_OFFLINE_ONLY');
  const lease=acquireEvaluationLease(workspace);try{return workspace.ledger.recover();}finally{lease.release();}
}
