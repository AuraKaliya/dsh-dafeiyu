param([Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$OwnerProcessId)
$ErrorActionPreference='Stop'
$WarningPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)

function Emit($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 8)) }
function Stable-Code($failure) {
    $exception=$failure.Exception
    while ($exception.InnerException) { $exception=$exception.InnerException }
    if ($exception.Message -match '^EXECUTOR_[A-Z0-9_]{1,90}$') { return $exception.Message }
    return 'EXECUTOR_WINDOWS_PROBE_FAILED'
}

try {
    if ($PSVersionTable.PSEdition -ne 'Desktop') { throw 'EXECUTOR_WINDOWS_POWERSHELL_REQUIRED' }
    # CodeDOM compilation inherits the caller's dedicated TEMP/TMP. No other program is imported.
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace Dafeiyu.ExecutorProof {
    public sealed class ProcessRow {
        public int pid { get; set; }
        public int parentPid { get; set; }
    }
    public sealed class ProcessIdentity {
        public int pid { get; set; }
        public string creationId { get; set; }
        public bool alive { get; set; }
    }
    public sealed class ProcessProof {
        public int pid { get; set; }
        public int parentPid { get; set; }
        public string creationId { get; set; }
        public string creationTimeUtc { get; set; }
        public string executablePath { get; set; }
        public string ownerSid { get; set; }
        public bool elevated { get; set; }
        public bool administratorsEnabled { get; set; }
        public int elevationType { get; set; }
        public bool restricted { get; set; }
        public bool alive { get; set; }
    }
    public static class Native {
        const uint QueryLimited=0x1000, Synchronize=0x100000, TokenQuery=8;
        const uint WaitTimeout=258, WaitFailed=0xffffffff;
        [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low; public uint High; }
        [StructLayout(LayoutKind.Sequential)] struct SidAttributes { public IntPtr Sid; public uint Attributes; }
        [StructLayout(LayoutKind.Sequential)] struct TokenGroups { public uint Count; public SidAttributes First; }
        [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct ProcessEntry {
            public uint Size, Usage, ProcessId; public UIntPtr DefaultHeap; public uint ModuleId, Threads, ParentId;
            public int BasePriority; public uint Flags;
            [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string ExeFile;
        }
        [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int id);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle,out FileTime created,out FileTime exited,out FileTime kernel,out FileTime user);
        [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr handle,uint flags,StringBuilder text,ref uint size);
        [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
        [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
        [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr buffer,int length,out int needed);
        [DllImport("advapi32.dll")] static extern bool IsTokenRestricted(IntPtr token);
        [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint id);
        [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode,EntryPoint="Process32FirstW")] static extern bool ProcessFirst(IntPtr snapshot,ref ProcessEntry row);
        [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode,EntryPoint="Process32NextW")] static extern bool ProcessNext(IntPtr snapshot,ref ProcessEntry row);

        static Exception Failure(string code) { return new InvalidOperationException(code); }
        static IntPtr Open(int id) {
            IntPtr handle=OpenProcess(QueryLimited|Synchronize,false,id);
            if(handle==IntPtr.Zero) throw Failure(Marshal.GetLastWin32Error()==87 ? "EXECUTOR_PROCESS_NOT_FOUND" : "EXECUTOR_PROCESS_UNAVAILABLE");
            return handle;
        }
        static bool Alive(IntPtr handle) {
            uint result=WaitForSingleObject(handle,0);
            if(result==WaitFailed) throw Failure("EXECUTOR_PROCESS_UNAVAILABLE");
            return result==WaitTimeout;
        }
        static ulong Created(IntPtr handle) {
            FileTime created,exited,kernel,user;
            if(!GetProcessTimes(handle,out created,out exited,out kernel,out user)) throw Failure("EXECUTOR_PROCESS_TIME_UNAVAILABLE");
            return ((ulong)created.High<<32)|created.Low;
        }
        static IntPtr TokenInfo(IntPtr token,int kind) {
            int size; GetTokenInformation(token,kind,IntPtr.Zero,0,out size);
            if(size<4||size>1048576) throw Failure("EXECUTOR_TOKEN_UNAVAILABLE");
            IntPtr buffer=Marshal.AllocHGlobal(size);
            if(!GetTokenInformation(token,kind,buffer,size,out size)) { Marshal.FreeHGlobal(buffer); throw Failure("EXECUTOR_TOKEN_UNAVAILABLE"); }
            return buffer;
        }
        static int TokenInt(IntPtr token,int kind) {
            IntPtr value=TokenInfo(token,kind); try { return Marshal.ReadInt32(value); } finally { Marshal.FreeHGlobal(value); }
        }
        static string UserSid(IntPtr token) {
            IntPtr value=TokenInfo(token,1);
            try { return new SecurityIdentifier(Marshal.ReadIntPtr(value)).Value; } finally { Marshal.FreeHGlobal(value); }
        }
        static bool AdminEnabled(IntPtr token) {
            IntPtr value=TokenInfo(token,2);
            try {
                int count=Marshal.ReadInt32(value),offset=Marshal.OffsetOf(typeof(TokenGroups),"First").ToInt32(),size=Marshal.SizeOf(typeof(SidAttributes));
                if(count<0||count>4096) throw Failure("EXECUTOR_TOKEN_UNAVAILABLE");
                for(int i=0;i<count;i++) {
                    SidAttributes item=(SidAttributes)Marshal.PtrToStructure(IntPtr.Add(value,offset+i*size),typeof(SidAttributes));
                    if(new SecurityIdentifier(item.Sid).Value=="S-1-5-32-544") return (item.Attributes&4)!=0&&(item.Attributes&16)==0;
                }
                return false;
            } finally { Marshal.FreeHGlobal(value); }
        }
        public static ProcessRow[] Snapshot() {
            IntPtr snapshot=CreateToolhelp32Snapshot(2,0);
            if(snapshot==new IntPtr(-1)) throw Failure("EXECUTOR_PROCESS_SNAPSHOT_UNAVAILABLE");
            try {
                List<ProcessRow> rows=new List<ProcessRow>(); ProcessEntry row=new ProcessEntry(); row.Size=(uint)Marshal.SizeOf(typeof(ProcessEntry));
                if(!ProcessFirst(snapshot,ref row)) throw Failure("EXECUTOR_PROCESS_SNAPSHOT_UNAVAILABLE");
                do {
                    if(rows.Count>=16384) throw Failure("EXECUTOR_PROCESS_SNAPSHOT_LIMIT");
                    if(row.ProcessId>0&&row.ProcessId<=Int32.MaxValue&&row.ParentId<=Int32.MaxValue) rows.Add(new ProcessRow {pid=(int)row.ProcessId,parentPid=(int)row.ParentId});
                } while(ProcessNext(snapshot,ref row));
                if(Marshal.GetLastWin32Error()!=18) throw Failure("EXECUTOR_PROCESS_SNAPSHOT_UNAVAILABLE");
                return rows.ToArray();
            } finally { CloseHandle(snapshot); }
        }
        public static ProcessIdentity Identity(int id) {
            IntPtr process=Open(id);
            try { return new ProcessIdentity {pid=id,creationId=Created(process).ToString(CultureInfo.InvariantCulture),alive=Alive(process)}; }
            finally { CloseHandle(process); }
        }
        public static ProcessProof Read(int id) {
            IntPtr process=Open(id),token=IntPtr.Zero;
            try {
                if(!Alive(process)) throw Failure("EXECUTOR_PROCESS_NOT_RUNNING");
                ulong created=Created(process); uint length=32768; StringBuilder path=new StringBuilder((int)length);
                if(!QueryFullProcessImageName(process,0,path,ref length)) throw Failure("EXECUTOR_PROCESS_PATH_UNAVAILABLE");
                if(!OpenProcessToken(process,TokenQuery,out token)) throw Failure("EXECUTOR_TOKEN_UNAVAILABLE");
                int parent=0; foreach(ProcessRow row in Snapshot()) if(row.pid==id) {parent=row.parentPid;break;}
                ProcessProof proof=new ProcessProof {pid=id,parentPid=parent,creationId=created.ToString(CultureInfo.InvariantCulture),
                    creationTimeUtc=DateTime.FromFileTimeUtc((long)created).ToString("o",CultureInfo.InvariantCulture),executablePath=path.ToString(),
                    ownerSid=UserSid(token),elevated=TokenInt(token,20)!=0,administratorsEnabled=AdminEnabled(token),elevationType=TokenInt(token,18),restricted=IsTokenRestricted(token),alive=Alive(process)};
                if(!proof.alive) throw Failure("EXECUTOR_PROCESS_NOT_RUNNING"); return proof;
            } finally { if(token!=IntPtr.Zero)CloseHandle(token); CloseHandle(process); }
        }
    }
}
'@ | Out-Null
    $parent=[Dafeiyu.ExecutorProof.Native]::Read($OwnerProcessId)
    Emit @{version=1;kind='ready';parent=$parent}
    while ($null -ne ($line=[Console]::In.ReadLine())) {
        if ($line.Length -gt 16384) { throw 'EXECUTOR_PROBE_REQUEST_INVALID' }
        $request=$line | ConvertFrom-Json
        if ($request.requestId -notmatch '^[a-z0-9-]{1,60}$' -or $request.kind -ne 'inspect' -or $request.targetPid -lt 1 -or $request.targetPid -gt 2147483647 -or @($request.tracked).Count -gt 128) { throw 'EXECUTOR_PROBE_REQUEST_INVALID' }
        $parent=[Dafeiyu.ExecutorProof.Native]::Read($OwnerProcessId); $target=$null; $targetError=$null
        try { $target=[Dafeiyu.ExecutorProof.Native]::Read([int]$request.targetPid) } catch { $targetError=Stable-Code $_ }
        $descendants=[Collections.Generic.List[object]]::new(); $tracked=[Collections.Generic.List[object]]::new(); $complete=$true
        $minimum=[uint64]0
        if ($request.creationId -match '^[0-9]{1,20}$') { $minimum=[uint64]::Parse($request.creationId) } elseif ($target) { $minimum=[uint64]::Parse($target.creationId) }
        try {
            $rows=[Dafeiyu.ExecutorProof.Native]::Snapshot(); $known=[Collections.Generic.HashSet[int]]::new(); [void]$known.Add([int]$request.targetPid)
            $progress=$true
            while ($progress) { $progress=$false
                foreach ($row in $rows) {
                    if (!$known.Contains($row.parentPid) -or $known.Contains($row.pid)) { continue }
                    if ($descendants.Count -ge 128) { $complete=$false; break }
                    [void]$known.Add($row.pid); $progress=$true
                    try { $identity=[Dafeiyu.ExecutorProof.Native]::Identity($row.pid)
                        if ([uint64]::Parse($identity.creationId) -ge $minimum) { $descendants.Add(@{pid=$row.pid;parentPid=$row.parentPid;creationId=$identity.creationId;alive=$identity.alive}) }
                        else { $complete=$false }
                    } catch { $complete=$false }
                }
                if ($descendants.Count -ge 128) { break }
            }
        } catch { $complete=$false }
        foreach ($item in @($request.tracked)) {
            if ($item.pid -lt 1 -or $item.pid -gt 2147483647 -or $item.creationId -notmatch '^[0-9]{1,20}$') { throw 'EXECUTOR_PROBE_REQUEST_INVALID' }
            $state='unknown'
            try { $identity=[Dafeiyu.ExecutorProof.Native]::Identity([int]$item.pid)
                $state=if($identity.creationId -ne $item.creationId){'pid-reused'}elseif($identity.alive){'alive'}else{'exited'}
            } catch { if ((Stable-Code $_) -eq 'EXECUTOR_PROCESS_NOT_FOUND') { $state='exited' } }
            $tracked.Add(@{pid=[int]$item.pid;creationId=[string]$item.creationId;state=$state})
        }
        Emit @{version=1;kind='result';requestId=$request.requestId;parent=$parent;target=$target;targetError=$targetError;descendants=@($descendants);tracked=@($tracked);snapshotComplete=$complete}
    }
} catch { Emit @{version=1;kind='fatal';code=(Stable-Code $_)}; exit 1 }
