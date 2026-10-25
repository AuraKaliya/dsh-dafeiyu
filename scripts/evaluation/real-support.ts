import { join } from 'node:path';
import { mkdir,readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { EvaluationLedger,EvaluationConfigSchema } from './ledger.ts';
import type { EvaluationOutcome } from './ledger.ts';
import type { EvaluationWorkspace } from './workspace.ts';
import type { EvaluationCase } from './catalog.ts';
import { sha256 } from './catalog.ts';
import { captureCaseEvidence } from './evidence.ts';
import { sessionArchive } from './boundary.ts';

export const CandidateSchema=z.strictObject({codeRevision:z.string().regex(/^[a-f0-9]{40}$/),runtimeHash:z.string().length(64),protocolHash:z.string().length(64)});
export type RealCandidate=z.infer<typeof CandidateSchema>;
export interface RealDriverOptions {repository:string;candidate:RealCandidate;retry?:boolean;testBackend?:LlmAdapter}
export const stableEvaluationError=(error:unknown)=>error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'EVALUATION_CASE_FAILED';
function hasPrivatePayload(value:unknown):boolean{if(!value||typeof value!=='object')return false;if('replayState'in value&&value.replayState!=null||'reasoning_content'in value||'type'in value&&['reasoning','redacted-thinking'].includes(String(value.type)))return true;return Object.values(value).some(hasPrivatePayload);}
export class RealCaseRecord {
  readonly workspace:EvaluationWorkspace;readonly item:EvaluationCase;readonly attemptId:string;readonly base:string;readonly profile:string;readonly modelClass:'real'|'transport-test';
  readonly startedAt=Date.now();
  readonly checks:EvaluationOutcome['programChecks']=[];readonly artifacts:EvaluationOutcome['artifacts']=[];readonly evidence:Record<string,unknown>={};readonly turns:{prompt:string;answer:string}[]=[];error:string|null=null;
  private constructor(workspace:EvaluationWorkspace,item:EvaluationCase,attemptId:string,modelClass:'real'|'transport-test'){this.workspace=workspace;this.item=item;this.attemptId=attemptId;this.base=`cases/${attemptId}`;this.profile=join(workspace.root,this.base,'profile');this.modelClass=modelClass;}
  static async begin(workspace:EvaluationWorkspace,item:EvaluationCase,options:RealDriverOptions){if(workspace.config.mode!=='real')throw new Error('EVALUATION_REAL_WORKSPACE_REQUIRED');workspace.ledger.remainingExecutionMs();const candidate=CandidateSchema.parse(options.candidate),record=new RealCaseRecord(workspace,item,workspace.ledger.begin(item.id,{retry:options.retry??false}),options.testBackend?'transport-test':'real');record.artifacts.push(await workspace.write(record.base+'/case.json',JSON.stringify({case:item,candidate,modelClass:record.modelClass,calibration:item.id.startsWith('CAL-')},null,2)+'\n'));return record;}
  check(id:string,passed:boolean,evidence:unknown){this.evidence[id]=evidence;this.checks.push({id,passed,evidenceHash:sha256(JSON.stringify(evidence))});}
  fail(error:unknown){this.error??=stableEvaluationError(error);this.check('driver-completed',false,{error:this.error});}
  async finish(){
    this.check('answer-captured',this.turns.length>0&&this.turns.every(t=>t.answer.trim().length>0),{turns:this.turns.length,characters:this.turns.reduce((n,t)=>n+t.answer.length,0)});
    const calls=this.workspace.ledger.report().calls.filter(c=>c.attemptId===this.attemptId),started=calls.filter(c=>c.phase==='started'),finished=calls.filter(c=>c.phase==='finished');
    this.check('all-real-dispatches-accounted',started.length>0&&started.length===finished.length&&started.every(c=>c.reservationId!==null)&&finished.every(c=>c.error===null&&c.inputTokens!==null&&c.outputTokens!==null&&['stop','tool-calls'].includes(c.finish??'')),{started:started.length,finished:finished.length,errors:finished.filter(c=>c.error).map(c=>c.error)});
    try{const caseRoot=join(this.workspace.root,this.base),archive=await sessionArchive(caseRoot);this.check('private-model-payload-not-persisted',archive.split('\n').filter(Boolean).every(line=>!hasPrivatePayload(JSON.parse(line))),{visibleOnly:true});this.artifacts.push(await captureCaseEvidence(this.workspace,this.attemptId,caseRoot));}catch(error){this.error??=stableEvaluationError(error);this.check('closed-profile-evidence',false,{error:stableEvaluationError(error)});}
    const answer=this.turns.at(-1)?.answer??'';this.artifacts.push(await this.workspace.write(this.base+'/answer.json',JSON.stringify({reviewId:this.item.reviewId,answer,turns:this.turns,modelClass:this.modelClass,semanticAssessment:'not-performed'},null,2)+'\n'));
    this.artifacts.push(await this.workspace.write(this.base+'/program.json',JSON.stringify({caseId:this.item.id,attemptId:this.attemptId,modelClass:this.modelClass,checks:this.checks,evidence:this.evidence,error:this.error},null,2)+'\n'));
    const passed=this.checks.every(c=>c.passed),blocked=this.error!==null&&/BUDGET|TIME_EXHAUSTED|AUTHORIZATION_EXPIRED|UNKNOWN_COST|EXECUTION_NOT_STARTED/.test(this.error),outcome:EvaluationOutcome={state:passed?'needs-human-review':blocked?'blocked':'failed',code:this.error??(passed?'EVALUATION_REAL_REQUIRES_HUMAN_REVIEW':'EVALUATION_PROGRAM_CHECK_FAILED'),programChecks:this.checks,answerHash:sha256(answer),artifacts:this.artifacts};this.workspace.ledger.finish(this.attemptId,outcome);return {attemptId:this.attemptId,...outcome};
  }
}
export async function createPreparationLedger(workspace:EvaluationWorkspace,root:string){await mkdir(root,{recursive:true});const c=workspace.config,config=EvaluationConfigSchema.parse({schemaVersion:1,suiteId:'7c-fixture-preparation',suiteHash:c.suiteHash,manifestHash:c.manifestHash,foundationHash:c.foundationHash,codeRevision:c.codeRevision,mode:'offline',budget:{authorized:false,maximumMicroCny:0,expiresAt:'9999-12-31T23:59:59.999Z',pricingHash:sha256('no-paid-preparation'),inputMicroCnyPerMillion:0,outputMicroCnyPerMillion:0},cases:[{id:'fixture',reviewId:'fixture'}]}),ledger=new EvaluationLedger(join(root,'preparation.sqlite'),config,true);return {ledger,attemptId:ledger.begin('fixture')};}
export function finishPreparation(ledger:EvaluationLedger,attemptId:string){ledger.finish(attemptId,{state:'blocked',code:'EVALUATION_FIXTURE_ONLY',programChecks:[],answerHash:null,artifacts:[]});ledger.close();}
export async function checkFoundation(record:RealCaseRecord){const current=sha256((await readFile(join(record.workspace.root,'sources/persona.foundation.md'),'utf8')).trim());record.check('foundation-unchanged',current===record.workspace.config.foundationHash,{hash:current});}
