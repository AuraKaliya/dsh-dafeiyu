import { resolve } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@dafeiyu/channel-qq';
import type { HostRuntimeOptions,PreparedHostConfig } from '@dafeiyu/host';
import type { WindowsProcessControlOptions,WindowsHostProof } from '@dafeiyu/server-executor/windows-process';
import { ExecutorRouteSchema } from '@dafeiyu/server-executor/protocol';
import type { ModelBudgetAuthority } from './types.js';
import { SharedModelBudget } from './shared-budget.js';
import { installParentModelAdmission,validateParentModelAdmission } from './model-admission.js';
import { RuntimeResourceLifetime } from './lifecycle.js';

export interface ProductionRuntimeOptions {
  readonly authority:ModelBudgetAuthority;
  readonly windows:WindowsProcessControlOptions;
  readonly maximumCallMs:number;
  readonly drainTimeoutMs:number;
}
export interface ProductionRuntimeResources {
  readonly budget:SharedModelBudget;
  readonly parentProof:WindowsHostProof;
  readonly hostOptions:Pick<HostRuntimeOptions,'installModelAdmission'|'serverExecutorDependencies'>;
  /** Pass the live Host, or call after a failed start has disposed its context. */
  close(host?:{close(reason?:string):Promise<void>}):Promise<void>;
}

/** Uses current services even during Host.start(), before an outer host variable exists. */
export function cancelManagedModelWork(ctx:Context,code:string):void {
  const actions=[
    ()=>{if(ctx.get('dafeiyu'))ctx.dafeiyu.quiesce();},
    ()=>{if(ctx.get('dafeiyuQQ'))ctx.dafeiyuQQ.quiesce();},
    // Stop ingress without cancelling a send which may already have reached the platform.
    // Host's normal drain/timeout path retains the delivery's actual receipt or unknown state.
    ()=>{if(ctx.get('dafeiyuBiliOwner'))ctx.dafeiyuBiliOwner.quiesce();},
    ()=>{if(ctx.get('dafeiyuActivity'))ctx.dafeiyuActivity.stopBackground();},
    ()=>{if(ctx.get('dafeiyuMemory'))ctx.dafeiyuMemory.stopBackground();},
    ()=>{if(ctx.get('dafeiyu'))ctx.dafeiyu.cancelRunning();},
    ()=>{if(ctx.get('dafeiyuMemory'))ctx.dafeiyuMemory.cancelRunning();},
    ()=>{if(ctx.get('dafeiyuMedia'))ctx.dafeiyuMedia.cancelRunning();},
    ()=>{if(ctx.get('dafeiyuBilibili'))ctx.dafeiyuBilibili.cancelRunning();},
    ()=>{if(ctx.get('dafeiyuServerExecutor'))ctx.dafeiyuServerExecutor.cancelRunning();},
    ()=>{if(ctx.get('agents'))for(const agent of ctx.agents.list())agent.cancel({kind:'hook',reason:code});},
  ];
  for(const action of actions){try{action();}catch{/* One closing service must not prevent cancelling the other actual controllers. */}}
}

/** Explicit start/run operation only. Import/inspect/init never call this OS factory. */
export async function createProductionRuntime(config:PreparedHostConfig,options:ProductionRuntimeOptions):Promise<ProductionRuntimeResources> {
  if(options.authority.kind==='offline-test'||config.config.persona.kind==='test')throw new Error('RUNTIME_PRODUCTION_AUTHORITY_REQUIRED');
  const expectedHome=resolve(config.paths.core,'dsh-home');
  if(!process.env.DSH_HOME||resolve(process.env.DSH_HOME)!==expectedHome)throw new Error('RUNTIME_DSH_HOME_NOT_BOUND');
  // Host's own module captures DSH_HOME; import it only after the fixed thin launcher has bound that home.
  const {pluginConfig,loadHostConfig}=await import('@dafeiyu/host');
  const settings=pluginConfig(config,'server-executor'),model=pluginConfig(config,'model-deepseek');
  if(!settings||!model)throw new Error('RUNTIME_PRODUCTION_PROFILE_REQUIRED');
  const budget=new SharedModelBudget(options.authority),route=config.config.modelRoutes.chat;
  if(settings.budgetAuthorizationId!==budget.authorizationId||route.provider!==budget.route.provider||route.model!==budget.route.model||(route.reasoningEffort??null)!==budget.route.reasoningEffort||JSON.stringify(ExecutorRouteSchema.parse(settings.route))!==JSON.stringify(budget.route))throw new Error('RUNTIME_PROFILE_BUDGET_MISMATCH');
  if(resolve(settings.command.nodePath).toLowerCase()!==resolve(options.windows.nodePath).toLowerCase()||settings.command.nodeHash!==options.windows.nodeHash)throw new Error('RUNTIME_PROCESS_PROGRAM_MISMATCH');
  if(!Number.isSafeInteger(options.maximumCallMs)||options.maximumCallMs<1||options.maximumCallMs>3600000||!Number.isSafeInteger(options.drainTimeoutMs)||options.drainTimeoutMs<1||options.drainTimeoutMs>3600000)throw new Error('RUNTIME_TIMEOUT_INVALID');
  const guard=()=>{if(loadHostConfig(config.file).hash!==config.hash)throw new Error('RUNTIME_CONFIG_CHANGED');};guard();budget.assertReady();
  const {WindowsProcessControl}=await import('@dafeiyu/server-executor/windows-process');
  const processControl=await WindowsProcessControl.create(options.windows);
  let mounted=false,disposed=true;
  const lifetime=new RuntimeResourceLifetime({budget,closeProof:()=>processControl.close(),isHostDisposed:()=>disposed,timeoutMs:options.drainTimeoutMs});
  const hostOptions:ProductionRuntimeResources['hostOptions']={
    serverExecutorDependencies:{budget:budget.executorPort(),processControl},
    installModelAdmission:async(ctx,actual)=>{
      if(mounted||actual!==config||actual.hash!==config.hash)throw new Error('RUNTIME_HOST_BINDING_MISMATCH');
      mounted=true;disposed=false;ctx.effect(()=>()=>{disposed=true;},'dafeiyu.server-runtime.host-lifetime');
      await validateParentModelAdmission(ctx,budget);
      installParentModelAdmission(ctx,budget,{profileId:config.config.profileId,maximumCallMs:options.maximumCallMs,guard,cancelActive:code=>cancelManagedModelWork(ctx,code)});
    },
  };
  return {budget,parentProof:processControl.parentEvidence(),hostOptions:Object.freeze(hostOptions),close:host=>lifetime.close(host)};
}
