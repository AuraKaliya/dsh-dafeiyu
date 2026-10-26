import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EvaluationLedger } from './ledger.ts';
import type { EvaluationCall } from './ledger.ts';
import type { ExecutionBudgetPort,ExecutionBudgetRequest } from '../../packages/server-executor/lib/budget.js';
import { ExecutorCallSchema,ExecutorRouteSchema,ExecutorSettlementSchema } from '../../packages/server-executor/lib/protocol.js';
import type { ExecutorPermit,ExecutorSettlement } from '../../packages/server-executor/lib/protocol.js';

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
