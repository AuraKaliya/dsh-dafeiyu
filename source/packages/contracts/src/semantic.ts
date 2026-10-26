import { z } from 'zod';
import { SummaryFragmentSchema } from './compaction.js';
import type { CompactionSource,SummaryFragment } from './compaction.js';

export const qualifierSchema=z.strictObject({seq:z.number().int().nonnegative(),role:z.enum(['user','assistant']),start:z.number().int().nonnegative(),end:z.number().int().positive(),text:z.string().min(1).max(600)});
export const semanticResultSchema=z.strictObject({fragment:SummaryFragmentSchema,qualifiers:z.array(qualifierSchema).max(64),
  verification:z.strictObject({compatible:z.literal(true),faithful:z.literal(true),issues:z.array(z.string()).max(0)}),
  model:z.strictObject({provider:z.string(),model:z.string(),reasoningEffort:z.string().optional()})});
export type SemanticResult=z.infer<typeof semanticResultSchema>;
export interface SemanticRequest {
  mode:'fusion'|'rebuild';sources:readonly CompactionSource[];parents:readonly SummaryFragment[];maxChars:number;
}
/** Conservative, verbatim clause anchors. UTF-16 offsets refer to the complete stored text.
 * Channel envelope fields are not user statements; role/source identity remains in proof. */
export function extractQualifiers(sources:readonly CompactionSource[]):SemanticResult['qualifiers'] {
  const result:SemanticResult['qualifiers']=[];
  const sensitive=/不|未|仅|只|须|需|如果|若|除非|否则|确认|验收|可能|或许|据|说|表示|推测|假设|更正|改为|取消|失败|成功|完成|计划|预计|之前|之后|截至|截止|有效|过期|测试|正式|[0-9]|\b(?:not|only|must|unless|may|pending|failed)\b/i;
  for(const source of sources){
    const marker='[消息正文]\n',offset=source.role==='user'&&source.text.startsWith('[程序提供的来源信息')?source.text.indexOf(marker): -1;
    const start=offset<0?0:offset+marker.length,body=source.text.slice(start);
    for(const match of body.matchAll(/[^。！？；;\n]+[。！？；;]?/g)){
      const text=match[0].trim();if(!text||!sensitive.test(text))continue;
      const position=start+match.index+match[0].indexOf(text);
      result.push({seq:source.seq,role:source.role,start:position,end:position+text.length,text});
    }
  }
  return z.array(qualifierSchema).max(64).parse(result);
}
/** Exact anchoring cannot prove complete semantic fidelity; independent verification is
 * mandatory too. Failure leaves existing valid fragments untouched. */
export function checkSemanticResult(request:SemanticRequest,value:unknown):SemanticResult {
  const result=semanticResultSchema.parse(value),qualifiers=extractQualifiers(request.sources);
  if(JSON.stringify(result.qualifiers)!==JSON.stringify(qualifiers)||Array.from(result.fragment.text).length>request.maxChars
    ||qualifiers.some(q=>!result.fragment.text.includes(q.text)))throw new Error('Semantic qualifier validation failed');
  return result;
}
