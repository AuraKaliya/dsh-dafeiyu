import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { ExecutorChildBudgetClient,installExecutorChildBilling } from './child.js';
import { childIpcEndpoint } from './ipc.js';
import { headlessFileHash,loadPinnedHeadlessManifest } from './headless-manifest.js';
import { installHeadlessToolGuard } from './headless-tools.js';
import { assertPinnedCredentialDescription } from './headless-credentials.js';
import { assertHeadlessTextRequest } from './headless-input.js';

export const name='dafeiyu-executor-child-budget';
export const inject=['llm','tools','agents'];
async function bounded(operation:Promise<unknown>,ms:number):Promise<void>{let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('EXECUTOR_CHILD_DRAIN_TIMEOUT')),ms);})]);}finally{if(timer)clearTimeout(timer);}}
export async function apply(ctx:Context,raw:unknown):Promise<void>{
  const {manifestPath}=z.strictObject({manifestPath:z.string().min(1)}).parse(raw),pinned=await loadPinnedHeadlessManifest(manifestPath,headlessFileHash(manifestPath));
  if(pinned.manifest.modelCredential)await assertPinnedCredentialDescription(ctx.get('credentials'),pinned.manifest.modelCredential);
  const client=new ExecutorChildBudgetClient(childIpcEndpoint(),headlessFileHash(manifestPath));let stopping=false,active=0;const idle=new Set<()=>void>();
  const guard=()=>{if(stopping)throw new Error('EXECUTOR_CHILD_CLOSING');pinned.guard();};
  const cancel=()=>{for(const agent of ctx.agents.list())agent.cancel({kind:'parent'});};
  const billing=installExecutorChildBilling(ctx,client,cancel,assertHeadlessTextRequest),tools=installHeadlessToolGuard(ctx,client,pinned.allowedTools,guard);
  const stopCreated=ctx.on('agent/created',({agent})=>{guard();agent.ctx.tools.restrict({allow:[...pinned.allowedTools]});return undefined;},{global:true});
  const stopCounting=ctx.on('llm/stream',async function*(options,next){guard();active++;try{yield* next();}finally{active--;if(active===0){for(const done of idle)done();idle.clear();}}},{global:true,prepend:true});
  ctx.effect(()=>async()=>{
    stopping=true;
    try{if(!client.signal.aborted){if(active)await bounded(new Promise<void>(resolve=>idle.add(resolve)),2000);await bounded(client.finish(),2000);}}
    finally{cancel();client.close();stopCounting();stopCreated();tools();billing();}
  },'executor child accounting and IPC shutdown');
  // Official headless.run awaits loader completion before reading stdin. This async mount holds that barrier.
  await client.ready();pinned.guard();
}
