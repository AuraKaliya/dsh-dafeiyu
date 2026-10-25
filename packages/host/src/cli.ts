import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { dirname,resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { runtimeHash } from '@dafeiyu/core/runtime-store';
import { ExecutionRequestSchema } from '@dafeiyu/contracts';
import { loadHostConfig } from './configuration.js';
import type { PreparedHostConfig } from './configuration.js';
import { inspectHost,initializeProfile } from './profile.js';
import { readHostStatus } from './status.js';
import { planMigration,applyMigration,verifyMigration,MigrationPlanSchema } from './migration.js';
import type { MigrationPlan } from './migration.js';
import { claim,conflict } from './coordination.js';
import { pathIdentity } from './paths.js';
import { ManagedHost } from './runtime.js';

export interface HostCommand {mode:'inspect'|'init'|'start'|'run'|'status'|'migrate';migration?:'plan'|'apply'|'verify';config:string;request?:string;plan?:string;backup?:string;out?:string}
export function parseHostCommand(args:readonly string[]):HostCommand{
  const mode=z.enum(['inspect','init','start','run','status','migrate']).parse(args[0]);let offset=1;
  const migration=mode==='migrate'?z.enum(['plan','apply','verify']).parse(args[offset++]):undefined;
  const allowed=new Set(['--config',...(mode==='run'?['--request']:[]),...(migration==='plan'?['--backup-dir','--out']:migration?['--plan']:[])]),values=new Map<string,string>();
  for(let i=offset;i<args.length;i+=2){const key=args[i]!,value=args[i+1];if(!allowed.has(key)||!value||value.startsWith('--')||values.has(key))throw new Error('HOST_ARGUMENT_INVALID');values.set(key,value);}
  if([...allowed].some(key=>!values.has(key)))throw new Error('HOST_ARGUMENT_MISSING');
  return {mode,...(migration?{migration}:{}),config:resolve(values.get('--config')!),...(values.has('--request')?{request:resolve(values.get('--request')!)}:{}),...(values.has('--plan')?{plan:resolve(values.get('--plan')!)}:{}),...(values.has('--backup-dir')?{backup:resolve(values.get('--backup-dir')!)}:{}),...(values.has('--out')?{out:resolve(values.get('--out')!)}:{})};
}
function jsonFile(file:string,max=262144){const bytes=readFileSync(file);if(bytes.length>max)throw new Error('HOST_INPUT_TOO_LARGE');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}
function matchingPlan(plan:MigrationPlan,config:PreparedHostConfig){const b=plan.bundle,hash=b.provenance?.configHash;
  if(!hash||hash!==config.hash&&hash!==runtimeHash(config.config)||b.identity.profileId!==config.config.profileId||b.identity.agentId!==config.config.agent.id||pathIdentity(b.coreDir)!==pathIdentity(config.paths.core)||pathIdentity(b.memoryDir)!==pathIdentity(config.paths.memory)||pathIdentity(b.sessionsDir)!==pathIdentity(config.paths.sessions)
    ||!!b.activity!==config.plugins.some(p=>p.id==='activity'&&p.enabled)||JSON.stringify((b.qqFiles??[]).map(pathIdentity).sort())!==JSON.stringify(Object.values(config.paths.channels).map(dir=>pathIdentity(join(dir,'qq.sqlite'))).sort()))throw new Error('HOST_MIGRATION_CONFIG_MISMATCH');}
export async function runHostCommand(command:HostCommand,write:(value:unknown)=>void=console.log):Promise<number>{
  const config=loadHostConfig(command.config);
  if(command.mode==='inspect'){const result=inspectHost(config);write({kind:'offline-inspection',networkChecked:false,...result});return result.ready?0:2;}
  if(command.mode==='init'){write(initializeProfile(config));return 0;}
  if(command.mode==='status'){write(readHostStatus(config));return 0;}
  if(command.mode==='migrate'){
    if(conflict(config.resources))throw new Error('HOST_ALREADY_OWNED');
    if(command.migration==='plan'){
      let sourceRevision='unavailable',dirty=true;try{const cwd=fileURLToPath(new URL('../../../',import.meta.url));sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();dirty=!!execFileSync('git',['status','--porcelain'],{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{/* Installed packages may not carry repository metadata. */}
      const plan=await planMigration({coreDir:config.paths.core,memoryDir:config.paths.memory,sessionsDir:config.paths.sessions,backupDir:command.backup!,identity:{agentId:config.config.agent.id,profileId:config.config.profileId},qqFiles:Object.values(config.paths.channels).map(dir=>join(dir,'qq.sqlite')),activity:config.plugins.some(p=>p.id==='activity'&&p.enabled),provenance:{sourceRevision,dirty,configHash:config.hash}});
      mkdirSync(dirname(command.out!),{recursive:true});writeFileSync(command.out!,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});write({status:'planned',id:plan.id,plan:command.out});return 0;
    }
    const plan=MigrationPlanSchema.parse(jsonFile(command.plan!,8*1024*1024));matchingPlan(plan,config);
    if(command.migration==='verify'){const result=verifyMigration(plan);write(result);return result.passed?0:2;}
    const lease=claim(config.resources,{profileId:config.config.profileId,agentId:config.config.agent.id});try{write(await applyMigration(plan));return 0;}finally{lease.release();}
  }
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
