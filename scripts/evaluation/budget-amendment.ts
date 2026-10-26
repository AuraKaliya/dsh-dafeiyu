import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { BudgetAmendmentSchema } from './ledger.ts';
import type { EvaluationLedger } from './ledger.ts';
import { readRealAuthorization } from './authorization.ts';
import { sha256 } from './catalog.ts';

export const BudgetAmendmentAuthorizationSchema=BudgetAmendmentSchema.omit({authorizationHash:true}).extend({
  authorizationId:z.literal('7c-20261026-remaining-50cny'),parentAuthorizationId:z.literal('7c-20261026-flash-max-60cny'),
  parentAuthorizationHash:z.literal('e607d277309e59e514cc2f8ae57d5fb60cd54894111858d019551f124a70f065'),approvedOn:z.literal('2026-10-26'),campaignId:z.literal('7c-20261026'),
  originalMaximumMicroCny:z.literal(60000000),remainingAuthorizedMicroCny:z.literal(50000000),effectiveMaximumMicroCny:z.literal(97894922),increaseMicroCny:z.literal(37894922),
  maximumActiveMs:z.literal(21600000),validForMsAfterFirstCall:z.literal(172800000),
  baseline:z.strictObject({spent:z.literal(47894922),usageBasedSpent:z.literal(28715274),accountedAtMaximum:z.literal(19179648),actualCostUnknown:z.literal(9),held:z.literal(0),unknown:z.literal(0),
    phaseUsed:z.strictObject({calibration:z.literal(23343152),formal:z.literal(15875920),retest:z.literal(8675850)}),firstCallAt:z.literal(1792959270580),expiresAt:z.literal(1793132070580),activeMs:z.literal(7438303),calibrationMs:z.literal(3082731)}),
  phaseAllocation:z.strictObject({calibration:z.literal(33343152),formal:z.literal(45875920),retest:z.literal(18675850)}),
});

export function readBudgetAmendmentAuthorization(repository:string){const bytes=readFileSync(resolve(repository,'evaluation/phase7c/budget-amendment.v1.json'));
  return {authorization:BudgetAmendmentAuthorizationSchema.parse(JSON.parse(bytes.toString())),hash:sha256(bytes)};
}
function authorizedDecision(repository:string,ledger:EvaluationLedger){const {authorization,hash}=readBudgetAmendmentAuthorization(repository),original=readRealAuthorization(repository);
  if(original.hash!==authorization.parentAuthorizationHash||ledger.config.mode!=='real'||ledger.config.executionBounds?.authorizationHash!==original.hash||ledger.config.executionBounds.authorizationId!==original.authorization.authorizationId||ledger.config.budget.maximumMicroCny!==original.authorization.maximumMicroCny)throw new Error('EVALUATION_BUDGET_AMENDMENT_AUTHORIZATION_MISMATCH');
  return BudgetAmendmentSchema.parse({...authorization,authorizationHash:hash});
}
/** An authorization file alone grants no increase; only the exact persisted amendment may change the ceiling. */
export function validateAppliedBudgetAuthorization(repository:string,ledger:EvaluationLedger){const applied=ledger.budgetAmendments()[0];if(!applied)return null;
  const expected=authorizedDecision(repository,ledger),clock=ledger.executionStatus();
  if(JSON.stringify(applied)!==JSON.stringify(expected)||!clock||clock.firstCallAt!==applied.baseline.firstCallAt||clock.expiresAt!==applied.baseline.expiresAt||clock.activeMs<applied.baseline.activeMs||clock.calibrationMs<applied.baseline.calibrationMs)throw new Error('EVALUATION_BUDGET_AMENDMENT_AUTHORIZATION_MISMATCH');return applied;
}
/** Operator-only mutation. The caller owns the campaign lease; this never starts execution or a model. */
export function applyAuthorizedBudgetAmendment(repository:string,ledger:EvaluationLedger){validateAppliedBudgetAuthorization(repository,ledger);return ledger.applyBudgetAmendment(authorizedDecision(repository,ledger));}

/** Parse CNY directly into integer micro-CNY without floating-point rounding or truncation. */
export function parseMicroCny(value:string){if(!/^(0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(value))throw new Error('EVALUATION_ALLOCATION_INVALID');
  const [whole='0',fraction='']=value.split('.'),micro=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));if(micro>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('EVALUATION_ALLOCATION_INVALID');return Number(micro);
}
