param([Parameter(Mandatory = $true)][string]$SpecFile)
$ErrorActionPreference = 'Stop'
try {
  $specDoc = Get-Content -LiteralPath $SpecFile -Raw -Encoding UTF8 | ConvertFrom-Json
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class MediaBoundedProcess {
  [StructLayout(LayoutKind.Sequential)] struct Security { public int Length; public IntPtr Descriptor; public int Inherit; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public int cb; public string reserved; public string desktop; public string title;
    public uint x,y,xSize,ySize,xCount,yCount,fill,flags; public short show,cbReserved; public IntPtr reserved2,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint processId,threadId; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
    public long processTime,jobTime; public uint flags; public UIntPtr minWorking,maxWorking; public uint activeProcesses; public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit basic; public IoCounters io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr attrs,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,ref ExtendedLimit limit,uint length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int info,out ExtendedLimit limit,uint length,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref Security attrs,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateFileW(string name,uint access,uint share,ref Security attrs,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcessW(string app,StringBuilder cmd,IntPtr procAttr,IntPtr threadAttr,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out ProcessInfo info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint exit);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint exit);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  static void Close(ref IntPtr handle){if(handle!=IntPtr.Zero&&handle!=new IntPtr(-1))CloseHandle(handle);handle=IntPtr.Zero;}
  static string Quote(string value){var result=new StringBuilder("\"");int slashes=0;
    foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='"'){result.Append('\\',slashes*2+1);result.Append('"');slashes=0;continue;}result.Append('\\',slashes);slashes=0;result.Append(c);}
    result.Append('\\',slashes*2);result.Append('"');return result.ToString();}
  public class Result {public bool guardApplied;public string code;public long exitCode,peakCommitBytes;public string stdoutBase64,stderrBase64;}
  static byte[] ReadBounded(IntPtr handle,int limit,Action tooMuch){using(var file=new FileStream(new SafeFileHandle(handle,true),FileAccess.Read,8192,false))using(var bytes=new MemoryStream()){
    var buffer=new byte[8192];int count;while((count=file.Read(buffer,0,buffer.Length))>0){if(bytes.Length+count>limit){tooMuch();return bytes.ToArray();}bytes.Write(buffer,0,count);}return bytes.ToArray();}}
  public static Result Run(string executable,string[] args,string cwd,int timeoutMs,long memoryBytes,int outLimit,int errLimit,uint parentPid){
    IntPtr job=IntPtr.Zero,outRead=IntPtr.Zero,outWrite=IntPtr.Zero,errRead=IntPtr.Zero,errWrite=IntPtr.Zero,input=IntPtr.Zero,parent=IntPtr.Zero;
    ProcessInfo proc=new ProcessInfo();bool started=false;int reason=0;
    try {
      if(memoryBytes<16777216||timeoutMs<1||outLimit<1||errLimit<1||!Path.IsPathRooted(executable)||!Path.IsPathRooted(cwd))throw new InvalidOperationException();
      parent=OpenProcess(0x00100000,false,parentPid);if(parent==IntPtr.Zero)throw new InvalidOperationException();
      job=CreateJobObjectW(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new InvalidOperationException();
      var limits=new ExtendedLimit();limits.basic.flags=0x2000|0x100|0x200;limits.processMemory=(UIntPtr)(ulong)memoryBytes;limits.jobMemory=(UIntPtr)(ulong)memoryBytes;
      if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimit))))throw new InvalidOperationException();
      var security=new Security();security.Length=Marshal.SizeOf(typeof(Security));security.Inherit=1;
      if(!CreatePipe(out outRead,out outWrite,ref security,0)||!CreatePipe(out errRead,out errWrite,ref security,0))throw new InvalidOperationException();
      if(!SetHandleInformation(outRead,1,0)||!SetHandleInformation(errRead,1,0))throw new InvalidOperationException();
      input=CreateFileW("NUL",0x80000000,3,ref security,3,0,IntPtr.Zero);if(input==new IntPtr(-1))throw new InvalidOperationException();
      var startup=new Startup();startup.cb=Marshal.SizeOf(typeof(Startup));startup.flags=0x100|1;startup.show=0;startup.input=input;startup.output=outWrite;startup.error=errWrite;
      var command=new StringBuilder(Quote(executable));foreach(string arg in args)command.Append(' ').Append(Quote(arg));
      if(command.Length>30000||!CreateProcessW(executable,command,IntPtr.Zero,IntPtr.Zero,true,0x08000000|0x4,IntPtr.Zero,cwd,ref startup,out proc))throw new InvalidOperationException();
      started=true;if(!AssignProcessToJobObject(job,proc.process))throw new InvalidOperationException();
      Close(ref outWrite);Close(ref errWrite);Close(ref input);
      IntPtr readOut=outRead,readErr=errRead;outRead=errRead=IntPtr.Zero;
      Action tooMuch=()=>{Interlocked.CompareExchange(ref reason,2,0);TerminateJobObject(job,143);};
      var stdout=Task.Run(()=>ReadBounded(readOut,outLimit,tooMuch));var stderr=Task.Run(()=>ReadBounded(readErr,errLimit,tooMuch));
      if(ResumeThread(proc.thread)==0xffffffff)throw new InvalidOperationException();var watch=Stopwatch.StartNew();
      while(WaitForSingleObject(proc.process,20)!=0){
        if(WaitForSingleObject(parent,0)==0){Interlocked.CompareExchange(ref reason,3,0);TerminateJobObject(job,143);break;}
        if(watch.ElapsedMilliseconds>=timeoutMs){Interlocked.CompareExchange(ref reason,1,0);TerminateJobObject(job,143);break;}
      }
      WaitForSingleObject(proc.process,5000);TerminateJobObject(job,143); // Close inherited pipes in any remaining descendants.
      if(!Task.WaitAll(new Task[]{stdout,stderr},5000))throw new InvalidOperationException();
      uint exit;if(!GetExitCodeProcess(proc.process,out exit))throw new InvalidOperationException();ExtendedLimit measured;
      QueryInformationJobObject(job,9,out measured,(uint)Marshal.SizeOf(typeof(ExtendedLimit)),IntPtr.Zero);
      return new Result{guardApplied=true,code=reason==1?"MEDIA_WORKER_TIMEOUT":reason==2?"MEDIA_WORKER_OUTPUT_LIMIT":reason==3?"MEDIA_PARENT_EXITED":exit==0?null:"MEDIA_WORKER_FAILED",
        exitCode=(long)exit,peakCommitBytes=(long)measured.peakProcess.ToUInt64(),stdoutBase64=Convert.ToBase64String(stdout.Result),stderrBase64=Convert.ToBase64String(stderr.Result)};
    } finally {if(started&&proc.process!=IntPtr.Zero&&WaitForSingleObject(proc.process,0)!=0)TerminateProcess(proc.process,143);
      Close(ref job);Close(ref proc.thread);Close(ref proc.process);Close(ref parent);Close(ref outRead);Close(ref outWrite);Close(ref errRead);Close(ref errWrite);Close(ref input);}
  }
}
'@
  $workerResult = [MediaBoundedProcess]::Run([string]$specDoc.executable, [string[]]$specDoc.arguments, [string]$specDoc.cwd,
    [int]$specDoc.timeoutMs, [long]$specDoc.memoryBytes, [int]$specDoc.maxStdoutBytes, [int]$specDoc.maxStderrBytes, [uint32]$specDoc.parentPid)
  $workerResult | ConvertTo-Json -Depth 4 -Compress
} catch {
  @{ guardApplied = $false; code = 'MEDIA_MEMORY_GUARD_UNAVAILABLE'; exitCode = 1; peakCommitBytes = 0; stdoutBase64 = ''; stderrBase64 = '' } | ConvertTo-Json -Compress
  exit 1
}
