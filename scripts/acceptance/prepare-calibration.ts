import {mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {readJson,saveJson,hash,repository,fingerprint} from './io.mjs';
import {verifierCasesSchema,replayVerifier} from './replay-verifier.ts';
import {deliveryVerificationBody} from '../../packages/memory/lib/delivery-verification.js';
import {DELIVERY_VERIFICATION_INSTRUCTIONS} from '../../packages/memory/lib/expression-runtime.js';

/** Build empty, hash-bound collection material. Never invoke a model or fill expected answers as observations. */
export function prepareCalibration(casesRaw:unknown){const cases=verifierCasesSchema.parse(casesRaw),casesHash=hash(cases);
  const observations={schemaVersion:1,casesHash,mode:'recorded' as const,observations:[]};
  return {inputs:{schemaVersion:1,casesHash,instructions:DELIVERY_VERIFICATION_INSTRUCTIONS,instructionsHash:hash(DELIVERY_VERIFICATION_INSTRUCTIONS),requests:cases.cases.map(item=>{
    const body=deliveryVerificationBody({question:item.question,evidence:item.evidence},item.answer);return {caseId:item.id,split:item.split,inputHash:hash(body),body};})},
    expectations:cases,observations,readiness:replayVerifier(cases,observations)};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  if(process.argv.length>3)throw new Error('Usage: prepare-calibration.ts [new-directory]');const directory=resolve(process.argv[2]??join(repository,'.runtime','calibration',randomUUID()));
  if(existsSync(directory))throw new Error('CALIBRATION_NEW_DIRECTORY_REQUIRED');mkdirSync(directory,{recursive:true});
  const prepared=prepareCalibration(readJson(join(repository,'tests/fixtures/acceptance/verifier-cases.json')));
  for(const [name,value]of Object.entries(prepared))saveJson(join(directory,name+'.json'),value);
  saveJson(join(directory,'manifest.json'),{schemaVersion:1,createdAt:new Date().toISOString(),sourceHash:fingerprint('source'),driverHash:fingerprint('driver'),casesHash:prepared.inputs.casesHash,paidCalls:false,modelCalled:false,semanticReliabilityProven:false});
  console.log(JSON.stringify({prepared:true,cases:prepared.inputs.requests.length,modelCalled:false,notExecuted:prepared.readiness.counts.notExecuted,directory}));
}
