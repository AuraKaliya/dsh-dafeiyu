import { randomUUID } from 'node:crypto';
import { redactContent } from '@dafeiyu/contracts';
import { AnalysisError } from './analysis-types.js';
import type { AnalysisJob, AnalysisResult, Candidate } from './analysis-types.js';
import type { Command } from './types.js';

const conditional = /开玩笑|玩笑|假设|如果|据说|听说|朋友说|转述|也许|可能|不确定|暂时|这周|本周|本次|仅限|当前会话|不要记|别记|不能记/;
const correction = /更正|改为|纠正|修正|替换/;

/** Model labels are proposals; exact spans, ownership and deterministic guards decide auto publication. */
export function candidates(job:AnalysisJob,result:AnalysisResult):Candidate[] {
  // Fabricated references invalidate the whole report, including opposition.
  for(const claim of result.claims)for(const span of [...claim.support,...claim.opposition]){
    const source=job.sources.find(item=>item.sourceId===span.sourceId);
    if(!source||!source.text.includes(span.quote))throw new AnalysisError('invalid_evidence');
  }
  return result.claims.map(claim=>{
    const candidate:Candidate={id:randomUUID(),claim,status:'needs_review',reason:'policy_review'};
    const source=job.sources.find(item=>item.sourceId===claim.support[0]?.sourceId);
    if(claim.action==='none'){candidate.reason='no_update';return candidate;}
    if(!source||claim.support.length!==1||claim.content!==claim.support[0]!.quote){candidate.reason='non_literal';return candidate;}
    // Whole user message is required in v1: a model cannot omit a condition, negation or quotation prefix.
    if(source.origin!=='user'||!source.authorId||claim.claimType!=='self_report'||claim.content!==source.text.trim()){
      candidate.reason='requires_interpretation';return candidate;
    }
    if(!claim.explicit||claim.temporal!=='durable'||claim.opposition.length||claim.uncertainties.length||result.gaps.length||conditional.test(source.text)){
      candidate.reason='uncertain_or_temporary';return candidate;
    }
    if(!claim.content.includes(claim.subject)){candidate.reason='subject_unanchored';return candidate;}
    const cleaned=redactContent(`【陈述者 ${source.authorId}】${claim.content}`).value;
    const value={kind:claim.kind,claimType:claim.claimType,content:cleaned,sources:[source.evidence],
      analysis:{jobId:job.id,candidateId:candidate.id,policyVersion:'literal-evidence-v1' as const}};
    const base={requestId:`analysis:${job.id}:${candidate.id}`,expectedGeneration:job.generation,value};
    let command:Command;
    if(claim.action==='revise'){
      const target=job.targets.find(item=>item.item.id===claim.targetId);
      if(!target||target.authorIds.length!==1||!target.authorIds.includes(source.authorId)||!target.item.content.includes(claim.subject)||!correction.test(source.text)
        ||result.claims.filter(item=>item.targetId===claim.targetId).length!==1){candidate.reason='ambiguous_correction';return candidate;}
      command={...base,action:'revise',id:target.item.id,expectedVersion:target.item.version};
    }else{
      if(claim.targetId!==null){candidate.reason='unexpected_target';return candidate;}
      command={...base,action:'create'};
    }
    candidate.command=command;candidate.status='ready';candidate.reason='literal_self_report';return candidate;
  });
}
