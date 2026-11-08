import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {existsSync} from 'node:fs';
import {z} from 'zod';
import {deliveryVerificationBody,checkDeliveryVerification} from '../../packages/memory/lib/delivery-verification.js';
import {readJson,saveJson,hash,repository} from './io.mjs';

export const verifierCasesSchema=z.strictObject({schemaVersion:z.literal(1),purpose:z.string(),cases:z.array(z.strictObject({
  id:z.string().regex(/^[a-z][a-z0-9-]+$/),split:z.enum(['calibration','holdout']),question:z.string(),
  evidence:z.array(z.strictObject({id:z.string(),kind:z.enum(['reported','inference']),text:z.string()})),
  answer:z.string(),expected:z.enum(['accept','reject']),reason:z.string(),
})).min(1)}).refine(value=>new Set(value.cases.map(row=>row.id)).size===value.cases.length,'Duplicate case');
const observationSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('response'),caseId:z.string(),requestId:z.string().min(1),inputHash:z.string().length(64),response:z.unknown()}),
  z.strictObject({kind:z.literal('failure'),caseId:z.string(),requestId:z.string().min(1),inputHash:z.string().length(64),code:z.string().regex(/^[A-Z][A-Z0-9_]+$/)}),
]);
const observationsSchema=z.strictObject({schemaVersion:z.literal(1),casesHash:z.string().length(64),mode:z.enum(['scripted','recorded']),observations:z.array(observationSchema)});

/** Replays previously collected responses. It neither invokes an LLM nor treats service failure as semantic rejection. */
export function replayVerifier(casesRaw:unknown,observationsRaw:unknown) {
  const cases=verifierCasesSchema.parse(casesRaw),saved=observationsSchema.parse(observationsRaw);
  if(saved.casesHash!==hash(cases))throw new Error('VERIFIER_CASES_CHANGED');
  if(new Set(saved.observations.map(row=>row.caseId)).size!==saved.observations.length || new Set(saved.observations.map(row=>row.requestId)).size!==saved.observations.length)throw new Error('VERIFIER_DUPLICATE_OBSERVATION');
  if(saved.observations.some(row=>!cases.cases.some(item=>item.id===row.caseId)))throw new Error('VERIFIER_UNKNOWN_CASE');
  const results=cases.cases.map(item=>{
    const body=deliveryVerificationBody({question:item.question,evidence:item.evidence},item.answer),observation=saved.observations.find(row=>row.caseId===item.id);
    const common={id:item.id,split:item.split,expected:item.expected,inputHash:hash(body)};
    if(!observation)return {...common,actual:'not-executed',matchesExpectation:false,code:null};
    if(observation.inputHash!==common.inputHash)return {...common,actual:'invalid-evidence',matchesExpectation:false,code:'VERIFIER_INPUT_CHANGED'};
    if(observation.kind==='failure')return {...common,actual:'unavailable',matchesExpectation:false,code:observation.code};
    let actual='accept',code:string|null=null;
    try{checkDeliveryVerification(observation.response,body);}catch(error){
      if(error instanceof Error&&error.message==='delivery_unfaithful'){actual='reject';code='DELIVERY_UNFAITHFUL';}
      else {actual='invalid-response';code='DELIVERY_VERIFICATION_INVALID_RESULT';}
    }
    return {...common,actual,matchesExpectation:actual===item.expected,code};
  });
  const score=(subset:typeof results)=>{const comparable=subset.filter(row=>row.actual==='accept'||row.actual==='reject'),negative=comparable.filter(row=>row.expected==='reject'),positive=comparable.filter(row=>row.expected==='accept');
    return {planned:subset.length,comparable:comparable.length,falseAccept:negative.filter(row=>row.actual==='accept').length,falseReject:positive.filter(row=>row.actual==='reject').length,
      falseAcceptRate:negative.length?negative.filter(row=>row.actual==='accept').length/negative.length:null,falseRejectRate:positive.length?positive.filter(row=>row.actual==='reject').length/positive.length:null,
      unavailable:subset.filter(row=>row.actual==='unavailable').length,notExecuted:subset.filter(row=>row.actual==='not-executed').length,invalid:subset.filter(row=>row.actual==='invalid-evidence'||row.actual==='invalid-response').length};};
  return {schemaVersion:1,scope:'archived-verifier-response-replay',mode:saved.mode,casesHash:hash(cases),
    realModelCalled:false,semanticReliabilityProven:false,matchesExpectations:results.every(row=>row.matchesExpectation),results,
    bySplit:{calibration:score(results.filter(row=>row.split==='calibration')),holdout:score(results.filter(row=>row.split==='holdout'))},
    counts:{falseAccept:results.filter(row=>row.expected==='reject'&&row.actual==='accept').length,
      falseReject:results.filter(row=>row.expected==='accept'&&row.actual==='reject').length,
      unavailable:results.filter(row=>row.actual==='unavailable').length,notExecuted:results.filter(row=>row.actual==='not-executed').length,
      invalid:results.filter(row=>row.actual==='invalid-evidence'||row.actual==='invalid-response').length}};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const [observations,output,...extra]=process.argv.slice(2);
  if(!observations||!output||extra.length)throw new Error('Usage: node scripts/acceptance/replay-verifier.ts <observations.json> <new-report.json>');
  if(existsSync(resolve(output)))throw new Error('VERIFIER_NEW_REPORT_REQUIRED');
  const result=replayVerifier(readJson(join(repository,'tests/fixtures/acceptance/verifier-cases.json')),readJson(resolve(observations)));
  saveJson(resolve(output),result);console.log(JSON.stringify({matchesExpectations:result.matchesExpectations,realModelCalled:false,counts:result.counts,report:resolve(output)}));
  if(!result.matchesExpectations)process.exitCode=1;
}
