import { spawn } from 'node:child_process';
import type { ChildProcess,SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { isAbsolute,resolve } from 'node:path';
import { z } from 'zod';
import { ExecutorHashSchema,ExecutorProcessSchema,executorHash } from './types.js';
import type { ExecutorProcess } from './types.js';
import type { ExecutionBudgetPort,ExecutorBudgetRecord } from './budget.js';
import { executorError,ParentMessageSchema } from './protocol.js';
import type { ExecutorRoute } from './protocol.js';
import { parentIpcEndpoint } from './ipc.js';
import { ExecutorParentTransport } from './transport.js';
import { ExecutorOutputCollector } from './output.js';
import type { ExecutorVisibleOutput } from './output.js';

const absolute=z.string().min(1).max(2000).refine(isAbsolute);
const envValue=z.string().max(8000).refine(value=>!value.includes('\0'));
export const ExecutorNodeCommandSchema=z.strictObject({nodePath:absolute,entryPath:absolute,cwd:absolute,args:z.array(z.string().max(8000).refine(value=>!value.includes('\0'))).max(40),
  nodeHash:ExecutorHashSchema,entryHash:ExecutorHashSchema,profilePath:absolute,profileHash:ExecutorHashSchema,
  env:z.strictObject({SystemRoot:envValue.optional(),WINDIR:envValue.optional(),PATH:envValue.optional(),TEMP:envValue.optional(),TMP:envValue.optional(),
    DSH_PERMISSION_MODE:z.literal('danger-full-access').optional()})});
export type ExecutorNodeCommand=z.infer<typeof ExecutorNodeCommandSchema>;
/** Production supplies OS creation/token evidence. A test fixture must label its own substitute as simulated. */
export interface ExecutorProcessControl {
  identify(child:ChildProcess):Promise<ExecutorProcess>;
  terminate(child:ChildProcess,expected:ExecutorProcess):Promise<{verified:boolean}>;
}
export interface ExecutorNodeRunOptions {
  command:ExecutorNodeCommand;jobId:string;nonce:string;input:string;authorizationId:string;route:ExecutorRoute;deadline:number;budget:ExecutionBudgetPort;
  guard:()=>void;beforeSpawn:()=>void|Promise<void>;onReady:(process:ExecutorProcess)=>void|Promise<void>;processControl:ExecutorProcessControl;
  signal?:AbortSignal;handshakeTimeoutMs?:number;cancelGraceMs?:number;
}
export interface ExecutorNodeRunResult {
  schemaVersion:1;spawned:boolean;ready:boolean;finished:boolean;process:ExecutorProcess|null;exit:{code:number|null;signal:string|null}|null;
  termination:{requested:boolean;verified:boolean};output:ExecutorVisibleOutput;budget:readonly ExecutorBudgetRecord[];gaps:readonly string[];
}
export function executorSpawnOptions(command:ExecutorNodeCommand):SpawnOptions{
  const value=ExecutorNodeCommandSchema.parse(command);
  return {cwd:value.cwd,env:{...value.env},shell:false,windowsHide:true,stdio:['pipe','pipe','pipe','ipc'],serialization:'json'};
}
async function fileHash(path:string):Promise<string>{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
async function pinned(path:string,hash?:string):Promise<void>{
  const actual=await realpath(path),expected=resolve(path),same=process.platform==='win32'?actual.toLowerCase()===expected.toLowerCase():actual===expected;
  if(!same||hash!==undefined&&await fileHash(actual)!==hash)throw new Error('EXECUTOR_PROGRAM_CHANGED');
}
async function bounded<T>(promise:Promise<T>,ms:number):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('EXECUTOR_PROCESS_PROOF_TIMEOUT')),ms);})]);}finally{if(timer)clearTimeout(timer);}}
async function pauseUntil(promise:Promise<unknown>,ms:number):Promise<void>{let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([promise,new Promise<void>(resolve=>{timer=setTimeout(resolve,ms);})]);}finally{if(timer)clearTimeout(timer);}}

/** Only starts an already authorized, fixed Node program; it does not classify business effects or send platform messages. */
export async function runExecutorNode(options:ExecutorNodeRunOptions):Promise<ExecutorNodeRunResult>{
  const command=ExecutorNodeCommandSchema.parse(options.command),grace=z.number().int().nonnegative().max(5000).parse(options.cancelGraceMs??500);
  ParentMessageSchema.parse({version:1,type:'bind',jobId:options.jobId,nonce:options.nonce,profileHash:command.profileHash,deadline:options.deadline,route:options.route});
  z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/).parse(options.authorizationId);z.number().int().positive().max(60000).parse(options.handshakeTimeoutMs??10000);
  if(typeof options.input!=='string'||Buffer.byteLength(options.input)>1024*1024)throw new Error('EXECUTOR_INPUT_TOO_LARGE');
  if(!options.budget||typeof options.processControl?.identify!=='function'||typeof options.processControl.terminate!=='function')throw new Error('EXECUTOR_TRUSTED_PORT_REQUIRED');
  options.signal?.throwIfAborted();options.guard();if(Date.now()>=options.deadline)throw new Error('EXECUTOR_DEADLINE');
  await Promise.all([pinned(command.nodePath,command.nodeHash),pinned(command.entryPath,command.entryHash),pinned(command.profilePath,command.profileHash),pinned(command.cwd)]);
  options.signal?.throwIfAborted();options.guard();await options.beforeSpawn();options.signal?.throwIfAborted();options.guard();if(Date.now()>=options.deadline)throw new Error('EXECUTOR_DEADLINE');
  const child=spawn(command.nodePath,[command.entryPath,...command.args],executorSpawnOptions(command)),output=new ExecutorOutputCollector(),gaps=new Set<string>();
  let spawned=false,ready=false,processExited=false,streamsClosed=false,identity:ExecutorProcess|null=null,exit:ExecutorNodeRunResult['exit']=null,termination={requested:false,verified:false};
  let resolveExit!:()=>void,resolveClosed!:()=>void,resolveSpawn!:()=>void,rejectSpawn!:(error:Error)=>void,resolveStop!:()=>void;
  const exited=new Promise<void>(resolve=>{resolveExit=resolve;}),closed=new Promise<void>(resolve=>{resolveClosed=resolve;}),
    started=new Promise<void>((resolve,reject)=>{resolveSpawn=resolve;rejectSpawn=reject;}),stopped=new Promise<void>(resolve=>{resolveStop=resolve;});
  void started.catch(()=>{});
  // A process exit and its stdio closure are different facts, especially during IPC cancellation.
  const observeExit=(code:number|null,signal:string|null):void=>{if(code===null&&signal===null)return;processExited=true;exit={code,signal};resolveExit();};
  const refreshExit=():void=>observeExit(child.exitCode,child.signalCode);
  let transport:ExecutorParentTransport|undefined,stopping:Promise<void>|undefined;
  const stop=(code:string):void=>{
    gaps.add(code);resolveStop();if(stopping)return;
    stopping=(async()=>{
      void transport?.close(code).catch(error=>gaps.add(executorError(error,'EXECUTOR_ACCOUNTING_UNCERTAIN')));
      if(child.stdin&&!child.stdin.writableEnded&&!child.stdin.destroyed)child.stdin.end();
      refreshExit();await pauseUntil(exited,grace);refreshExit();if(processExited)return;
      const expected=identity;if(!expected){gaps.add('EXECUTOR_PROCESS_IDENTITY_UNPROVEN');return;}
      try{const current=ExecutorProcessSchema.parse(await bounded(options.processControl.identify(child),2000));
        if(executorHash(current)!==executorHash(expected)){gaps.add('EXECUTOR_PROCESS_IDENTITY_CHANGED');return;}
        refreshExit();if(processExited)return;
        termination={requested:true,verified:false};const result=await bounded(options.processControl.terminate(child,expected),3000);
        termination.verified=result.verified===true;if(!termination.verified)gaps.add('EXECUTOR_TERMINATION_UNVERIFIED');
        await pauseUntil(exited,1000);refreshExit();if(!processExited)gaps.add('EXECUTOR_EXIT_UNCONFIRMED');
      }catch(error){gaps.add(executorError(error,'EXECUTOR_TERMINATION_UNVERIFIED'));}
    })();
  };
  const onAbort=()=>stop('EXECUTOR_CANCELLED');
  child.once('spawn',()=>{spawned=true;resolveSpawn();});
  child.on('error',()=>{rejectSpawn(new Error('EXECUTOR_SPAWN_FAILED'));stop('EXECUTOR_SPAWN_FAILED');});
  child.once('exit',observeExit);
  child.once('close',(code,signal)=>{streamsClosed=true;observeExit(code,signal);resolveClosed();});
  const onStdout=(chunk:Buffer)=>output.stdout(chunk),onStderr=(chunk:Buffer)=>output.stderr(chunk);
  child.stdout?.on('data',onStdout);child.stderr?.on('data',onStderr);
  child.stdin?.on('error',()=>stop('EXECUTOR_STDIN_FAILED'));
  options.signal?.addEventListener('abort',onAbort,{once:true});
  const monitor=setInterval(()=>{refreshExit();if(processExited)return;try{options.guard();if(Date.now()>=options.deadline)throw new Error('EXECUTOR_DEADLINE');}catch(error){stop(executorError(error,'EXECUTOR_AUTHORITY_REVOKED'));}},100);
  try{
    transport=new ExecutorParentTransport({endpoint:parentIpcEndpoint(child),port:options.budget,jobId:options.jobId,nonce:options.nonce,profileHash:command.profileHash,
      route:options.route,authorizationId:options.authorizationId,deadline:options.deadline,guard:options.guard,
      ...(options.handshakeTimeoutMs===undefined?{}:{handshakeTimeoutMs:options.handshakeTimeoutMs}),onStop:stop,
      onReady:async()=>{await started;const value=ExecutorProcessSchema.parse(await bounded(options.processControl.identify(child),2000));
        if(value.pid!==child.pid||value.executableHash!==command.nodeHash)throw new Error('EXECUTOR_PROCESS_IDENTITY_CHANGED');
        identity=value;options.guard();await options.onReady(value);ready=true;}});
    if(options.signal?.aborted)stop('EXECUTOR_CANCELLED');
    void transport.ready().then(()=>{try{options.guard();options.signal?.throwIfAborted();if(!child.stdin)throw new Error('EXECUTOR_STDIN_FAILED');child.stdin.end(options.input);}catch(error){stop(executorError(error,'EXECUTOR_AUTHORITY_REVOKED'));}},error=>stop(executorError(error)));
    await Promise.race([exited,stopped]);if(stopping)await stopping;
    refreshExit();if(!transport.finished&&processExited)gaps.add('EXECUTOR_CHILD_UNFINISHED');
    await transport.close(processExited?'EXECUTOR_CHILD_EXITED':'EXECUTOR_CHILD_UNCONFIRMED').catch(error=>gaps.add(executorError(error,'EXECUTOR_ACCOUNTING_UNCERTAIN')));
  }catch(error){stop(executorError(error));if(stopping)await stopping;}
  finally{
    clearInterval(monitor);options.signal?.removeEventListener('abort',onAbort);refreshExit();
    if(processExited&&!streamsClosed)await pauseUntil(closed,1000);
    if(!processExited)gaps.add('EXECUTOR_EXIT_UNCONFIRMED');else if(!streamsClosed)gaps.add('EXECUTOR_OUTPUT_NOT_CLOSED');
    child.stdout?.removeListener('data',onStdout);child.stderr?.removeListener('data',onStderr);
    if(!streamsClosed){child.stdin?.destroy();child.stdout?.destroy();child.stderr?.destroy();if(child.connected)child.disconnect();}
    if(!processExited)child.unref();
  }
  return {schemaVersion:1,spawned,ready,finished:transport?.finished??false,process:identity,exit,termination,output:output.finish(),budget:transport?.budget.snapshot()??[],gaps:[...gaps]};
}
