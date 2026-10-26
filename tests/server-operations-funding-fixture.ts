import { mkdtemp,mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FundingAuthorizationSchema,FundingBindingSchema,FundingPriceSchema,fundingBytesHash,fundingHash,fundingPathIdentity } from '@dafeiyu/server-runtime';
import type { FundingAmendment,FundingBinding,FundingPrice,FundingClock,ModelBudgetRequest,ModelBudgetSettlement } from '@dafeiyu/server-runtime';
import type { ExecutorPermit,WindowsHostProof } from '@dafeiyu/server-executor';
import { testTempDir } from './test-temp.js';

export const fundingRoute={provider:'local-test',model:'scripted',reasoningEffort:null,contextWindow:1024,maxOutputTokens:100,maxRequestBytes:8000};
export const fundingUsage={inputTokens:12,uncachedInputTokens:3,cacheReadTokens:4,cacheWriteTokens:5,outputTokens:6,reasoningTokens:2};
export class FundingTestClock implements FundingClock {
  wall=Date.now();mono=100;
  now(){return this.wall;}monotonic(){return this.mono;}
}
export async function fundingFixture(options:{maximum?:number;rates?:Partial<Pick<FundingPrice,'uncachedInput'|'cacheRead'|'cacheWrite'|'output'>>;lifetime?:number}={}){
  const root=await mkdtemp(join(testTempDir(),'operations-funding-')),windowsRoot=join(root,'windows'),receiptsRoot=join(root,'receipts'),controls=join(root,'controls');
  await Promise.all([mkdir(windowsRoot),mkdir(receiptsRoot),mkdir(controls)]);const now=Date.now(),clock=new FundingTestClock();
  const price=FundingPriceSchema.parse({schemaVersion:1,currency:'CNY',provider:fundingRoute.provider,model:fundingRoute.model,routeHash:fundingHash(fundingRoute),algorithm:'weighted-sum-ceil-v1',denominator:1000000,
    uncachedInput:1000000,cacheRead:1000000,cacheWrite:1000000,output:2000000,...options.rates,source:{reference:'fictional-local-test-only',hash:'a'.repeat(64)},version:'fixture-1'});
  const priceBytes=JSON.stringify(price)+'\n',priceFile=join(controls,'price.json');await writeFile(priceFile,priceBytes);
  const fundingId='fixture-'+randomUUID(),authorization=FundingAuthorizationSchema.parse({schemaVersion:1,fundingId,profileId:'fixture',agentId:'dafeiyu',scopeHash:'b'.repeat(64),routeHash:fundingHash(fundingRoute),priceHash:fundingBytesHash(priceBytes),purpose:'synthetic-validation',currency:'CNY',maximumMicroCny:options.maximum??100000,
    notBefore:new Date(now-2000).toISOString(),expiresAt:new Date(now+(options.lifetime??120000)).toISOString(),approval:{kind:'synthetic-fixture',reference:'NO_REAL_MONEY_AUTHORIZED',hash:'c'.repeat(64),approvedAt:new Date(now-3000).toISOString()},unknownPolicy:'stop'});
  const authorizationFile=join(controls,'authorization.json'),authorizationBytes=JSON.stringify(authorization)+'\n';await writeFile(authorizationFile,authorizationBytes);
  const binding=FundingBindingSchema.parse({schemaVersion:1,fundingId,profileId:'fixture',agentId:'dafeiyu',scopeHash:'b'.repeat(64),windowsRoot:{path:windowsRoot,identity:fundingPathIdentity(windowsRoot,'directory')},receiptsRoot:{path:receiptsRoot,identity:fundingPathIdentity(receiptsRoot,'directory')},
    authorization:{path:authorizationFile,hash:fundingBytesHash(authorizationBytes)},price:{path:priceFile,hash:fundingBytesHash(priceBytes)},route:fundingRoute,process:{nodePath:process.execPath,nodeHash:'d'.repeat(64),expectedOwnerSid:'S-1-5-21-123-456-789-1001'}});
  const database=join(windowsRoot,fundingId,'operations-budget.sqlite'),claim=join(receiptsRoot,fundingId+'.initializing.json'),complete=join(receiptsRoot,fundingId+'.initialized.json');
  const proof=():WindowsHostProof=>({schemaVersion:1,observedAt:new Date(clock.wall).toISOString(),parent:{pid:process.pid,parentPid:process.ppid,creationId:'133000000000000000',creationTimeUtc:new Date(now-10000).toISOString(),executablePath:process.execPath,
    executableHash:binding.process.nodeHash,ownerSid:binding.process.expectedOwnerSid,elevated:true,administratorsEnabled:true,elevationType:2,restricted:false,alive:true},powershellHash:'e'.repeat(64),probeHash:'f'.repeat(64),scope:'current-machine-only'});
  const call=(jobId?:string):ModelBudgetRequest=>({authorizationId:fundingId,owner:jobId?{kind:'executor',jobId}:{kind:'host',profileId:'fixture'},callId:randomUUID(),provider:fundingRoute.provider,model:fundingRoute.model,reasoningEffort:null,
    inputBound:1024,outputBound:100,requestBytes:1000,requestHash:'e'.repeat(64),sessionHash:'f'.repeat(64),purpose:'task',deadline:clock.wall+10000});
  const bill=(call:ModelBudgetRequest,permit:ExecutorPermit):ModelBudgetSettlement=>({authorizationId:fundingId,owner:call.owner,callId:call.callId,reservationId:permit.reservationId,usage:fundingUsage,finish:'stop',durationMs:1,error:null});
  const amendment=async(previousHash:string,override:Partial<FundingAmendment>={})=>{
    const body:FundingAmendment={schemaVersion:1,kind:'increase',id:'amendment-'+randomUUID(),fundingId,initialAuthorizationHash:binding.authorization.hash,previousHash,scopeHash:binding.scopeHash,routeHash:fundingHash(binding.route),priceHash:binding.price.hash,
      expiresAt:authorization.expiresAt,additionalMicroCny:1000,purpose:'synthetic-validation',approval:authorization.approval,reason:'Finite synthetic fixture increment, no real money',...override};
    const path=join(controls,body.id+'.json'),bytes=JSON.stringify(body)+'\n';await writeFile(path,bytes);return {path,hash:fundingBytesHash(bytes),body};
  };
  return {root,binding,price,authorization,database,claim,complete,controls,clock,proof,call,bill,amendment};
}
export const synthetic={mode:'synthetic-validation' as const};
export const idleSignal=new AbortController().signal;
export function foreignBinding(binding:FundingBinding):FundingBinding{return {...binding,fundingId:'other-'+randomUUID()};}
