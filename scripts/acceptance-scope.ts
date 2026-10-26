import { readFile,lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CandidateSchema } from './evaluation/real-support.ts';
import type { RealCandidate } from './evaluation/real-support.ts';
import { RuntimeIdentitySchema,runtimeIdentityHash } from './evaluation/identity.ts';
import type { RuntimeIdentity } from './evaluation/identity.ts';
import type { EvaluationCase } from './evaluation/catalog.ts';
import { sha256 } from './evaluation/catalog.ts';
import type { EvaluationWorkspace } from './evaluation/workspace.ts';
import { latestCandidateAttempt,requireRealCalibration } from './evaluation/real-candidate.ts';
import { cloneEvaluationProfile } from './evaluation/clone.ts';

const hash=z.string().regex(/^[a-f0-9]{64}$/),changedPath='scripts/evaluation/history-fixture.ts';
export const ScopeCertificateSchema=z.strictObject({schemaVersion:z.literal(1),from:CandidateSchema,toRuntimeHash:hash,protocolHash:hash,changedFile:z.strictObject({path:z.literal(changedPath),beforeHash:hash,afterHash:hash}),affectedSamples:z.tuple([z.literal('H01'),z.literal('H05')]),reviewer:z.literal('codex-under-user-delegated-autonomy'),reviewedAt:z.iso.datetime(),rationale:z.string().min(60).max(4000),checks:z.strictObject({relative:z.string().regex(/^docs\/results\/[a-z0-9-]+\.json$/),hash})});
export type ScopeCertificate=z.infer<typeof ScopeCertificateSchema>;
export interface ScopeCompatibility {certificate:ScopeCertificate;parentIdentity:RuntimeIdentity;certificateHash:string;checkReport:unknown;calibrationBasis:string}

/** Pins one reviewed fixture change. Product, dependencies, route, protocol and all other files must be byte-identical. */
export function validateScopeCertificate(raw:unknown,parent:RuntimeIdentity,current:RuntimeIdentity,candidate:RealCandidate){
  const c=ScopeCertificateSchema.parse(raw);if(runtimeIdentityHash(parent)!==c.from.runtimeHash||runtimeIdentityHash(current)!==c.toRuntimeHash||candidate.runtimeHash!==c.toRuntimeHash||candidate.protocolHash!==c.protocolHash||c.from.protocolHash!==c.protocolHash)throw new Error('EVALUATION_SCOPE_IDENTITY_CHANGED');
  const before=parent.files.find(f=>f.path===changedPath),after=current.files.find(f=>f.path===changedPath);if(!before||!after||before.hash!==c.changedFile.beforeHash||after.hash!==c.changedFile.afterHash||before.hash===after.hash)throw new Error('EVALUATION_SCOPE_PATCH_CHANGED');
  if(JSON.stringify({...parent,files:parent.files.filter(f=>f.path!==changedPath)})!==JSON.stringify({...current,files:current.files.filter(f=>f.path!==changedPath)}))throw new Error('EVALUATION_SCOPE_RUNTIME_CHANGED');return c;
}
export async function loadScopeCompatibility(repository:string,workspace:EvaluationWorkspace,candidate:RealCandidate,identity:RuntimeIdentity):Promise<ScopeCompatibility|null>{
  const path=join(repository,'evaluation/phase7c/scope-compatibility.v1.json');if(!existsSync(path))return null;const bytes=await readFile(path),c=ScopeCertificateSchema.parse(JSON.parse(bytes.toString()));
  const parentPath=`candidates/${sha256(JSON.stringify(c.from))}.json`;if((await lstat(join(workspace.root,parentPath))).isSymbolicLink())throw new Error('EVALUATION_LINK_DENIED');const parentBytes=await readFile(join(workspace.root,parentPath)),parent=z.object({candidate:CandidateSchema,identity:RuntimeIdentitySchema}).parse(JSON.parse((await workspace.read(parentPath,sha256(parentBytes))).toString()));if(JSON.stringify(parent.candidate)!==JSON.stringify(c.from))throw new Error('EVALUATION_SCOPE_PARENT_CHANGED');
  validateScopeCertificate(c,parent.identity,identity,candidate);const reportBytes=await readFile(join(repository,c.checks.relative));if(sha256(reportBytes)!==c.checks.hash)throw new Error('EVALUATION_SCOPE_CHECK_CHANGED');const checkReport:unknown=JSON.parse(reportBytes.toString());z.object({summary:z.object({success:z.literal(true),counts:z.object({tests:z.number().int().positive(),failed:z.literal(0)})}),realModel:z.literal(false),serverAccess:z.literal(false)}).parse(checkReport);
  const calibrationBasis=await requireRealCalibration(workspace,c.from);return {certificate:c,parentIdentity:parent.identity,certificateHash:sha256(bytes),checkReport,calibrationBasis};
}
export async function scopedPrior(workspace:EvaluationWorkspace,item:EvaluationCase,candidate:RealCandidate,scope:ScopeCompatibility|null){
  const current=await latestCandidateAttempt(workspace,item.id,candidate);if(current?.matches)return {prior:current,basisCandidate:candidate,reused:false};
  if(scope&&!scope.certificate.affectedSamples.some(id=>id===item.sampleId)){const parent=await latestCandidateAttempt(workspace,item.id,scope.certificate.from);if(parent?.matches)return {prior:parent,basisCandidate:scope.certificate.from,reused:true};}
  return {prior:current,basisCandidate:candidate,reused:false};
}

/** Admit unchanged prehistory into a new driver revision without regenerating or re-billing it. */
export async function admitCompatibleBaseline(workspace:EvaluationWorkspace,item:EvaluationCase,candidate:RealCandidate,scope:ScopeCompatibility|null){
  if(!scope||item.kind!=='continuity'||scope.certificate.affectedSamples.some(id=>id===item.sampleId))return null;
  const name=`${item.sampleId}-${item.repeat}.json`,source=`baselines/${sha256(JSON.stringify(scope.certificate.from)).slice(0,16)}/${name}`,target=`baselines/${sha256(JSON.stringify(candidate)).slice(0,16)}/${name}`;
  const admissionPath=`baseline-admissions/${sha256(target)}.json`;
  if(existsSync(join(workspace.root,target))){if(!existsSync(join(workspace.root,admissionPath)))return null;const bytes=await readFile(join(workspace.root,admissionPath)),proof=z.object({admitted:z.object({relative:z.string(),hash}),compatibilityHash:hash,admittedFor:CandidateSchema,preparedUnder:CandidateSchema}).parse(JSON.parse(bytes.toString()));if(proof.admitted.relative!==target||proof.compatibilityHash!==scope.certificateHash||JSON.stringify(proof.admittedFor)!==JSON.stringify(candidate)||JSON.stringify(proof.preparedUnder)!==JSON.stringify(scope.certificate.from))throw new Error('EVALUATION_BASELINE_ADMISSION_CHANGED');await workspace.read(target,proof.admitted.hash);return {relative:admissionPath,hash:sha256(bytes)};}
  if(existsSync(join(workspace.root,admissionPath)))throw new Error('EVALUATION_BASELINE_ADMISSION_INCOMPLETE');if(!existsSync(join(workspace.root,source)))return null;
  const report=workspace.ledger.report();let artifact:{relative:string;hash:string}|undefined;
  for(const attempt of report.attempts){const hit=attempt.result?.artifacts.find(a=>a.relative===source),declared=attempt.result?.artifacts.find(a=>a.relative===`cases/${attempt.attemptId}/case.json`);if(!hit||!declared)continue;const body=z.object({candidate:CandidateSchema,modelClass:z.literal('real')}).parse(JSON.parse((await workspace.read(declared.relative,declared.hash)).toString()));if(JSON.stringify(body.candidate)===JSON.stringify(scope.certificate.from)){artifact=hit;break;}}
  if(!artifact)throw new Error('EVALUATION_BASELINE_ORIGIN_UNPROVEN');
  const baseline=z.strictObject({taskId:z.uuid(),sessionId:z.string(),logicalHash:hash,sampleHash:hash,candidateHash:hash,root:z.string(),state:z.record(z.string(),z.json()),inputExposure:z.array(z.boolean())}).parse(JSON.parse((await workspace.read(artifact.relative,artifact.hash)).toString()));if(baseline.candidateHash!==sha256(JSON.stringify(scope.certificate.from))||!baseline.inputExposure.length||baseline.inputExposure.some(x=>!x))throw new Error('EVALUATION_BASELINE_ORIGIN_UNPROVEN');
  const copiedRoot=join(workspace.root,'b',randomUUID()),copied=await cloneEvaluationProfile(workspace.root,baseline.root,copiedRoot);if(copied.logicalHash!==baseline.logicalHash)throw new Error('EVALUATION_BASELINE_CHANGED');
  const admitted=await workspace.write(target,JSON.stringify({...baseline,candidateHash:sha256(JSON.stringify(candidate)),root:copiedRoot},null,2)+'\n');
  return workspace.write(admissionPath,JSON.stringify({schemaVersion:1,caseId:item.id,preparedUnder:scope.certificate.from,admittedFor:candidate,source:artifact,admitted,logicalHash:copied.logicalHash,clone:copied,compatibilityHash:scope.certificateHash,paidCalls:0},null,2)+'\n');
}
