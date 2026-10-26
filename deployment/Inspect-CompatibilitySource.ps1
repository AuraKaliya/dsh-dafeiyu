# Static legacy-source inspection only. Invoke through the approved remote wrapper with ScriptPath.
# Never dot-source, import, instantiate, invoke, or copy an inspected application into an executable tree.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ProductRoot = 'C:\DSH\DaFeiYu'
$MaxFiles = 20
$MaxFileBytes = 131072
$MaxTotalBytes = 1048576
$DeadlineMs = 45000
$ReadDeadlineMs = 42000
$clock = [Diagnostics.Stopwatch]::StartNew()
$planned = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$queue = [Collections.Generic.List[object]]::new()
$files = [Collections.Generic.List[object]]::new()
$issues = [Collections.Generic.List[object]]::new()
$script:readBytes = 0L
$script:outputBytes = 0L
$script:openedFiles = 0
$script:deadlineHit = $false
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$regexTimeout = [TimeSpan]::FromMilliseconds(150)
$secretAssignment = [regex]::new('(?i)(?:api[_-]?key|access[_-]?(?:token|key)|refresh[_-]?token|auth[_-]?(?:token|key)|password|passwd|secret|cookie|authorization|credential|sessdata|bili[_-]?jct|buvid[234]?|private[_-]?key|(?:^|[^a-z])(?:token|key))[a-z0-9_-]*["'']?\s*(?:=|:)', [Text.RegularExpressions.RegexOptions]::None, $regexTimeout)
$knownSecret = [regex]::new('(?i)\b(?:sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|AIza[a-z0-9_-]{25,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b|\bBearer\s+[a-z0-9._~+/=-]+|\beyJ[a-z0-9_-]{8,}\.eyJ[a-z0-9_-]{8,}\.[a-z0-9_-]+|https?://[^/\s:@]+:[^@\s/]+@|["''\x60][a-z0-9+/=_-]{40,}["''\x60]', [Text.RegularExpressions.RegexOptions]::None, $regexTimeout)
$pemBegin = [regex]::new('-----BEGIN [A-Z0-9 -]{1,70}-----', [Text.RegularExpressions.RegexOptions]::None, $regexTimeout)
$pemEnd = [regex]::new('-----END [A-Z0-9 -]{1,70}-----', [Text.RegularExpressions.RegexOptions]::None, $regexTimeout)

function Check-Deadline {
    if ($clock.ElapsedMilliseconds -ge $ReadDeadlineMs) { $script:deadlineHit = $true; throw 'INSPECTION_DEADLINE' }
}
function Add-Issue([string]$code, [string]$relative) {
    if ($issues.Count -lt 60) { $issues.Add([pscustomobject]@{code=$code; relative=$relative}) }
}
function Relative-ToRoot([string]$path) {
    if ($path.StartsWith($ProductRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { return $path.Substring($ProductRoot.Length + 1).Replace('\','/') }
    return $null
}
function Normalize-PublicPath([string]$path) {
    try {
        if (!$path -or $path.Length -gt 2000 -or $path -match '[\x00-\x1f]' -or $path -match '^[\\/]{2}' -or $knownSecret.IsMatch($path)) { return $null }
        $full = [IO.Path]::GetFullPath($path)
        if (!(Relative-ToRoot $full) -or $full.Substring(2) -match ':') { return $null }
        $relative = Relative-ToRoot $full
        if ($relative -notmatch '^(程序|配置文件)/') { return $null }
        if ($relative -match '(?i)(^|/)(运行状态|运行数据|人格|共享记忆库|历史记录|凭据|credentials?|secrets?|sessions?|storages|logs?|history|archives?|memory|personas?|cache|tmp|temp|data|state|\.git|\.runtime)(/|$)|(^|/)\.env(?:[./]|$)|\.(sqlite(?:3)?|db|jsonl(?:\.zstd)?|pem|key|pfx|p12)$') { return $null }
        if ($relative -match '(?i)(^|/)[^/]*(?:credentials?|\.session|cookie|login-state)[^/]*\.(?:json|yaml|yml|txt)$') { return $null }
        return $full
    } catch { return $null }
}
function Resolve-PublicPath([string]$requested) {
    $current = Normalize-PublicPath $requested
    if (!$current) { return [pscustomobject]@{status='refused'; code='non-public-path'; file=$null} }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    for ($hop=0; $hop -lt 10; $hop++) {
        Check-Deadline
        if (!$seen.Add($current)) { return [pscustomobject]@{status='refused'; code='link-cycle'; file=$null} }
        # Inspect ancestors from the volume root downward. Never inspect a private target's descendants.
        $drive = [IO.Path]::GetPathRoot($current)
        $parts = $current.Substring($drive.Length).Split('\')
        $cursor = $drive
        $redirected = $false
        for ($i=0; $i -lt $parts.Length; $i++) {
            Check-Deadline
            $cursor = Join-Path $cursor $parts[$i]
            try { $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop }
            catch { return [pscustomobject]@{status='missing'; code='missing-or-unavailable'; file=$null} }
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                $targets = @($item.Target)
                if ($targets.Count -ne 1 -or !$targets[0]) { return [pscustomobject]@{status='refused'; code='unresolved-reparse-point'; file=$null} }
                $target = ([string]$targets[0]) -replace '^\\\?\?\\',''
                if ($target -match '^\\\\\?\\') { $target = $target.Substring(4) }
                if (![IO.Path]::IsPathRooted($target)) { $target = Join-Path (Split-Path -Parent $cursor) $target }
                if ($i + 1 -lt $parts.Length) { $target = Join-Path $target ([string]::Join('\', $parts[($i+1)..($parts.Length-1)])) }
                $current = Normalize-PublicPath $target
                if (!$current) { return [pscustomobject]@{status='refused'; code='private-or-external-link-target'; file=$null} }
                $redirected = $true
                break
            }
        }
        if (!$redirected) { return [pscustomobject]@{status='ready'; code=$null; file=$current} }
    }
    return [pscustomobject]@{status='refused'; code='link-depth-limit'; file=$null}
}
function Hash-Bytes([byte[]]$bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function Decode-Text([byte[]]$bytes) {
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) { $text = $utf8.GetString($bytes,3,$bytes.Length-3) }
    elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 255 -and $bytes[1] -eq 254) { $text = ([Text.UnicodeEncoding]::new($false,$false,$true)).GetString($bytes,2,$bytes.Length-2) }
    elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 254 -and $bytes[1] -eq 255) { $text = ([Text.UnicodeEncoding]::new($true,$false,$true)).GetString($bytes,2,$bytes.Length-2) }
    else { $text = $utf8.GetString($bytes) }
    if ($text.IndexOf([char]0) -ge 0) { throw 'SOURCE_NOT_TEXT' }
    return $text
}
function Read-BoundedText([string]$relative,[string]$kind) {
    Check-Deadline
    $resolved = Resolve-PublicPath (Join-Path $ProductRoot $relative.Replace('/','\'))
    if ($resolved.status -ne 'ready') { return [pscustomobject]@{status=$resolved.status; code=$resolved.code} }
    $physicalRelative=Relative-ToRoot $resolved.file
    if ($kind -eq 'source' -and $physicalRelative -notmatch '^程序/.+\.(?:mjs|cjs|js|ps1)$') { return [pscustomobject]@{status='refused'; code='source-target-kind-mismatch'} }
    if ($kind -eq 'package' -and $physicalRelative -notmatch '^程序/.+/package\.json$') { return [pscustomobject]@{status='refused'; code='package-target-kind-mismatch'} }
    if ($kind -in @('layout','bridge','bili') -and ![string]::Equals($physicalRelative,$relative,[StringComparison]::OrdinalIgnoreCase)) { return [pscustomobject]@{status='refused'; code='config-target-kind-mismatch'} }
    $stream = $null
    try {
        $info = Get-Item -LiteralPath $resolved.file -Force
        if ($info.PSIsContainer -or $info.Length -gt $MaxFileBytes) { return [pscustomobject]@{status='refused'; code='per-file-size-limit'} }
        if ($script:openedFiles -ge $MaxFiles -or $script:readBytes + $info.Length -gt $MaxTotalBytes) { return [pscustomobject]@{status='skipped'; code='read-budget-limit'} }
        Check-Deadline
        $stream = [IO.File]::Open($resolved.file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        $again = Resolve-PublicPath (Join-Path $ProductRoot $relative.Replace('/','\'))
        if ($again.status -ne 'ready' -or ![string]::Equals($again.file,$resolved.file,[StringComparison]::OrdinalIgnoreCase)) { throw 'SOURCE_PATH_CHANGED' }
        if ($stream.Length -ne $info.Length -or $stream.Length -gt $MaxFileBytes) { throw 'SOURCE_SIZE_CHANGED' }
        $script:openedFiles++
        $bytes = New-Object byte[] ([int]$stream.Length)
        $offset = 0
        while ($offset -lt $bytes.Length) {
            Check-Deadline
            $pending = $stream.ReadAsync($bytes,$offset,[Math]::Min(8192,$bytes.Length-$offset))
            $remaining = [Math]::Max(1,$ReadDeadlineMs-[int]$clock.ElapsedMilliseconds)
            if (!$pending.Wait($remaining)) { $script:deadlineHit=$true; throw 'INSPECTION_DEADLINE' }
            $count = $pending.GetAwaiter().GetResult()
            if ($count -le 0) { throw 'SOURCE_SIZE_CHANGED' }
            $offset += $count
            $script:readBytes += $count
        }
        Check-Deadline
        $last = Resolve-PublicPath (Join-Path $ProductRoot $relative.Replace('/','\'))
        if ($last.status -ne 'ready' -or ![string]::Equals($last.file,$resolved.file,[StringComparison]::OrdinalIgnoreCase)) { throw 'SOURCE_PATH_CHANGED' }
        $hash = Hash-Bytes $bytes
        $text = Decode-Text $bytes
        return [pscustomobject]@{status='read'; code=$null; resolvedRelative=(Relative-ToRoot $resolved.file); bytes=$bytes.Length; sha256=$hash; text=$text}
    } catch {
        $code='source-read-failed'
        if ($script:deadlineHit) { $code='deadline'; }
        elseif ($_.Exception.Message -match '^SOURCE_[A-Z_]+$') { $code=$_.Exception.Message.ToLowerInvariant().Replace('_','-') }
        return [pscustomobject]@{status='refused'; code=$code}
    } finally { if ($stream) { $stream.Dispose() } }
}
function Redact-Source([string]$text) {
    $lines = [regex]::Split($text,"\r\n|\n|\r")
    $redactions = [Collections.Generic.List[object]]::new()
    $safe = [Collections.Generic.List[string]]::new()
    $pem = $false
    $whole = $false
    for ($i=0; $i -lt $lines.Length; $i++) {
        Check-Deadline
        $line = $lines[$i]
        $reason = $null
        try {
            if ($pemBegin.IsMatch($line)) { $pem=$true }
            if ($pem) { $reason='pem-block'; if ($pemEnd.IsMatch($line)) { $pem=$false } }
            elseif ($secretAssignment.IsMatch($line)) {
                $reason='credential-like-assignment'
                # A split/continued value cannot be safely trimmed by a line-only scanner.
                if ($line -match '[=:\[\(\+\\]\s*$' -or ([regex]::Matches($line,'(?<!\\)\x60').Count % 2) -ne 0) { $whole=$true; $reason='credential-multiline-ambiguity' }
            }
            elseif ($knownSecret.IsMatch($line)) { $reason='credential-like-literal' }
        } catch [Text.RegularExpressions.RegexMatchTimeoutException] { $whole=$true; $reason='redaction-pattern-timeout' }
        if ($reason) {
            if ($redactions.Count -lt 256) { $redactions.Add([pscustomobject]@{line=($i+1); code=$reason}) }
            $safe.Add('[REDACTED: '+$reason+']')
        } else { $safe.Add($line) }
    }
    if ($whole) { $source='[SOURCE OMITTED: possible multi-line credential or ambiguous secret pattern]' }
    else { $source=[string]::Join([Environment]::NewLine,$safe) }
    return [pscustomobject]@{source=$source; redacted=($redactions.Count -gt 0); wholeFileRedacted=$whole; redactions=@($redactions); redactionRecordsLimitedTo=256}
}
function Safe-Uid($value) {
    if ($value -is [double] -or $value -is [single]) { if ([Math]::Abs($value) -gt 9007199254740991 -or [Math]::Floor($value) -ne $value) { return $null } }
    $text=[string]$value
    if ($text -match '^[1-9][0-9]{0,19}$') { return $text }
    return $null
}
function Safe-Bool($value) { if ($value -is [bool]) { return $value }; return $null }
function Safe-Int($value,[int]$maximum) {
    if ($null -ne $value -and [string]$value -match '^\d{1,2}$') { $n=[int]$value; if ($n -ge 0 -and $n -le $maximum) { return $n } }
    return $null
}
function Safe-Day($value) {
    $text=[string]$value
    if ($text -match '^\d{4}-\d{2}-\d{2}$') { $parsed=[datetime]::MinValue; if ([datetime]::TryParseExact($text,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$parsed)) { return $text } }
    return $null
}
function Safe-DataPath($value) {
    try {
        $text=[string]$value
        if (!$text -or $text.Length -gt 1000 -or $text -match '[\x00-\x1f]' -or $text -match '^[\\/]{2}' -or $knownSecret.IsMatch($text)) { return $null }
        if (![IO.Path]::IsPathRooted($text)) { $text=Join-Path $ProductRoot $text }
        $full=[IO.Path]::GetFullPath($text)
        if ($full -match '^(?i)C:\\DSH(?:\\|$)' -and $full.Substring(2) -notmatch ':') { return $full }
    } catch { }
    return $null
}
function Project-Config($data,[string]$kind) {
    if ($kind -eq 'layout') {
        $paths=[ordered]@{}; foreach ($name in @('core','usage','maintenanceRules','preferences','recentStateAndRelations','users','launcher')) { $paths[$name]=Safe-DataPath $data.paths.$name }
        $runtime=[ordered]@{}; foreach ($name in @('cliProfile','cliHome','desktopProfile','desktopHome','bridgeConfig','program')) { $runtime[$name]=Safe-DataPath $data.runtime.$name }
        return [pscustomobject]@{ownerQQ=(Safe-Uid $data.authority.ownerQQ); botQQ=(Safe-Uid $data.authority.botQQ); dataPaths=$paths; runtimePaths=$runtime; maintenanceRoot=(Safe-DataPath $data.maintenanceRoot)}
    }
    if ($kind -eq 'bridge') { return [pscustomobject]@{versioning=@{enabled=(Safe-Bool $data.versioning.enabled); firstDay=(Safe-Day $data.versioning.firstDay)}; memorySchedule=@{hour=(Safe-Int $data.memory.dailyHour 23); minute=(Safe-Int $data.memory.dailyMinute 59)}} }
    $paths=[ordered]@{}; foreach ($name in @('dataDir','stateFile','auditFile','historyRoot')) { $paths[$name]=Safe-DataPath $data.$name }
    return [pscustomobject]@{accountUid=(Safe-Uid $data.accountUid); ownerUid=(Safe-Uid $data.ownerUid); dataPaths=$paths}
}
function Safe-Main($value,[string]$packageRoot) {
    $text=([string]$value).Replace('\','/')
    if ($text.StartsWith('./')) { $text=$text.Substring(2) }
    if (!$text -or $text.Length -gt 240 -or $text -notmatch '^[a-zA-Z0-9_./-]+\.(?:mjs|cjs|js|ps1)$' -or $text -match '(^|/)\.\.?(/|$)' -or $text.StartsWith('/') -or $knownSecret.IsMatch($text)) { return $null }
    return ($packageRoot+'/'+$text)
}
function Plan-File([string]$relative,[string]$kind,[string]$packageRoot='') {
    if ($planned.Contains($relative)) { return }
    if ($queue.Count -ge $MaxFiles) { Add-Issue 'file-limit-followup-required' $relative; return }
    [void]$planned.Add($relative)
    $queue.Add([pscustomobject]@{relative=$relative; kind=$kind; packageRoot=$packageRoot})
}

Plan-File '程序/qq-bridge-v073/package.json' 'package' '程序/qq-bridge-v073'
Plan-File '程序/qq-bridge-v073/lib/host-v072.mjs' 'source'
foreach ($name in @('persona-memory','shared-memory','nightly-cycle','version-manager','history-store')) { Plan-File ('程序/qq-bridge-v073/lib/'+$name+'.mjs') 'source' }
Plan-File '程序/bili-lite/package.json' 'package' '程序/bili-lite'
foreach ($name in @('index.js','dm-worker.mjs','account.mjs','auth.mjs')) { Plan-File ('程序/bili-lite/'+$name) 'source' }
Plan-File '程序/update-guard/package.json' 'package' '程序/update-guard'
foreach ($name in @('client.mjs','platform.mjs','control.ps1')) { Plan-File ('程序/update-guard/'+$name) 'source' }
Plan-File '配置文件/layout.json' 'layout'
Plan-File '配置文件/bridge.json' 'bridge'
Plan-File '配置文件/bilibili.json' 'bili'

for ($index=0; $index -lt $queue.Count; $index++) {
    $entry=$queue[$index]
    if ($script:deadlineHit -or $clock.ElapsedMilliseconds -ge $ReadDeadlineMs) { $script:deadlineHit=$true; $files.Add([pscustomobject]@{relative=$entry.relative; kind=$entry.kind; status='skipped'; code='deadline'}); continue }
    try {
        $read=Read-BoundedText $entry.relative $entry.kind
        if ($read.status -ne 'read') { $files.Add([pscustomobject]@{relative=$entry.relative; kind=$entry.kind; status=$read.status; code=$read.code}); continue }
        $result=[ordered]@{relative=$entry.relative; resolvedRelative=$read.resolvedRelative; kind=$entry.kind; status='read'; bytes=$read.bytes; sha256=$read.sha256}
        if ($entry.kind -in @('layout','bridge','bili')) {
            try { $result.projection=Project-Config ($read.text | ConvertFrom-Json) $entry.kind }
            catch { $result.status='invalid-public-config'; $result.code='json-projection-failed' }
        } else {
            $redacted=Redact-Source $read.text
            $result.source=$redacted.source; $result.redacted=$redacted.redacted; $result.wholeFileRedacted=$redacted.wholeFileRedacted; $result.redactions=$redacted.redactions; $result.redactionRecordsLimitedTo=256
            if ($entry.kind -eq 'package') {
                try {
                    $package=$read.text | ConvertFrom-Json
                    $main=Safe-Main $package.main $entry.packageRoot
                    $result.package=@{name=$(if ([string]$package.name -match '^(?:@[a-z0-9._-]+/)?[a-z0-9._-]{1,150}$' -and !$knownSecret.IsMatch([string]$package.name)) {[string]$package.name} else {$null}); version=$(if ([string]$package.version -match '^[0-9]+(?:\.[0-9]+){2}(?:[-+][A-Za-z0-9.-]+)?$') {[string]$package.version} else {$null}); declaredMain=$main}
                    if ($main -and !$planned.Contains($main)) {
                        if ($entry.packageRoot -eq '程序/qq-bridge-v073' -and $queue.Count -lt $MaxFiles) {
                            [void]$planned.Add($main)
                            $queue.Insert($index+1,[pscustomobject]@{relative=$main; kind='source'; packageRoot=''})
                        } else { Add-Issue 'declared-main-followup-required' $main }
                    }
                } catch { $result.package=@{code='package-metadata-invalid'} }
            }
        }
        $encoded=$result | ConvertTo-Json -Depth 8 -Compress
        $size=[Text.Encoding]::UTF8.GetByteCount($encoded)
        if ($script:outputBytes + $size -gt $MaxTotalBytes-65536) { $result.Remove('source'); $result.Remove('redactions'); $result.status='source-omitted-output-limit'; $size=[Text.Encoding]::UTF8.GetByteCount(($result | ConvertTo-Json -Depth 8 -Compress)) }
        $script:outputBytes += $size
        $files.Add([pscustomobject]$result)
    } catch {
        $code='inspection-failed'
        if ($script:deadlineHit) { $code='deadline' }
        $files.Add([pscustomobject]@{relative=$entry.relative; kind=$entry.kind; status='refused'; code=$code})
    }
}
$report=[ordered]@{schemaVersion=1; kind='legacy-compatibility-source-v1'; mode='static-read-only'; productRoot=$ProductRoot; observedAt=[datetimeoffset]::UtcNow.ToString('o');
    limits=@{files=$MaxFiles; bytesPerFile=$MaxFileBytes; totalReadBytes=$MaxTotalBytes; totalOutputBytes=$MaxTotalBytes; deadlineMs=$DeadlineMs; dataReadDeadlineMs=$ReadDeadlineMs};
    counts=@{planned=$queue.Count; opened=$script:openedFiles; bytesRead=$script:readBytes}; elapsedMs=$clock.ElapsedMilliseconds; deadlineReached=$script:deadlineHit;
    applicationCodeExecuted=$false; databaseOpened=$false; privateDataFileRead=$false; recursiveScan=$false; executableMirrorCreated=$false;
    redactionPolicy='conservative assignment/literal lines, PEM blocks, whole-file omission for multiline ambiguity; false positives possible';
    files=@($files); issues=@($issues)}
$serialized=$report | ConvertTo-Json -Depth 12 -Compress
if ([Text.Encoding]::UTF8.GetByteCount($serialized) -gt $MaxTotalBytes) {
    foreach ($entry in $files) {
        if ($entry.PSObject.Properties['source']) { $entry.PSObject.Properties.Remove('source'); $entry.PSObject.Properties.Remove('redactions'); $entry.status='source-omitted-output-limit' }
    }
    $report.elapsedMs=$clock.ElapsedMilliseconds
    $serialized=$report | ConvertTo-Json -Depth 12 -Compress
}
$serialized
