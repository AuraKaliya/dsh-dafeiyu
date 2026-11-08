import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {hash,readJson,repository} from '../../scripts/acceptance/io.mjs';
import {replayVerifier,verifierCasesSchema} from '../../scripts/acceptance/replay-verifier.ts';
import {deliveryVerificationBody} from '../../packages/memory/lib/delivery-verification.js';
import {prepareCalibration} from '../../scripts/acceptance/prepare-calibration.ts';

const cases=verifierCasesSchema.parse(readJson(join(repository,'tests/fixtures/acceptance/verifier-cases.json')));
function observations(){return {schemaVersion:1,casesHash:hash(cases),mode:'scripted',observations:cases.cases.map(item=>{
  const body=deliveryVerificationBody({question:item.question,evidence:item.evidence},item.answer);
  return {kind:'response',caseId:item.id,requestId:'fixture-'+item.id,inputHash:hash(body),response:{checks:body.candidatePassages.map(p=>({passageId:p.id,status:item.expected==='accept'?'scope-limited':'unsupported',evidenceIds:[],issue:item.expected==='accept'?null:item.reason}))}};
})};}

test('versioned verifier corpus has positive, negative and held-out cases; scripted replay never proves semantics',()=>{
  assert.ok(cases.cases.some(row=>row.split==='holdout'&&row.expected==='accept'));
  assert.ok(cases.cases.some(row=>row.split==='holdout'&&row.expected==='reject'));
  const result=replayVerifier(cases,observations());assert.equal(result.matchesExpectations,true);
  assert.equal(result.semanticReliabilityProven,false);assert.equal(result.realModelCalled,false);
});
test('verifier replay reports false acceptance and rejection separately',()=>{
  const input=observations();
  const wrong=input.observations[0]!,limited=input.observations[1]!;
  wrong.response.checks=wrong.response.checks.map(row=>({...row,status:'scope-limited',issue:null}));
  limited.response.checks=limited.response.checks.map(row=>({...row,status:'unsupported',issue:'incorrect scripted refusal'}));
  const result=replayVerifier(cases,input);assert.equal(result.counts.falseAccept,1);assert.equal(result.counts.falseReject,1);
});
test('calibration preparation separates answer keys from model inputs and leaves real observations empty',()=>{
  const prepared=prepareCalibration(cases);assert.equal(prepared.inputs.requests.length,24);assert.equal(prepared.observations.observations.length,0);assert.equal(prepared.readiness.counts.notExecuted,24);
  assert.equal(prepared.readiness.bySplit.calibration.comparable,0);assert.equal(prepared.readiness.bySplit.holdout.falseAcceptRate,null);assert.equal(prepared.readiness.semanticReliabilityProven,false);
  for(const request of prepared.inputs.requests){assert.equal('expected'in request,false);assert.equal('reason'in request,false);assert.equal(request.inputHash,hash(request.body));}
  assert.equal(prepared.inputs.instructionsHash,hash(prepared.inputs.instructions));
});
test('service errors, malformed responses, changed input and missing cases cannot count as correct rejection',()=>{
  const input=observations(),first=input.observations[0]!;
  const failed={...input,observations:[{kind:'failure',caseId:first.caseId,requestId:first.requestId,inputHash:first.inputHash,code:'MODEL_HTTP_500'}]};
  const result=replayVerifier(cases,failed);assert.equal(result.matchesExpectations,false);assert.equal(result.counts.unavailable,1);assert.equal(result.counts.notExecuted,cases.cases.length-1);
  assert.equal(result.bySplit.calibration.falseAcceptRate,null);assert.equal(result.bySplit.holdout.falseRejectRate,null);
  first.response.checks=[];assert.equal(replayVerifier(cases,input).counts.invalid,1);
  first.inputHash='a'.repeat(64);assert.equal(replayVerifier(cases,input).results[0]?.code,'VERIFIER_INPUT_CHANGED');
  assert.throws(()=>replayVerifier(cases,{...input,casesHash:'b'.repeat(64)}),/VERIFIER_CASES_CHANGED/);
});
