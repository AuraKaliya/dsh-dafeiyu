import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { dirname,resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { runtimeHash } from '@dafeiyu/core/runtime-store';
import { ExecutionRequestSchema } from '@dafeiyu/contracts';
import { loadHostConfig,pluginConfig } from './configuration.js';
import type { PreparedHostConfig } from './configuration.js';
import { inspectHost,initializeProfile } from './profile.js';
import { readHostStatus } from './status.js';
import { claim,conflict } from './coordination.js';
import { pathIdentity } from './paths.js';
import { ManagedHost } from './runtime.js';

export interface HostCommand {mode:'inspect'|'init'|'start'|'run'|'status';config:string;request?:string}
export function parseHostCommand(args:readonly string[]):HostCommand{
  const mode=z.enum(['inspect','init','start','run','status']).parse(args[0]);
  const allowed=new Set(['--config',...(mode==='run'?['--request']:[])]),values=new Map<string,string>();
  for(let i=1;i<args.length;i+=2){const key=args[i]!,value=args[i+1];if(!allowed.has(key)||!value||value.startsWith('--')||values.has(key))throw new Error('HOST_ARGUMENT_INVALID');values.set(key,value);}
  if([...allowed].some(key=>!values.has(key)))throw new Error('HOST_ARGUMENT_MISSING');
  return {mode,config:resolve(values.get('--config')!),...(values.has('--request')?{request:resolve(values.get('--request')!)}:{})};
}
function jsonFile(file:string,max=262144){const bytes=readFileSync(file);if(bytes.length>max)throw new Error('HOST_INPUT_TOO_LARGE');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}
export async function runHostCommand(command:HostCommand,write:(value:unknown)=>void=console.log):Promise<number>{
  const config=loadHostConfig(command.config);
  if(command.mode==='inspect'){const result=inspectHost(config);write({kind:'offline-inspection',networkChecked:false,...result});return result.ready?0:2;}
  if(command.mode==='init'){write(initializeProfile(config));return 0;}
  if(command.mode==='status'){write(readHostStatus(config));return 0;}
  const abort=new AbortController();let host:ManagedHost|undefined;
  const stop=()=>{abort.abort();if(host)void host.close('signal').catch(()=>{});};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  const calls={started:0,completed:0,failed:0};
  try{
    // Parse the business-only request before opening any mutable runtime state.
    let request:z.output<typeof ExecutionRequestSchema>|undefined;if(command.mode==='run'){try{request=ExecutionRequestSchema.parse(jsonFile(command.request!,131072));}catch{throw new Error('HOST_REQUEST_INVALID');}}
    try{host=await ManagedHost.start(config,{mode:command.mode==='run'?'single-run':'daemon',signal:abort.signal,onModelCall:call=>{calls[call.status]++;}});}catch(error){if(abort.signal.aborted){write({status:'cancelled',code:'HOST_START_CANCELLED'});return 2;}throw error;}
    if(abort.signal.aborted){await host.close('signal');write({status:'cancelled',code:'HOST_START_CANCELLED'});return 2;}
    if(command.mode==='start'){write(host.snapshot());await host.whenClosed();write(host.snapshot());return host.snapshot().phase==='failed'?1:0;}
    const result=await host.run(request);write({...result,model:config.config.modelRoutes.chat,modelKind:config.config.modelRoutes.chat.provider==='local-test'?'scripted':'real',modelRequests:calls});return result.state==='completed'?0:result.state==='failed'?1:2;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);await host?.close('command-ended');}
}
