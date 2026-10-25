import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sha256 } from './catalog.ts';
import type { EvaluationCatalog } from './catalog.ts';
import type { EvaluationWorkspace } from './workspace.ts';
import { acquireEvaluationLease } from './lease.ts';
import { verifyCaseEvidence } from './evidence.ts';
import { verifyCatalogIdentity } from './execution.ts';

const answerSchema=z.strictObject({reviewId:z.string(),answer:z.string(),turns:z.array(z.strictObject({prompt:z.string(),answer:z.string()})).optional(),modelClass:z.literal('scripted'),semanticAssessment:z.literal('not-performed')});
type Review={reviewId:string;answer:string;turns:{prompt:string;answer:string}[];criteria:{semantic:string[];blockers:string[]};assessment:'not-performed';modelClass:'scripted'};

/** All attempts remain in the machine report. Review packets contain only the latest eligible answer. */
export async function exportOfflineEvidence(catalog:EvaluationCatalog,workspace:EvaluationWorkspace){
  verifyCatalogIdentity(catalog,workspace);const lease=acquireEvaluationLease(workspace);
  try{
    const report=workspace.ledger.report();if(report.attempts.some(a=>a.state==='running'))throw new Error('EVALUATION_EXPLICIT_RECOVERY_REQUIRED');
    const reviews:Review[]=[],verified:{attemptId:string;files:number;bytes:number;hash:string}[]=[],mapping:{reviewId:string;caseId:string;attemptId:string;state:string}[]=[];
    for(const attempt of report.attempts){
      const result=attempt.result;if(!result)throw new Error('EVALUATION_RESULT_MISSING');
      for(const artifact of result.artifacts)await workspace.read(artifact.relative,artifact.hash);
      const profile=result.artifacts.find(a=>a.relative===`cases/${attempt.attemptId}/profile.json`);
      if(profile)verified.push({attemptId:attempt.attemptId,...await verifyCaseEvidence(workspace,attempt.attemptId,profile)});
      else if(result.state==='needs-human-review')throw new Error('EVALUATION_EVIDENCE_INCOMPLETE');
      const reference=result.artifacts.find(a=>a.relative===`cases/${attempt.attemptId}/answer.json`);
      if(!reference){if(result.state==='needs-human-review')throw new Error('EVALUATION_ANSWER_MISSING');continue;}
      const answer=answerSchema.parse(JSON.parse((await workspace.read(reference.relative,reference.hash)).toString())),item=catalog.case(attempt.caseId);
      if(answer.reviewId!==item.reviewId||sha256(answer.answer)!==result.answerHash)throw new Error('EVALUATION_ANSWER_CHANGED');
      // Failed/interrupted attempts remain inspectable, but cannot masquerade as eligible review answers.
      if(result.state!=='needs-human-review'||report.attempts.findLast(a=>a.caseId===item.id)?.attemptId!==attempt.attemptId)continue;
      const criteria=catalog.criteria(item.id);
      reviews.push({reviewId:item.reviewId,answer:answer.answer,turns:answer.turns??[{prompt:item.kind==='continuity'?catalog.history(item.sampleId).question:'',answer:answer.answer}],criteria:{semantic:criteria.semantic,blockers:criteria.blockers},assessment:'not-performed',modelClass:'scripted'});
      mapping.push({reviewId:item.reviewId,caseId:item.id,attemptId:attempt.attemptId,state:result.state});
    }
    // This ordering is independent of the execution and frozen manifest order.
    const exportId=randomUUID();reviews.sort((a,b)=>sha256(exportId+a.reviewId).localeCompare(sha256(exportId+b.reviewId)));
    for(const batch of report.batches)await workspace.read(batch.relative,batch.hash);
    async function pages(name:string,items:unknown[]){const refs:{relative:string;hash:string}[]=[];for(let offset=0;offset<items.length;offset+=64)refs.push(await workspace.write(`reports/${exportId}/${name}-${String(refs.length+1).padStart(5,'0')}.json`,JSON.stringify({offset,items:items.slice(offset,offset+64)},null,2)+'\n'));return refs;}
    const {attempts,calls,...summary}=report,attemptPages=await pages('attempts',attempts),callPages=await pages('calls',calls);
    const machine=await workspace.write(`reports/${exportId}/machine.json`,JSON.stringify({...summary,attemptCount:attempts.length,callRecordCount:calls.length,attemptPages,callPages,config:workspace.config,evidenceVerification:verified,reviewMapping:mapping,realModel:false,realPlatform:false,semanticAssessment:'not-performed'},null,2)+'\n');
    const review=await workspace.write(`reports/${exportId}/review.json`,JSON.stringify({schemaVersion:1,mode:'offline',humanAccepted:false,semanticAssessment:'not-performed',items:reviews},null,2)+'\n');
    const index=await workspace.write(`reports/${exportId}/index.json`,JSON.stringify({schemaVersion:1,exportId,machine,review,verifiedAttempts:verified.length,reviewItems:reviews.length,generatedAt:new Date().toISOString()},null,2)+'\n');
    return {machine,review,index,verifiedAttempts:verified.length,reviewItems:reviews.length,humanAccepted:false};
  }finally{lease.release();}
}
