import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EvaluationLedger } from './ledger.ts';
import type { EvaluationCall } from './ledger.ts';
import type { ExecutionBudgetPort,ExecutionBudgetRequest } from '../../packages/server-executor/lib/budget.js';
import { ExecutorCallSchema,ExecutorRouteSchema,ExecutorSettlementSchema } from '../../packages/server-executor/lib/protocol.js';
import type { ExecutorPermit,ExecutorSettlement } from '../../packages/server-executor/lib/protocol.js';
import { ModelBudgetRequestSchema,ModelBudgetSettlementSchema } from '../../packages/server-runtime/lib/types.js';
import type { ModelBudgetAuthority,ModelBudgetRequest,ModelBudgetSettlement } from '../../packages/server-runtime/lib/types.js';

const identity=z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/);
const settlementInput=ExecutorSettlementSchema.safeExtend({authorizationId:identity,jobId:z.uuid()});
const requestInput=ExecutorCallSchema.safeExtend({authorizationId:identity,jobId:z.uuid(),deadline:z.number().int().positive().safe()});
interface RecordedCall {readonly start:EvaluationCall;settlement:string|null;unknown:boolean}

/** Uses the already owned campaign ledger and clock. It never creates an attempt, budget, lease or execution interval. */
export function evaluationExecutorBudget(options:{ledger:EvaluationLedger;attemptId:()=>string;authorizationId:string;jobId:string;route:unknown;guard:()=>void}):ExecutionBudgetPort {
  const {ledger,attemptId,guard}=options,authorizationId=identity.parse(options.authorizationId),jobId=z.uuid().parse(options.jobId),route=ExecutorRouteSchema.parse(options.route);
  if(ledger.config.mode!=='real'||!ledger.config.executionBounds)throw new Error('EVALUATION_EXECUTOR_CLOCK_REQUIRED');
  const expectedAuthorization=ledger.budgetAmendments()[0]?.authorizationId??ledger.config.executionBounds.authorizationId;
  if(authorizationId!==expectedAuthorization)throw new Error('EVALUATION_EXECUTOR_AUTHORIZATION_MISMATCH');
  const calls=new Map<string,RecordedCall>();
  const bind=(input:{authorizationId:string;jobId:string})=>{if(input.authorizationId!==authorizationId||input.jobId!==jobId)throw new Error('EVALUATION_EXECUTOR_BINDING_MISMATCH');};
  return {
    async reserve(raw:ExecutionBudgetRequest,signal:AbortSignal):Promise<ExecutorPermit>{
      const input=requestInput.parse(raw);bind(input);signal.throwIfAborted();guard();
      if(input.deadline<=Date.now())throw new Error('EVALUATION_EXECUTOR_DEADLINE');
      if(input.provider!==route.provider||input.model!==route.model||input.reasoningEffort!==route.reasoningEffort||input.inputBound!==route.contextWindow||input.outputBound>route.maxOutputTokens||input.requestBytes>route.maxRequestBytes)throw new Error('EVALUATION_ROUTE_CHANGED');
      if(calls.has(input.callId))throw new Error('EVALUATION_CALL_DUPLICATE');
      const parentAttempt=attemptId(),reservationId=ledger.reserve(parentAttempt,'call:'+input.callId,input.inputBound,input.outputBound),start:EvaluationCall={id:input.callId,attemptId:parentAttempt,phase:'started',
        provider:input.provider,model:input.model,purpose:input.purpose,requestHash:input.requestHash,sessionHash:input.sessionHash,at:new Date().toISOString(),durationMs:null,reservationId,
        inputTokens:null,outputTokens:null,finish:null,error:null,reasoningEffort:input.reasoningEffort,outputBound:input.outputBound};
      // If an evidence write fails after reservation, the original held amount remains for explicit recovery.
      ledger.recordCall(start);calls.set(input.callId,{start,settlement:null,unknown:false});
      return {reservationId,dispatchPermit:randomUUID()};
    },
    async settle(raw:ExecutorSettlement&{readonly authorizationId:string;readonly jobId:string},_signal:AbortSignal):Promise<{unknown:boolean}>{
      const input=settlementInput.parse(raw);bind(input);const record=calls.get(input.callId);
      if(!record||record.start.reservationId!==input.reservationId)throw new Error('EVALUATION_EXECUTOR_RESERVATION_MISMATCH');
      // A revoked task still owes accounting. Never require its live execution grant to record the final bill.
      const usage=['error','aborted','interrupted'].includes(input.finish)?null:input.usage,normalized={...input,usage},encoded=JSON.stringify(normalized);
      if(record.settlement!==null){if(record.settlement!==encoded)throw new Error('EVALUATION_COST_CONFLICT');return {unknown:record.unknown};}
      const result=ledger.settle(input.reservationId,usage?{inputTokens:usage.inputTokens,outputTokens:usage.outputTokens}:null);
      // This live port is the sole owner of its reservations. Missing transition evidence is not a known bill.
      if(!result)throw new Error('EVALUATION_EXECUTOR_SETTLEMENT_UNPROVEN');
      ledger.recordCall({...record.start,phase:'finished',at:new Date().toISOString(),durationMs:Math.max(0,Date.now()-Date.parse(record.start.at)),inputTokens:usage?.inputTokens??null,outputTokens:usage?.outputTokens??null,
        finish:input.finish,error:input.error,usageBreakdown:usage?{uncachedInputTokens:usage.uncachedInputTokens,cacheReadTokens:usage.cacheReadTokens,cacheWriteTokens:usage.cacheWriteTokens,outputTokens:usage.outputTokens,reasoningTokens:usage.reasoningTokens}:null});
      record.settlement=encoded;record.unknown=result.unknown;return {unknown:record.unknown};
    },
  };
}

/** Multi-job + parent authority for one SharedModelBudget. Borrow the coordinator's existing ledger/clock. */
export function evaluationModelBudgetAuthority(options:{ledger:EvaluationLedger;attemptId:()=>string;authorizationId:string;profileId:string;route:unknown;guard:()=>void}):ModelBudgetAuthority {
  const {ledger}=options,authorizationId=identity.parse(options.authorizationId),profileId=identity.parse(options.profileId),route=Object.freeze(ExecutorRouteSchema.parse(options.route));
  if(ledger.config.mode!=='real'||!ledger.config.executionBounds)throw new Error('EVALUATION_EXECUTOR_CLOCK_REQUIRED');
  const validateAuthorization=()=>{const expected=ledger.budgetAmendments()[0]?.authorizationId??ledger.config.executionBounds!.authorizationId;
    if(authorizationId!==expected)throw new Error('EVALUATION_EXECUTOR_AUTHORIZATION_MISMATCH');};
  validateAuthorization();
  // Existing call IDs are never reissued after re-opening this program adapter.
  const seen=new Set(ledger.report().calls.map(call=>call.id)),jobs=new Map<string,string>();
  const calls=new Map<string,RecordedCall&{owner:ModelBudgetRequest['owner']}>();
  const ownerKey=(owner:ModelBudgetRequest['owner'])=>owner.kind==='executor'?'executor:'+owner.jobId:'host:'+createHash('sha256').update(owner.profileId).digest('hex').slice(0,32);
  const bind=(owner:ModelBudgetRequest['owner'],actualAuthorization:string)=>{
    if(actualAuthorization!==authorizationId||owner.kind==='host'&&owner.profileId!==profileId)throw new Error('EVALUATION_EXECUTOR_BINDING_MISMATCH');
  };
  const remainingMs=()=>Math.min(ledger.remainingExecutionMs(),Date.parse(ledger.config.budget.expiresAt)-Date.now());
  const guard=()=>{
    validateAuthorization();options.guard();if(remainingMs()<=0)throw new Error('EVALUATION_BUDGET_EXPIRED');
    const state=ledger.budget;if(state.unknown)throw new Error('EVALUATION_UNKNOWN_COST');
    if(state.held)throw new Error('EVALUATION_REQUEST_INFLIGHT');if(!state.remaining)throw new Error('EVALUATION_BUDGET_EXHAUSTED');
  };
  return {
    kind:'acceptance',authorizationId,route,guard,remainingMs,
    async reserve(raw:ModelBudgetRequest,signal:AbortSignal):Promise<ExecutorPermit>{
      const input=ModelBudgetRequestSchema.parse(raw);bind(input.owner,input.authorizationId);signal.throwIfAborted();guard();
      if(input.deadline<=Date.now())throw new Error('EVALUATION_EXECUTOR_DEADLINE');
      if(input.provider!==route.provider||input.model!==route.model||input.reasoningEffort!==route.reasoningEffort||input.inputBound!==route.contextWindow||input.outputBound>route.maxOutputTokens||input.requestBytes>route.maxRequestBytes)throw new Error('EVALUATION_ROUTE_CHANGED');
      if(seen.has(input.callId))throw new Error('EVALUATION_CALL_DUPLICATE');
      // First actual reservation binds a job to its attempt; settlement never reads a mutable current-attempt getter.
      const current=options.attemptId();let attempt=current;
      if(input.owner.kind==='executor'){
        const prior=jobs.get(input.owner.jobId);if(prior&&prior!==current)throw new Error('EVALUATION_EXECUTOR_ATTEMPT_CHANGED');
        attempt=prior??current;
      }
      const reservationId=ledger.reserve(attempt,ownerKey(input.owner)+':'+input.callId,input.inputBound,input.outputBound);
      if(input.owner.kind==='executor')jobs.set(input.owner.jobId,attempt);seen.add(input.callId);
      const start:EvaluationCall={id:input.callId,attemptId:attempt,phase:'started',provider:input.provider,model:input.model,purpose:input.purpose,
        requestHash:input.requestHash,sessionHash:input.sessionHash,at:new Date().toISOString(),durationMs:null,reservationId,inputTokens:null,outputTokens:null,finish:null,error:null,reasoningEffort:input.reasoningEffort,outputBound:input.outputBound};
      // request_key durably includes the real job (or host profile hash); executor budget_links also retain the job/reservation edge.
      ledger.recordCall(start);calls.set(input.callId,{start,owner:input.owner,settlement:null,unknown:false});
      return {reservationId,dispatchPermit:randomUUID()};
    },
    async settle(raw:ModelBudgetSettlement):Promise<{unknown:boolean}>{
      const input=ModelBudgetSettlementSchema.parse(raw);bind(input.owner,input.authorizationId);const record=calls.get(input.callId);
      if(!record||record.start.reservationId!==input.reservationId||ownerKey(record.owner)!==ownerKey(input.owner))throw new Error('EVALUATION_EXECUTOR_RESERVATION_MISMATCH');
      const usage=['error','aborted','interrupted'].includes(input.finish)?null:input.usage,encoded=JSON.stringify({...input,usage});
      if(record.settlement!==null){if(record.settlement!==encoded)throw new Error('EVALUATION_COST_CONFLICT');return {unknown:record.unknown};}
      const result=ledger.settle(input.reservationId,usage?{inputTokens:usage.inputTokens,outputTokens:usage.outputTokens}:null);
      if(!result)throw new Error('EVALUATION_EXECUTOR_SETTLEMENT_UNPROVEN');
      ledger.recordCall({...record.start,phase:'finished',at:new Date().toISOString(),durationMs:Math.max(0,Date.now()-Date.parse(record.start.at)),inputTokens:usage?.inputTokens??null,outputTokens:usage?.outputTokens??null,
        finish:input.finish,error:input.error,usageBreakdown:usage?{uncachedInputTokens:usage.uncachedInputTokens,cacheReadTokens:usage.cacheReadTokens,cacheWriteTokens:usage.cacheWriteTokens,outputTokens:usage.outputTokens,reasoningTokens:usage.reasoningTokens}:null});
      record.settlement=encoded;record.unknown=result.unknown;return {unknown:record.unknown};
    },
  };
}
