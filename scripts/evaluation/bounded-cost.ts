import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { sha256 } from './catalog.ts';
import type { EvaluationLedger } from './ledger.ts';

const amendmentSchema=z.strictObject({schemaVersion:z.literal(1),authorizationId:z.literal('7c-20261026-bounded-cost'),parentAuthorizationId:z.literal('7c-20261026-flash-max-60cny'),approvedBy:z.literal('human-user-in-this-thread'),policy:z.literal('full-reservation-permanent-charge-actual-fee-unknown'),scope:z.literal('current-and-subsequent-eligible-unknown-calls-in-this-campaign'),maximumMicroCny:z.literal(60000000),maximumActiveMs:z.literal(21600000),originalFirstCallAt:z.literal(1792959270580),originalExpiresAt:z.literal(1793132070580),automaticBudgetIncrease:z.literal(false),originalReservationId:z.literal('e79387b8-e750-4270-ae5d-fd5465545a81'),originalChargeMicroCny:z.literal(2131072)});
/** Applies only the approved campaign's upper bound, without changing original bill or clock. */
export function accountAuthorizedUnknown(repository:string,ledger:EvaluationLedger,reservationId:string){
  z.uuid().parse(reservationId);const bytes=readFileSync(join(repository,'evaluation/phase7c/bounded-cost-authorization.v1.json')),a=amendmentSchema.parse(JSON.parse(bytes.toString())),clock=ledger.executionStatus(),bounds=ledger.config.executionBounds;
  if(ledger.config.mode!=='real'||bounds?.authorizationId!==a.parentAuthorizationId||ledger.budget.maximum!==a.maximumMicroCny||bounds.maximumActiveMs!==a.maximumActiveMs||clock?.firstCallAt!==a.originalFirstCallAt||clock.expiresAt!==a.originalExpiresAt)throw new Error('EVALUATION_ACCOUNTING_AUTHORIZATION_MISMATCH');
  return ledger.accountUnknownAtMaximum({reservationId,chargeMicroCny:a.originalChargeMicroCny,actualFee:'unknown',authorizationId:a.authorizationId,authorizationHash:sha256(bytes)});
}
