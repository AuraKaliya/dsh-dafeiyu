import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sha256 } from './catalog.ts';
import type { EvaluationCatalog } from './catalog.ts';
import type { EvaluationWorkspace } from './workspace.ts';
import { acquireEvaluationLease } from './lease.ts';
import { verifyCaseEvidence } from './evidence.ts';
import { CandidateSchema } from './real-support.ts';

const answerSchema=z.strictObject({reviewId:z.string(),answer:z.string(),turns:z.array(z.strictObject({prompt:z.string(),answer:z.string()})),modelClass:z.enum(['real','transport-test']),semanticAssessment:z.literal('not-performed')});
export async function exportRealEvidence(catalog:EvaluationCatalog,workspace:EvaluationWorkspace,options:{leaseHeld?:boolean}={}){
  if(workspace.config.mode!=='real'||workspace.config.suiteHash!==catalog.suiteHash||workspace.config.manifestHash!==catalog.manifestHash)throw new Error('EVALUATION_REAL_WORKSPACE_REQUIRED');const lease=options.leaseHeld?null:acquireEvaluationLease(workspace);
  try{const report=workspace.ledger.report();if(report.attempts.some(a=>a.state==='running'))throw new Error('EVALUATION_EXPLICIT_RECOVERY_REQUIRED');const verified:unknown[]=[],reviews:unknown[]=[],mapping:unknown[]=[];
    for(const attempt of report.attempts){const result=attempt.result;if(!result)throw new Error('EVALUATION_RESULT_MISSING');for(const artifact of result.artifacts)await workspace.read(artifact.relative,artifact.hash);const profile=result.artifacts.find(a=>a.relative===`cases/${attempt.attemptId}/profile.json`);if(profile)verified.push({attemptId:attempt.attemptId,...await verifyCaseEvidence(workspace,attempt.attemptId,profile)});else if(result.state==='needs-human-review')throw new Error('EVALUATION_EVIDENCE_INCOMPLETE');
      const answerRef=result.artifacts.find(a=>a.relative===`cases/${attempt.attemptId}/answer.json`),caseRef=result.artifacts.find(a=>a.relative===`cases/${attempt.attemptId}/case.json`);if(!answerRef||!caseRef){if(result.state==='needs-human-review')throw new Error('EVALUATION_EVIDENCE_INCOMPLETE');continue;}
      const answer=answerSchema.parse(JSON.parse((await workspace.read(answerRef.relative,answerRef.hash)).toString())),declared=z.object({candidate:CandidateSchema,modelClass:z.enum(['real','transport-test'])}).parse(JSON.parse((await workspace.read(caseRef.relative,caseRef.hash)).toString()));if(sha256(answer.answer)!==result.answerHash||answer.modelClass!==declared.modelClass)throw new Error('EVALUATION_ANSWER_CHANGED');
      if(attempt.caseId.startsWith('CAL-')||result.state!=='needs-human-review'||report.attempts.findLast(a=>a.caseId===attempt.caseId)?.attemptId!==attempt.attemptId)continue;
      const item=catalog.case(attempt.caseId),criteria=catalog.criteria(item.id);if(answer.reviewId!==item.reviewId)throw new Error('EVALUATION_ANSWER_CHANGED');reviews.push({reviewId:item.reviewId,answer:answer.answer,turns:answer.turns,criteria:{semantic:criteria.semantic,blockers:criteria.blockers},modelClass:answer.modelClass,assessment:'not-performed'});mapping.push({reviewId:item.reviewId,caseId:item.id,attemptId:attempt.attemptId,candidate:declared.candidate});
    }
    for(const batch of report.batches)await workspace.read(batch.relative,batch.hash);
    const id=randomUUID(),order=(value:unknown)=>sha256(id+z.object({reviewId:z.string()}).parse(value).reviewId);reviews.sort((a,b)=>order(a).localeCompare(order(b)));
    async function pages(name:string,items:unknown[]){const refs:{relative:string;hash:string}[]=[];for(let offset=0;offset<items.length;offset+=64)refs.push(await workspace.write(`reports/${id}/${name}-${String(refs.length+1).padStart(5,'0')}.json`,JSON.stringify({offset,items:items.slice(offset,offset+64)},null,2)+'\n'));return refs;}
    const {attempts,calls,...summary}=report,attemptPages=await pages('attempts',attempts),callPages=await pages('calls',calls),machine=await workspace.write(`reports/${id}/machine.json`,JSON.stringify({...summary,config:workspace.config,attemptCount:attempts.length,dispatchAttempts:calls.filter(c=>c.phase==='started').length,callPages,attemptPages,evidenceVerification:verified,reviewMapping:mapping,humanAccepted:false,semanticAssessment:'not-performed',realPlatform:false,serverAccess:false,overallTestsComplete:false,actualBackendVersion:'unknown-not-exposed-by-adapter'},null,2)+'\n'),review=await workspace.write(`reports/${id}/review.json`,JSON.stringify({schemaVersion:1,mode:'real-campaign',humanAccepted:false,items:reviews},null,2)+'\n'),index=await workspace.write(`reports/${id}/index.json`,JSON.stringify({schemaVersion:1,exportId:id,machine,review,verifiedAttempts:verified.length,reviewItems:reviews.length,generatedAt:new Date().toISOString()},null,2)+'\n');return {machine,review,index,verifiedAttempts:verified.length,reviewItems:reviews.length,humanAccepted:false};
  }finally{lease?.release();}
}
