import {z} from 'zod';
import type {Json} from '@dafeiyu/contracts';

export interface ExpressionModelInput {question:string;evidence:{id:string;text:string;kind?:'reported'|'inference'}[]}
const bundleSchema=z.strictObject({kind:z.literal('evidence-bundle'),items:z.array(z.strictObject({id:z.string(),text:z.string()}))});
const checkSchema=z.strictObject({checks:z.array(z.strictObject({passageId:z.string(),status:z.enum(['supported','unsupported','contradicted','non-factual']),evidenceIds:z.array(z.string()),issue:z.string().max(300).nullable()}))});

function structured(text:string):Json {
  if(!/^[\s]*[\[{]/u.test(text))return text;
  try{const value:unknown=JSON.parse(text),parsed=z.json().safeParse(value);if(!parsed.success)return text;
    const safe=(item:Json):boolean=>typeof item==='number'?Number.isFinite(item)&&(!Number.isInteger(item)||Number.isSafeInteger(item)):
      item!==null&&typeof item==='object'?Object.values(item).every(safe):true;
    return safe(parsed.data)?parsed.data:text;
  }catch{return text;}
}
/** Decode JSON envelopes without summarizing or changing numeric identifier strings. */
function content(value:Json,depth=0):Json {
  if(depth>=12)return value;
  if(typeof value==='string'){const decoded=structured(value);return typeof decoded==='string'?value:content(decoded,depth+1);}
  if(Array.isArray(value))return value.map(item=>content(item,depth+1));
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,content(item,depth+1)]));
  return value;
}

export function deliveryVerificationBody(input:ExpressionModelInput,answer:string){
  const approvedEvidence=input.evidence.flatMap(item=>{
    const decoded=structured(item.text),bundle=bundleSchema.safeParse(decoded);
    return (bundle.success?bundle.data.items:[item])
      .map(source=>({id:source.id,kind:item.kind??'reported',content:content(source.text)}));
  });
  const candidatePassages=answer.split(/(?<=[。！？])|\r?\n/u).map(text=>text.trim()).filter(Boolean).map((text,index)=>({id:'P'+(index+1),text}));
  return {stage:'final-factual-check' as const,requestContext:input.question,approvedEvidence,candidatePassages};
}

/** A global approval flag cannot omit a paragraph or invent a supporting source. */
export function checkDeliveryVerification(raw:unknown,body:ReturnType<typeof deliveryVerificationBody>):void {
  const invalid=(reason:string):never=>{throw new Error('DELIVERY_VERIFICATION_INVALID_RESULT',{cause:{kind:'verification-contract',reason}});};
  const parsed=checkSchema.safeParse(raw),checks=parsed.success?parsed.data.checks:invalid('schema');
  const passages=new Map(body.candidatePassages.map(p=>[p.id,p])),sources=new Set(body.approvedEvidence.map(e=>e.id)),seen=new Set<string>(),issues:string[]=[];
  if(sources.size!==body.approvedEvidence.length)invalid('duplicate-source-ids');
  for(const check of checks){
    if(!passages.has(check.passageId))invalid('unknown-passage');
    if(seen.has(check.passageId))invalid('duplicate-passage');
    if(check.evidenceIds.some(id=>!sources.has(id)))invalid('unknown-evidence');
    seen.add(check.passageId);
    if(check.status==='supported'&&(!check.evidenceIds.length||check.issue!==null)||check.status==='non-factual'&&(check.evidenceIds.length||check.issue!==null))invalid('inconsistent-support');
    if(check.status==='unsupported'||check.status==='contradicted'){
      if(!check.issue?.trim())invalid('missing-issue');
      issues.push((check.passageId+'：'+check.issue).slice(0,300));
    }
  }
  if(!passages.size||seen.size!==passages.size)invalid('missing-passage');
  if(issues.length)throw new Error('delivery_unfaithful',{cause:{kind:'delivery-fidelity',issues:issues.slice(0,16)}});
}
