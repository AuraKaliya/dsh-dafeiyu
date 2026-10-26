import { spawn,execFile } from 'node:child_process';
import { mkdtemp,writeFile,rm,realpath,lstat } from 'node:fs/promises';
import { join,resolve,dirname,relative,isAbsolute,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export interface WorkerSpec {executable:string;arguments:readonly string[];timeoutMs:number;memoryBytes:number;maxStdoutBytes:number;maxStderrBytes?:number;signal:AbortSignal}
export interface WorkerResult {stdout:Buffer;stderr:Buffer;peakCommitBytes:number;memoryLimitBytes:number}
const resultSchema=z.strictObject({guardApplied:z.boolean(),code:z.string().nullable(),exitCode:z.number().int(),peakCommitBytes:z.number().int().nonnegative(),stdoutBase64:z.string(),stderrBase64:z.string()});
export class MediaWorkerError extends Error {constructor(readonly code:string){super(code);}}

export async function contained(root:string,file:string){const actualRoot=await realpath(root),actual=await realpath(file),delta=relative(actualRoot,actual);
  if(!delta||delta==='..'||delta.startsWith('..'+sep)||isAbsolute(delta))throw new MediaWorkerError('MEDIA_PATH_ESCAPE');return actual;}

/** Executes one known program under a Windows Job before it can read input. No shell commands. */
export class BoundedProcess {
  constructor(private readonly workRoot:string,private readonly powershell=join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe')){}
  async run(raw:WorkerSpec):Promise<WorkerResult>{
    if(process.platform!=='win32')throw new MediaWorkerError('MEDIA_MEMORY_GUARD_UNAVAILABLE');raw.signal.throwIfAborted();
    const spec=z.object({executable:z.string().min(1),arguments:z.array(z.string().max(8192).refine(v=>!v.includes('\0'))).max(100),timeoutMs:z.number().int().min(1).max(300000),
      memoryBytes:z.number().int().min(16*1024*1024).max(2*1024**3),maxStdoutBytes:z.number().int().min(1).max(32*1024*1024),maxStderrBytes:z.number().int().min(1).max(1024*1024).default(65536)}).parse(raw);
    const program=await realpath(resolve(spec.executable));if(!(await lstat(program)).isFile()||!program.toLowerCase().endsWith('.exe'))throw new MediaWorkerError('MEDIA_WORKER_INVALID');
    const directory=await mkdtemp(join(await realpath(this.workRoot),'process-'));await contained(this.workRoot,directory);
    const argsFile=join(directory,'request.json'),actualHelper=fileURLToPath(new URL('../workers/bounded-process.ps1',import.meta.url));
    await writeFile(argsFile,JSON.stringify({...spec,executable:program,cwd:directory,parentPid:process.pid}),{flag:'wx'});
    try{
      const envelope=await new Promise<Buffer>((done,reject)=>{
        const env:NodeJS.ProcessEnv={SystemRoot:process.env.SystemRoot??'C:\\Windows',WINDIR:process.env.WINDIR??'C:\\Windows',
          PATH:dirname(program)+';'+join(process.env.SystemRoot??'C:\\Windows','System32'),TMP:directory,TEMP:directory,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1'};
        const child=spawn(this.powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',actualHelper,'-SpecFile',argsFile],{cwd:directory,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
        const chunks:Buffer[]=[];let bytes=0,settled=false,reason:string|null=null;
        const limit=Math.ceil(spec.maxStdoutBytes*1.4+spec.maxStderrBytes*1.4+16384);
        let killing=false,termination:Promise<void>|undefined;const kill=(code:string)=>{reason??=code;if(killing||child.pid===undefined)return;killing=true;
          const killer=spawn(join(env.SystemRoot!,'System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
          termination=new Promise<void>(resolve=>{killer.once('close',()=>resolve());killer.once('error',()=>{child.kill();resolve();});});};const abort=()=>kill('MEDIA_CANCELLED');raw.signal.addEventListener('abort',abort,{once:true});
        const deadline=setTimeout(()=>kill('MEDIA_WORKER_TIMEOUT'),spec.timeoutMs+20000);
        const finish=(error:Error|null)=>{if(settled)return;settled=true;clearTimeout(deadline);raw.signal.removeEventListener('abort',abort);
          const complete=()=>{if(error)reject(error);else done(Buffer.concat(chunks));};if(termination)void termination.then(complete);else complete();};
        child.stdout.on('data',(data:Buffer)=>{bytes+=data.length;if(bytes>limit)kill('MEDIA_WORKER_OUTPUT_LIMIT');else chunks.push(Buffer.from(data));});
        child.stderr.on('data',()=>{}); // No raw program diagnostics in application logs.
        child.on('error',()=>finish(new MediaWorkerError('MEDIA_WORKER_START_FAILED')));
        child.on('close',()=>finish(reason?new MediaWorkerError(reason):null));if(raw.signal.aborted)abort();
      });
      raw.signal.throwIfAborted();let result:z.infer<typeof resultSchema>;try{result=resultSchema.parse(JSON.parse(envelope.toString('utf8').replace(/^\uFEFF/,'')));}catch{throw new MediaWorkerError('MEDIA_WORKER_PROTOCOL_INVALID');}
      if(!result.guardApplied)throw new MediaWorkerError('MEDIA_MEMORY_GUARD_UNAVAILABLE');if(result.code)throw new MediaWorkerError(/^[A-Z0-9_]{1,100}$/.test(result.code)?result.code:'MEDIA_WORKER_FAILED');
      const stdout=Buffer.from(result.stdoutBase64,'base64'),stderr=Buffer.from(result.stderrBase64,'base64');if(stdout.length>spec.maxStdoutBytes||stderr.length>spec.maxStderrBytes)throw new MediaWorkerError('MEDIA_WORKER_OUTPUT_LIMIT');
      return {stdout,stderr,peakCommitBytes:result.peakCommitBytes,memoryLimitBytes:spec.memoryBytes};
    }finally{
      const workRoot=await realpath(this.workRoot);await contained(workRoot,directory);
      try{await rm(directory,{recursive:true,force:true,maxRetries:1,retryDelay:50});}
      catch(error){
        if(!(error instanceof Error)||!('code' in error)||!['EPERM','EACCES'].includes(String(error.code)))throw error;
        // An interrupted Windows PowerShell CodeDOM compilation can retain its
        // temporary no-delete ACE. Restore only that ACE after the owned tree stopped.
        await new Promise<void>((done,reject)=>execFile(this.powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('../workers/restore-compiler-temp-access.ps1',import.meta.url)),'-WorkRoot',workRoot,'-Directory',directory],
          {windowsHide:true,timeout:10000,maxBuffer:16384,env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TMP:directory,TEMP:directory}},error=>error?reject(new MediaWorkerError('MEDIA_WORKER_CLEANUP_FAILED')):done()));
        await contained(workRoot,directory);await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
      }
    }
  }
}
