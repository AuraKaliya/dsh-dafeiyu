import { existsSync } from 'node:fs';
import { readdir,readFile,lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { sha256 } from './catalog.ts';
import type { EvaluationWorkspace } from './workspace.ts';
import { RuntimeIdentitySchema,runtimeIdentityHash } from './identity.ts';
import type { RuntimeIdentity } from './identity.ts';
import { CandidateSchema } from './real-support.ts';
import { REAL_COMPACTION,REAL_HISTORY_GOAL,REAL_H06_COMPACTION } from './real-continuity.ts';
import { CALIBRATION_CASES } from './authorization.ts';
import { verifyCaseEvidence } from './evidence.ts';
import { PERSONA_ADOPTION_POLICY_VERSION } from '../../packages/memory/lib/persona-adoption-policy.js';
import { PERSONA_ADOPTION_POLICY } from '../../packages/memory/lib/persona-evidence.js';
import { B05_PROTOCOL,B05_MATERIAL } from './b05.ts';

const candidateFileSchema=z.strictObject({schemaVersion:z.literal(1),candidate:CandidateSchema,identity:RuntimeIdentitySchema,createdAt:z.iso.datetime()});
/** Semantic protocol identity is separate from runtime bytes and never upgrades old evidence. */
export function realProtocolDescriptor(workspace:EvaluationWorkspace){return {
  version:'7c-real-2',suite:workspace.config.suiteHash,manifest:workspace.config.manifestHash,foundation:workspace.config.foundationHash,authorization:workspace.config.executionBounds?.authorizationHash,
  compaction:{...REAL_COMPACTION},h06:{...REAL_H06_COMPACTION},historyGoal:REAL_HISTORY_GOAL,continuations:8,restartAfter:4,scriptedDuplicates:false,preparation:'separate-epoch-fixture-ledger',
  adoptionPolicy:PERSONA_ADOPTION_POLICY_VERSION,trialProtocol:PERSONA_ADOPTION_POLICY,personaProof:'closed-native-chain-v1',legacyFixture:'closed-profile-synthetic-legacy-v1',
  b07:'current-task-epoch-unresolved-target-v1',b05:{protocol:B05_PROTOCOL,materialHash:sha256(B05_MATERIAL)},
} as const;}
export function realProtocolHash(workspace:EvaluationWorkspace){return sha256(JSON.stringify(realProtocolDescriptor(workspace)));}
/** Documentation-only commits reuse the same candidate and paired baselines when actual runtime/source bytes match. */
export async function freezeRealCandidate(workspace:EvaluationWorkspace,revision:string,identity:RuntimeIdentity){
  if(identity.scope!=='real-evaluation-runtime-v1')throw new Error('EVALUATION_REAL_IDENTITY_REQUIRED');const runtimeHash=runtimeIdentityHash(identity),protocolHash=realProtocolHash(workspace),directory=join(workspace.root,'candidates');
  if(existsSync(directory)){if((await lstat(directory)).isSymbolicLink())throw new Error('EVALUATION_LINK_DENIED');for(const entry of await readdir(directory)){if(!/^[a-f0-9]{64}\.json$/.test(entry))throw new Error('EVALUATION_CANDIDATE_FILE_INVALID');const relative='candidates/'+entry;if((await lstat(join(workspace.root,relative))).isSymbolicLink())throw new Error('EVALUATION_LINK_DENIED');const bytes=await readFile(join(workspace.root,relative)),hash=sha256(bytes),saved=candidateFileSchema.parse(JSON.parse((await workspace.read(relative,hash)).toString()));if(runtimeIdentityHash(saved.identity)!==saved.candidate.runtimeHash||entry!==sha256(JSON.stringify(saved.candidate))+'.json')throw new Error('EVALUATION_CANDIDATE_CHANGED');if(saved.candidate.runtimeHash===runtimeHash&&saved.candidate.protocolHash===protocolHash)return {candidate:saved.candidate,artifact:{relative,hash}};}}
  const candidate=CandidateSchema.parse({codeRevision:revision,runtimeHash,protocolHash}),artifact=await workspace.write('candidates/'+sha256(JSON.stringify(candidate))+'.json',JSON.stringify({schemaVersion:1,candidate,identity,createdAt:new Date().toISOString()},null,2)+'\n');return {candidate,artifact};
}
export async function latestCandidateAttempt(workspace:EvaluationWorkspace,caseId:string,candidate:z.infer<typeof CandidateSchema>){const attempt=workspace.ledger.report().attempts.findLast(a=>a.caseId===caseId);if(!attempt)return null;const artifact=attempt.result?.artifacts.find(a=>a.relative===`cases/${attempt.attemptId}/case.json`);if(!artifact)return {attempt,matches:false};const declared=z.object({candidate:CandidateSchema,modelClass:z.enum(['real','transport-test'])}).parse(JSON.parse((await workspace.read(artifact.relative,artifact.hash)).toString()));return {attempt,matches:declared.modelClass==='real'&&JSON.stringify(declared.candidate)===JSON.stringify(candidate)};}
export async function requireRealCalibration(workspace:EvaluationWorkspace,candidate:z.infer<typeof CandidateSchema>){
  const attempts:string[]=[];for(const id of CALIBRATION_CASES){const latest=await latestCandidateAttempt(workspace,id,candidate);if(!latest?.matches||latest.attempt.state!=='needs-human-review')throw new Error('EVALUATION_CALIBRATION_REQUIRED');const profile=latest.attempt.result?.artifacts.find(a=>a.relative===`cases/${latest.attempt.attemptId}/profile.json`);if(!profile||!latest.attempt.result?.programChecks.some(c=>c.id==='all-real-dispatches-accounted'&&c.passed))throw new Error('EVALUATION_CALIBRATION_REQUIRED');await verifyCaseEvidence(workspace,latest.attempt.attemptId,profile);attempts.push(latest.attempt.attemptId);}
  const marker=`calibrated/${sha256(JSON.stringify(candidate))}/${sha256(JSON.stringify(attempts))}.json`,path=join(workspace.root,marker);if(!existsSync(path))throw new Error('EVALUATION_CALIBRATION_REQUIRED');if((await lstat(path)).isSymbolicLink())throw new Error('EVALUATION_LINK_DENIED');const raw=await readFile(path),body=z.object({candidate:CandidateSchema,attempts:z.array(z.uuid()).length(CALIBRATION_CASES.length)}).parse(JSON.parse((await workspace.read(marker,sha256(raw))).toString()));if(JSON.stringify(body.candidate)!==JSON.stringify(candidate)||JSON.stringify(body.attempts)!==JSON.stringify(attempts))throw new Error('EVALUATION_CANDIDATE_CHANGED');if(workspace.ledger.budget.unknown)throw new Error('EVALUATION_UNKNOWN_COST');return marker;
}
