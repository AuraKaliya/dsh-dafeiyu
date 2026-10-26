import { readFileSync,statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ExecutionRequestSchema } from '@dafeiyu/contracts';
import { ManagedHost,inspectHost,readHostStatus } from '@dafeiyu/host';
import { createBiliOwnerProductionPorts } from '@dafeiyu/channel-bili-owner';
import { loadServerLaunchEnvelope,prepareServerLaunch } from './launch-config.js';
import { createProductionRuntime } from './production.js';
import type { ProductionRuntimeResources } from './production.js';
import { runtimeCheck,runtimeDigest,runtimePathIdentity } from './runtime-files.js';
import { runtimeCode } from './types.js';
import type { ModelBudgetAuthority } from './types.js';
import { ServerRuntimeStatusWriter,readServerRuntimeStatus,projectServerRuntimeHost,projectServerRuntimeParentProof } from './launch-state.js';
import type { ServerRuntimeStop } from './launch-state.js';

export interface ServerCommand {readonly mode:'inspect'|'status'|'start'|'run';readonly manifest:string;readonly request?:string}
export function parseServerCommand(args:readonly string[]):ServerCommand {
  const mode=args[0];if(mode!=='inspect'&&mode!=='status'&&mode!=='start'&&mode!=='run')throw new Error('RUNTIME_ARGUMENT_INVALID');
  const allowed=new Set(['--manifest',...(mode==='run'?['--request']:[])]),values=new Map<string,string>();
  for(let at=1;at<args.length;at+=2){const key=args[at]!,value=args[at+1];if(!allowed.has(key)||!value||value.startsWith('-')||values.has(key))throw new Error('RUNTIME_ARGUMENT_INVALID');values.set(key,value);}
  if([...allowed].some(key=>!values.has(key)))throw new Error('RUNTIME_ARGUMENT_MISSING');
  return {mode,manifest:resolve(values.get('--manifest')!),...(values.has('--request')?{request:resolve(values.get('--request')!)}:{})};
}
function readRequest(file:string){
  try{const identity=runtimePathIdentity(file,'file');if(statSync(file).size>131072)throw new Error();const bytes=readFileSync(file);
    runtimeCheck(runtimePathIdentity(file,'file')===identity,'RUNTIME_REQUEST_CHANGED');return ExecutionRequestSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  }catch{throw new Error('RUNTIME_REQUEST_INVALID');}
}
export function classifyServerRuntimeStop(code:string):ServerRuntimeStop {
  if(code==='RUNTIME_USAGE_UNKNOWN'||code==='RUNTIME_RESERVATION_UNCERTAIN')return {kind:'accounting-stop',code,reason:'unknown-cost'};
  if(code==='RUNTIME_AUTHORIZATION_EXPIRED')return {kind:'accounting-stop',code,reason:'expired'};
  return {kind:['RUNTIME_PROCESS_SIGNAL','RUNTIME_COMMAND_ENDED'].includes(code)?'requested':'runtime-failure',code};
}
/** Start/run borrow a trusted port. JSON cannot create money or load an authority module. */
export async function runServerCommand(command:ServerCommand,write:(value:unknown)=>void=console.log,authority?:ModelBudgetAuthority):Promise<number>{
  if((command.mode==='start'||command.mode==='run')&&!authority)throw new Error('RUNTIME_ACCOUNTING_PORT_REQUIRED');
  const request=command.mode==='run'?readRequest(command.request!):undefined;
  const prepared=await prepareServerLaunch(loadServerLaunchEnvelope(command.manifest)),{host:config,envelope}=prepared,manifest=envelope.manifest;
  const identity={profileId:config.config.profileId,agentId:config.config.agent.id,accountingId:manifest.accounting.id,manifestHash:envelope.hash,configHash:config.hash};
  if(command.mode==='inspect'||command.mode==='status'){
    const host=command.mode==='inspect'?inspectHost(config,manifest.coordination.path):readHostStatus(config,manifest.coordination.path);
    const runtime=readServerRuntimeStatus(config.paths.core,identity,{maxAgeMs:Math.min(3600000,config.config.diagnostics.snapshotIntervalMs*3+1000)});
    write({kind:'offline-inspection',networkChecked:false,modelDispatched:false,host,runtime,accounting:'program-port-required-for-start'});
    return command.mode==='inspect'?'ready'in host&&host.ready?0:2:'online'in host&&host.online?0:2;
  }
  runtimeCheck(authority&&authority.authorizationId===manifest.accounting.id&&runtimeDigest(authority.route)===runtimeDigest(manifest.accounting.route),'RUNTIME_ACCOUNTING_BINDING_MISMATCH');
  runtimeCheck(inspectHost(config,manifest.coordination.path).ready,'RUNTIME_HOST_NOT_READY');prepared.guard();
  const abort=new AbortController();let resources:ProductionRuntimeResources|undefined,host:ManagedHost|undefined,observed:ManagedHost|undefined;
  let recorder:ServerRuntimeStatusWriter|undefined,timer:ReturnType<typeof setInterval>|undefined,unsubscribe:(()=>void)|undefined,stopCode:string|undefined;
  const stop=(code:string)=>{if(stopCode)return;stopCode=code;abort.abort(new Error(code));resources?.budget.cancel(code);if(host)void host.close('runtime-stop').catch(()=>{});};
  const signal=()=>stop('RUNTIME_PROCESS_SIGNAL');process.on('SIGINT',signal);process.on('SIGTERM',signal);
  try{
    resources=await createProductionRuntime(config,{authority,windows:manifest.windows,maximumCallMs:manifest.maximumCallMs,drainTimeoutMs:manifest.drainTimeoutMs,guard:prepared.guard});
    const runtime=resources;unsubscribe=runtime.budget.onInterrupt(stop);abort.signal.throwIfAborted();
    host=await ManagedHost.start(config,{...runtime.hostOptions,coordination:manifest.coordination.path,mode:command.mode==='run'?'single-run':'daemon',signal:abort.signal,
      ...(manifest.biliOwner?{createBiliOwnerPorts:async()=>{prepared.guard();return createBiliOwnerProductionPorts(manifest.biliOwner);}}:{}),
      onPhase:(phase,current)=>{observed=current;if(phase==='opening')recorder=new ServerRuntimeStatusWriter({coreDir:config.paths.core,...identity});
        if(['binding','recovering','ready','degraded'].includes(phase)){abort.signal.throwIfAborted();runtime.budget.remainingMs();}
        recorder?.write({state:['ready','degraded'].includes(phase)?'running':'starting',host:projectServerRuntimeHost(current.snapshot()),parentProof:projectServerRuntimeParentProof(runtime.parentProof),stop:null,closure:{drained:false,proof:'open'}});
      }});
    timer=setInterval(()=>{try{prepared.guard();runtime.budget.remainingMs();const snapshot=host!.snapshot();
      if(!stopCode&&['ready','degraded'].includes(snapshot.phase))recorder?.write({state:'running',host:projectServerRuntimeHost(snapshot),parentProof:projectServerRuntimeParentProof(runtime.parentProof),stop:null,closure:{drained:false,proof:'open'}});
    }catch(error){stop(runtimeCode(error,'RUNTIME_SUPERVISION_FAILED'));}},config.config.diagnostics.snapshotIntervalMs);timer.unref();
    if(command.mode==='run'){const result=await host.run(request);write({kind:'runtime-run',result});return result.state==='completed'?0:2;}
    write({kind:'runtime-start',host:host.snapshot()});await host.whenClosed();return stopCode||host.snapshot().phase==='failed'?2:0;
  }catch(error){stopCode??=runtimeCode(error,'RUNTIME_LAUNCH_FAILED');throw new Error(stopCode);}
  finally{
    if(timer)clearInterval(timer);process.off('SIGINT',signal);process.off('SIGTERM',signal);unsubscribe?.();let drained=false;
    try{if(resources)await resources.close(observed);else await observed?.close();drained=true;}
    finally{const receipt=recorder?.write({state:drained?'stopped':'failed',host:observed?projectServerRuntimeHost(observed.snapshot()):null,
      parentProof:resources?projectServerRuntimeParentProof(resources.parentProof):null,stop:classifyServerRuntimeStop(stopCode??observed?.snapshot().error??'RUNTIME_COMMAND_ENDED'),
      closure:{drained,proof:resources?drained?'closed':'unconfirmed':'not-created'}});if(receipt)write({kind:'runtime-close-receipt',runtime:receipt});}
  }
}
