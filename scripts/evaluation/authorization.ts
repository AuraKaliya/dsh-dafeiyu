import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { sha256 } from './catalog.ts';

export const RealAuthorizationSchema=z.strictObject({schemaVersion:z.literal(1),authorizationId:z.literal('7c-20261026-flash-max-60cny'),approvedOn:z.literal('2026-10-26'),approvedBy:z.literal('human-user-in-this-thread'),planCommit:z.literal('ff97a54'),provider:z.literal('deepseek-official'),model:z.literal('deepseek-flash'),reasoningEffort:z.literal('max'),endpoint:z.literal('https://api.deepseek.com/anthropic'),maximumMicroCny:z.literal(60000000),maximumActiveMs:z.literal(21600000),validForMsAfterFirstCall:z.literal(172800000),maximumOutputTokens:z.literal(16384),contextWindow:z.literal(1000000),requestTimeoutMs:z.literal(120000),streamIdleTimeoutMs:z.literal(45000),automaticTopup:z.literal(false),automaticBudgetIncrease:z.literal(false),realPlatformCallsAllowedIn7C:z.literal(false),serverAccessAllowedIn7C:z.literal(false),priceCheckedOn:z.literal('2026-10-26'),priceSource:z.literal('https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'),inputMicroCnyPerMillion:z.literal(2000000),outputMicroCnyPerMillion:z.literal(8000000)});
export type RealAuthorization=z.infer<typeof RealAuthorizationSchema>;
export function readRealAuthorization(repository:string){const bytes=readFileSync(resolve(repository,'evaluation/phase7c/authorization.json'));return {authorization:Object.freeze(RealAuthorizationSchema.parse(JSON.parse(bytes.toString()))),hash:sha256(bytes)};}
/** One durable namespace for this human authorization, including calibration and code-fix retries. */
export const authorizedCampaignPath=(repository:string)=>resolve(repository,'.runtime/acceptance/7c-20261026');
export const CALIBRATION_CASES=Object.freeze(['CAL-route','CAL-boundary','CAL-history-full','CAL-history-compressed','CAL-history-restarted']);
