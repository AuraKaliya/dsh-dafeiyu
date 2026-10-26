import { z } from 'zod';
import { ExecutorCallSchema,ExecutorSettlementSchema } from '@dafeiyu/server-executor/protocol';
import type { ExecutorPermit,ExecutorRoute } from '@dafeiyu/server-executor/protocol';

export const RuntimeIdentitySchema=z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/);
export const ModelCallOwnerSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('host'),profileId:RuntimeIdentitySchema}),
  z.strictObject({kind:z.literal('executor'),jobId:z.uuid()}),
]);
export type ModelCallOwner=z.infer<typeof ModelCallOwnerSchema>;
export const ModelBudgetRequestSchema=ExecutorCallSchema.safeExtend({authorizationId:RuntimeIdentitySchema,owner:ModelCallOwnerSchema,deadline:z.number().int().positive().safe()});
export type ModelBudgetRequest=z.infer<typeof ModelBudgetRequestSchema>;
export const ModelBudgetSettlementSchema=ExecutorSettlementSchema.safeExtend({authorizationId:RuntimeIdentitySchema,owner:ModelCallOwnerSchema});
export type ModelBudgetSettlement=z.infer<typeof ModelBudgetSettlementSchema>;

/** Borrowed program capability. Implementations own the existing durable money/clock authority. */
export interface ModelBudgetAuthority {
  readonly kind:'acceptance'|'operations'|'offline-test';
  readonly authorizationId:string;
  readonly route:ExecutorRoute;
  /** Revalidate the original authorization and unresolved reservations, without starting a clock. */
  guard():void;
  remainingMs():number;
  /** Optional durable authority stop source, including an idle window's deadline. Never a second clock. */
  onStop?(listener:(code:string)=>void):()=>void;
  reserve(input:ModelBudgetRequest,signal:AbortSignal):Promise<ExecutorPermit>;
  /** Must accept accounting after execution cancellation or revocation. */
  settle(input:ModelBudgetSettlement):Promise<{unknown:boolean}>;
}

export interface RuntimeCallRecord {
  readonly request:ModelBudgetRequest;
  readonly permit:ExecutorPermit;
  readonly state:'reserved'|'settled'|'unknown';
  readonly settlement:ModelBudgetSettlement|null;
}

export function runtimeCode(error:unknown,fallback='RUNTIME_BUDGET_FAILED'):string {
  return error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:fallback;
}
