import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { ExecutorRouteSchema,ExecutorUsageSchema } from '@dafeiyu/server-executor/protocol';
import { RuntimeIdentitySchema } from './types.js';

export const FundingHashSchema=z.string().regex(/^[a-f0-9]{64}$/);
export const FundingMicroCnySchema=z.number().int().nonnegative().safe();
export const FundingPurposeSchema=z.enum(['operations','synthetic-validation']);
export const FundingIdSchema=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/).refine(value=>!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(value),'Reserved directory name');
export type FundingMode=z.infer<typeof FundingPurposeSchema>;
export const FundingPathSchema=z.string().min(1).max(2000).refine(value=>isAbsolute(value)&&!/^[/\\]{2}/.test(value)&&!value.split(/[/\\]/).some(part=>part==='..'||part==='.'),'An absolute local path is required');
const file=z.strictObject({path:FundingPathSchema,hash:FundingHashSchema});
const directory=z.strictObject({path:FundingPathSchema,identity:FundingHashSchema});
export const FundingApprovalSchema=z.strictObject({kind:z.enum(['human-operator','synthetic-fixture']),reference:z.string().trim().min(1).max(500),hash:FundingHashSchema,approvedAt:z.iso.datetime()});
/** Stable profile/agent/persistent-resource scope. Release configuration and code pins are checked by the fixed launcher. */
export const FundingBindingSchema=z.strictObject({schemaVersion:z.literal(1),fundingId:FundingIdSchema,profileId:RuntimeIdentitySchema,agentId:RuntimeIdentitySchema,scopeHash:FundingHashSchema,
  windowsRoot:directory,receiptsRoot:directory,authorization:file,price:file,route:ExecutorRouteSchema,
  process:z.strictObject({nodePath:FundingPathSchema,nodeHash:FundingHashSchema,expectedOwnerSid:z.string().regex(/^S-1-\d+(?:-\d+)+$/)})});
export type FundingBinding=z.infer<typeof FundingBindingSchema>;
export const FundingAuthorizationSchema=z.strictObject({schemaVersion:z.literal(1),fundingId:FundingIdSchema,profileId:RuntimeIdentitySchema,agentId:RuntimeIdentitySchema,scopeHash:FundingHashSchema,
  routeHash:FundingHashSchema,priceHash:FundingHashSchema,purpose:FundingPurposeSchema,currency:z.literal('CNY'),maximumMicroCny:FundingMicroCnySchema.positive(),
  notBefore:z.iso.datetime(),expiresAt:z.iso.datetime(),approval:FundingApprovalSchema,unknownPolicy:z.literal('stop')})
  .refine(value=>Date.parse(value.notBefore)<Date.parse(value.expiresAt)&&Date.parse(value.approval.approvedAt)<=Date.parse(value.expiresAt),'Invalid authorization interval');
export type FundingAuthorization=z.infer<typeof FundingAuthorizationSchema>;
export const FundingPriceSchema=z.strictObject({schemaVersion:z.literal(1),currency:z.literal('CNY'),provider:z.string().min(1).max(100),model:z.string().min(1).max(160),routeHash:FundingHashSchema,
  algorithm:z.literal('weighted-sum-ceil-v1'),denominator:z.literal(1000000),uncachedInput:FundingMicroCnySchema.positive(),cacheRead:FundingMicroCnySchema,cacheWrite:FundingMicroCnySchema,output:FundingMicroCnySchema.positive(),
  source:z.strictObject({reference:z.string().trim().min(1).max(500),hash:FundingHashSchema}),version:z.string().min(1).max(100)});
export type FundingPrice=z.infer<typeof FundingPriceSchema>;
export const FundingAmendmentSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('increase'),id:RuntimeIdentitySchema,fundingId:FundingIdSchema,initialAuthorizationHash:FundingHashSchema,
  previousHash:FundingHashSchema,scopeHash:FundingHashSchema,routeHash:FundingHashSchema,priceHash:FundingHashSchema,expiresAt:z.iso.datetime(),additionalMicroCny:FundingMicroCnySchema.positive(),
  purpose:FundingPurposeSchema,approval:FundingApprovalSchema,reason:z.string().trim().min(1).max(1000)});
export type FundingAmendment=z.infer<typeof FundingAmendmentSchema>;

function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([left],[right])=>left<right?-1:left>right?1:0).map(([key,part])=>[key,canonical(part)]));
  return value;
}
export const fundingHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const fundingBytesHash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
export function fundingFreeze<T>(value:T):T {if(value&&typeof value==='object'){for(const part of Object.values(value))fundingFreeze(part);Object.freeze(value);}return value;}
export function fundingCheck(value:unknown,code:string):asserts value {if(!value)throw new Error(code);}
export function checkFundingPurpose(purpose:FundingMode,approval:z.infer<typeof FundingApprovalSchema>,mode:FundingMode):void {
  fundingCheck(purpose===mode&&approval.kind===(mode==='operations'?'human-operator':'synthetic-fixture'),'FUNDING_PURPOSE_DENIED');
}
const ceil=(value:bigint)=>(value+999999n)/1000000n;
/** Exact integer micro-CNY; reasoning is already included in output. */
export function fundingUsageCost(price:FundingPrice,raw:z.infer<typeof ExecutorUsageSchema>):bigint {
  const usage=ExecutorUsageSchema.parse(raw);
  return ceil(BigInt(usage.uncachedInputTokens)*BigInt(price.uncachedInput)+BigInt(usage.cacheReadTokens)*BigInt(price.cacheRead)+BigInt(usage.cacheWriteTokens)*BigInt(price.cacheWrite)+BigInt(usage.outputTokens)*BigInt(price.output));
}
export function fundingBoundCost(price:FundingPrice,input:number,output:number):bigint {
  FundingMicroCnySchema.positive().parse(input);FundingMicroCnySchema.positive().parse(output);
  return ceil(BigInt(input)*BigInt(Math.max(price.uncachedInput,price.cacheRead,price.cacheWrite))+BigInt(output)*BigInt(price.output));
}
