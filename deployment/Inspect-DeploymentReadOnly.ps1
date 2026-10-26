# First-pass public metadata only. Run through Invoke-Server.ps1 with ScriptPath only.
# Do not dot-source launchers, import application modules, or run DSH/npm/guard commands.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = 'C:\DSH\DaFeiYu'
$issues = [Collections.Generic.List[object]]::new()
$packageFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$packages = [Collections.Generic.List[object]]::new()

function Add-Issue([string]$section, [string]$code) { $issues.Add([pscustomobject]@{section=$section; code=$code}) }
function Safe-Id($value) { if ($null -ne $value -and [string]$value -match '^[\p{L}0-9@._/\-]{1,180}$') { return [string]$value }; return $null }
function Safe-PackageName($value) { if ([string]$value -match '^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]{0,159}$') { return [string]$value }; return $null }
function Safe-Account($value) { if ($null -ne $value -and [string]$value -match '^[\p{L}0-9_ .\\$@\-]{1,180}$') { return [string]$value }; return $null }
function Safe-Date($value) { try { return ([datetimeoffset]::Parse([string]$value)).ToString('o') } catch { return $null } }
function Safe-Number($value) { if ($value -is [ValueType] -and $value -isnot [bool]) { return $value }; return $null }
function Safe-Bool($value) { if ($value -is [bool]) { return $value }; return $null }
function Safe-AccountId($value) { if ([string]$value -match '^[1-9][0-9]{0,19}$') { return [string]$value }; return $null }
function Safe-Path($value, [string]$base = $root) {
    try {
        $text = [string]$value
        if (!$text -or $text -match '[\x00-\x1f]' -or $text -match '^[\\/]{2}') { return $null }
        if (![IO.Path]::IsPathRooted($text)) { $text = Join-Path $base $text }
        $full = [IO.Path]::GetFullPath($text)
        if ($full -match '^(?i)C:\\DSH(?:\\|$)' -and $full.Substring(2) -notmatch ':') { return $full }
    } catch { }
    return $null
}
function Public-File([string]$file) {
    $current = Safe-Path $file
    for ($hop = 0; $current -and $hop -lt 12; $hop++) {
        if ($current -match '(?i)[\\/](凭据|credentials?|secrets?|sessions?|历史记录|人格|共享记忆库)([\\/]|$)' -or $current -match '(?i)[\\/]\.env(?:[./\\]|$)') { return $null }
        $cursor = $current; $redirected = $false
        while ($cursor -and $cursor.Length -gt 3) {
            try { $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop } catch { return $null }
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                $targets = @($item.Target)
                if ($targets.Count -ne 1 -or !$targets[0]) { return $null }
                $target = ([string]$targets[0]) -replace '^\\\?\?\\', ''
                $target = Safe-Path $target (Split-Path -Parent $cursor)
                if (!$target) { return $null }
                $current = Safe-Path ($target.TrimEnd('\') + $current.Substring($cursor.Length))
                $redirected = $true; break
            }
            $cursor = Split-Path -Parent $cursor
        }
        if (!$redirected) { return $current }
    }
    return $null
}
function Read-PublicJson([string]$file) {
    $resolved = Public-File $file
    if (!$resolved) { return $null }
    try {
        $item = Get-Item -LiteralPath $resolved -ErrorAction Stop
        if ($item.PSIsContainer -or $item.Length -gt 1048576) { Add-Issue 'json' 'invalid-size'; return $null }
        return (Get-Content -LiteralPath $resolved -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch { Add-Issue 'json' 'unavailable-or-invalid'; return $null }
}
function Safe-Specifier($value, [string]$base) {
    $text = [string]$value
    if ($text -match '^(?:workspace:)?[~^<>=0-9vVxX*|. \-]{1,100}$' -or $text -in @('latest','next')) { return $text }
    if ($text -match '^(link|file):(.+)$') {
        $kind = $Matches[1]; $target = Safe-Path $Matches[2] $base
        if ($target) { return ($kind + ':' + $target) }; return ($kind + ':<outside-approved-root>')
    }
    if ($text -match '^npm:(@?[a-z0-9._-]+(?:/[a-z0-9._-]+)?)@([~^<>=0-9vVxX*|. \-]{1,100})$') { return $text }
    return '<unrecognized-specifier-omitted>'
}
function Package-Metadata([string]$file, [string]$evidence) {
    if (!$packageFiles.Add($file)) { return }
    $data = Read-PublicJson $file
    if (!$data) { return }
    $name = Safe-PackageName $data.name; if (!$name) { Add-Issue 'package' 'invalid-name'; return }
    $dependencies = [Collections.Generic.List[object]]::new()
    foreach ($kind in @('dependencies','optionalDependencies','peerDependencies')) {
        foreach ($property in @($data.$kind.PSObject.Properties)) {
            if ($property -and (Safe-PackageName $property.Name)) { $dependencies.Add([pscustomobject]@{name=$property.Name; kind=$kind; specifier=(Safe-Specifier $property.Value (Split-Path -Parent $file))}) }
        }
    }
    $packages.Add([pscustomobject]@{path=$file; resolvedPath=(Public-File $file); name=$name; version=(Safe-Id $data.version); main=(Safe-Path $data.main (Split-Path -Parent $file)); evidence=$evidence; originClass='unknown'; dependencies=@($dependencies | Select-Object -First 200); dependenciesTruncated=($dependencies.Count -gt 200)})
}
function Profile-Metadata([string]$directory) {
    $data = Read-PublicJson (Join-Path $directory 'package.json')
    Package-Metadata (Join-Path $directory 'package.json') 'profile-declaration'
    $declarations = [Collections.Generic.List[object]]::new(); $current = $null; $indent = 2; $insert = $false
    $patch = Public-File (Join-Path $directory 'cordis.patch.yml')
    if ($patch) {
        try {
            if ((Get-Item -LiteralPath $patch).Length -gt 1048576) { throw 'bounded' }
            foreach ($line in [IO.File]::ReadLines($patch)) {
                if ($line -match '^\S') { $insert = $line -match '^-\s+insert:\s*$'; $current = $null }
                if ($line -match '^-\s+id:\s*([a-zA-Z0-9@._/-]+)\s*$') { $current=[pscustomobject]@{operation='patch'; id=$Matches[1]; package=$null; disabled=$null}; $indent=2; $declarations.Add($current) }
                elseif ($insert -and $line -match '^ {4}-\s+id:\s*([a-zA-Z0-9@._/-]+)\s*$') { $current=[pscustomobject]@{operation='insert'; id=$Matches[1]; package=$null; disabled=$null}; $indent=6; $declarations.Add($current) }
                elseif ($current -and $line -match ('^ {'+$indent+'}name:\s*([a-zA-Z0-9@._/-]+)\s*$')) { $current.package=$Matches[1] }
                elseif ($current -and $line -match ('^ {'+$indent+'}disabled:\s*(true|false)\s*$')) { $current.disabled=$Matches[1] -eq 'true' }
            }
        } catch { Add-Issue 'profile-patch' 'unavailable-or-invalid' }
    }
    $links = [Collections.Generic.List[object]]::new()
    foreach ($dependency in @($data.dependencies.PSObject.Properties)) {
        if (!$dependency -or !(Safe-PackageName $dependency.Name)) { continue }
        $module = Join-Path (Join-Path $directory 'node_modules') $dependency.Name
        try { $item=Get-Item -LiteralPath $module -Force; $targets=@($item.Target | ForEach-Object { Safe-Path $_ (Split-Path -Parent $module) }); $links.Add([pscustomobject]@{name=$dependency.Name; linkType=(Safe-Id $item.LinkType); targets=$targets}) } catch { }
        Package-Metadata (Join-Path $module 'package.json') 'profile-resolved-package'
    }
    return [pscustomobject]@{path=$directory; packagePresent=($null -ne $data); bundles=@($data.dsh.profile.bundles | ForEach-Object { Safe-PackageName $_ }); patchPresent=($null -ne $patch); moduleDeclarations=@($declarations); declarationParser='limited-unquoted-id-name-disabled-only'; resolvedModules=@($links); actualActivation='not-proven-by-declarations'}
}
function Action-Entry($action) {
    $execute = Safe-Path $action.Execute
    if (!$execute -and [string]$action.Execute -match '^(?i)C:\\Windows\\System32\\(?:WindowsPowerShell\\v1\.0\\powershell|cmd)\.exe$') { $execute=[string]$action.Execute }
    $arguments = [string]$action.Arguments; $entry=$null
    if ($arguments -match '(?i)(?:^|\s)-File\s+(?:"([^"\r\n]+\.ps1)"|([^\s]+\.ps1))(?:\s|$)') { $entry=Safe-Path ($Matches[1]+$Matches[2]) }
    elseif ($arguments -match '^\s*(?:"(C:[^"\r\n]+\.(?:mjs|js|ps1))"|(C:[^\s]+\.(?:mjs|js|ps1)))(?:\s|$)') { $entry=Safe-Path ($Matches[1]+$Matches[2]) }
    return [pscustomobject]@{execute=$execute; script=$entry; workingDirectory=(Safe-Path $action.WorkingDirectory); argumentsOmitted=$true}
}
function Git-Read([string]$command) {
    $git = Public-File 'C:\DSH\runtime\git\cmd\git.exe'; if (!$git) { return $null }
    $start=[Diagnostics.ProcessStartInfo]::new(); $start.FileName=$git
    $start.Arguments='--no-optional-locks -c core.fsmonitor=false -c submodule.recurse=false -C "C:\DSH\DaFeiYu" '+$command
    $start.UseShellExecute=$false; $start.CreateNoWindow=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
    foreach ($name in @($start.EnvironmentVariables.Keys | Where-Object { $_ -like 'GIT_*' })) { $start.EnvironmentVariables.Remove($name) }
    $process=$null
    try { $process=[Diagnostics.Process]::Start($start); $output=$process.StandardOutput.ReadToEndAsync(); $discard=$process.StandardError.ReadToEndAsync()
        if (!$process.WaitForExit(10000)) { $process.Kill(); Add-Issue 'git' 'timeout'; return $null }
        if ($process.ExitCode -ne 0) { return $null }; return $output.Result
    } catch { Add-Issue 'git' 'unavailable'; return $null } finally { if ($process) { $process.Dispose() } }
}
function Git-PathClass([string]$relative) {
    $p=$relative.Replace('\','/')
    if ($p -match '[\x00-\x1f]' -or $p -match '(^|/)\.\.?(/|$)' -or $p.StartsWith('/')) { return 'unclassified' }
    if ($p -match '^(人格|共享记忆库|历史记录|运行状态)/|^程序/(update-guard|maintenance)/|(^|/)(凭据|credentials?|secrets?|sessions?)(/|$)|(^|/)\.env(?:[./]|$)') { return 'protected' }
    if ($p -match '^(程序|packages|scripts|tests)/' -or $p -match '^(package(?:-lock)?\.json|AGENTS\.md|\.gitignore)$') { return 'code' }
    if ($p -match '^配置文件/(layout\.json|bridge\.json|bilibili\.json|Start-DaFeiYu\.ps1|Invoke-Dsh\.ps1)$|^配置文件/dsh(?:-cli)?-profiles/(desktop|headless)/(package\.json|cordis\.patch\.yml)$') { return 'public-config' }
    return 'unclassified'
}

$report=[ordered]@{schemaVersion=1; observedAt=[datetimeoffset]::UtcNow.ToString('o'); mode='read-only-public-metadata'; productRoot=$root; limitations=@('process elevation/token not inspected','current QQ/Bili login not queried','guard SQLite not opened','package origin and complete dependency closure need separate confirmation','module declarations do not prove activation')}
try {
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $report.connectionIdentity=@{account=(Safe-Account $identity.Name); administratorGroup=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)}
    $processes=[Collections.Generic.List[object]]::new()
    foreach ($p in @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe','DSH Desktop.exe') })) {
        $exe=Safe-Path $p.ExecutablePath; if (!$exe) { continue }; $owner=$null; $version=$null
        try { $o=Invoke-CimMethod -InputObject $p -MethodName GetOwner; if ($o.ReturnValue -eq 0) { $owner=Safe-Account ($o.Domain+'\'+$o.User) } } catch { Add-Issue 'process-owner' 'unavailable' }
        try { $v=(Get-Item -LiteralPath $exe).VersionInfo; $version=Safe-Id $v.ProductVersion } catch { }
        $processes.Add([pscustomobject]@{pid=$p.ProcessId; parentPid=$p.ParentProcessId; name=$p.Name; executable=$exe; owner=$owner; productVersion=$version; createdAt=(Safe-Date $p.CreationDate)})
    }
    $report.processes=@($processes)
} catch { Add-Issue 'processes' 'unavailable' }
try {
    $tasks=[Collections.Generic.List[object]]::new()
    foreach ($task in @(Get-ScheduledTask | Where-Object { $_.TaskName -match '^(DSH|DaFeiYu)[-A-Za-z0-9_]*$' } | Select-Object -First 50)) {
        $info=Get-ScheduledTaskInfo -InputObject $task
        $tasks.Add([pscustomobject]@{name=$task.TaskName; state=[string]$task.State; principal=(Safe-Account $task.Principal.UserId); logonType=[string]$task.Principal.LogonType; runLevel=[string]$task.Principal.RunLevel; actions=@($task.Actions | ForEach-Object { Action-Entry $_ }); lastResult=$info.LastTaskResult; lastRun=(Safe-Date $info.LastRunTime)})
    }; $report.scheduledTasks=@($tasks)
} catch { Add-Issue 'scheduled-tasks' 'unavailable' }
try {
    foreach ($file in @('C:\DSH\app\package.json','C:\DSH\app\node_modules\@deepseek-ai\dsh\package.json','C:\DSH\desktop-app\resources\app\package.json')) { Package-Metadata $file 'known-install-location' }
    foreach ($dir in @(Get-ChildItem -LiteralPath (Join-Path $root '程序') -Directory -ErrorAction Stop | Select-Object -First 100)) { Package-Metadata (Join-Path $dir.FullName 'package.json') 'program-directory' }
    $report.profiles=@(@('配置文件\dsh-profiles\desktop','配置文件\dsh-cli-profiles\headless','运行状态\dsh-desktop\profiles\desktop','运行状态\dsh-cli\profiles\headless') | ForEach-Object { Profile-Metadata (Join-Path $root $_) })
    $report.packages=@($packages)
} catch { Add-Issue 'packages-profiles' 'unavailable' }
try {
    $layout=Read-PublicJson (Join-Path $root '配置文件\layout.json'); $paths=[ordered]@{}
    foreach ($key in @('core','usage','maintenanceRules','preferences','recentStateAndRelations','users','launcher')) { $paths[$key]=Safe-Path $layout.paths.$key }
    $runtimePaths=[ordered]@{}; foreach ($key in @('cliProfile','cliHome','desktopProfile','desktopHome','bridgeConfig','program')) { $runtimePaths[$key]=Safe-Path $layout.runtime.$key }
    $report.layout=@{available=($null -ne $layout); path=(Join-Path $root '配置文件\layout.json'); maintenanceRoot=(Safe-Path $layout.maintenanceRoot); paths=$paths; runtimePaths=$runtimePaths; backgroundIsInstruction=(Safe-Bool $layout.loading.backgroundIsInstruction); scopeRequired=(Safe-Bool $layout.memory.scopeRequired)}
    $bridge=Read-PublicJson (Join-Path $root '配置文件\bridge.json'); $bili=Read-PublicJson (Join-Path $root '配置文件\bilibili.json')
    $report.accounts=@{evidence='public-config-only'; qq=@{ownerQQ=(Safe-AccountId $layout.authority.ownerQQ); botQQ=(Safe-AccountId $layout.authority.botQQ); enabled=(Safe-Bool $bridge.enabled); dryRun=(Safe-Bool $bridge.dryRun); groupMode=(Safe-Id $bridge.groups.mode); configPath=(Join-Path $root '配置文件\bridge.json')}; bili=@{accountUid=(Safe-AccountId $bili.accountUid); ownerUid=(Safe-AccountId $bili.ownerUid); enabled=(Safe-Bool $bili.enabled); autoReply=(Safe-Bool $bili.privateMessages.autoReply); comments=(Safe-Bool $bili.publicInteraction.comments); danmaku=(Safe-Bool $bili.publicInteraction.danmaku); configPath=(Join-Path $root '配置文件\bilibili.json')}}
    $runtime=Read-PublicJson (Join-Path $root '运行状态\qq-bridge\runtime.json'); $report.bridgeRuntime=@{available=($null -ne $runtime); pid=(Safe-Number $runtime.pid); version=(Safe-Id $runtime.version); loadedAt=(Safe-Date $runtime.loaded_at)}
    $health=Read-PublicJson (Join-Path $root '运行状态\update-guard\health.json'); $at=Safe-Date $health.at; $age=$null; if ($at) { $age=[math]::Round(([datetimeoffset]::UtcNow-[datetimeoffset]::Parse($at)).TotalSeconds,1) }
    $report.updateGuard=@{available=($null -ne $health); enabledFlag=(Test-Path -LiteralPath (Join-Path $root '运行状态\update-guard\enabled.flag')); at=$at; ageSeconds=$age; pid=(Safe-Number $health.pid); stableId=(Safe-Id $health.stableId); activeId=(Safe-Id $health.activeId); activeStatus=(Safe-Id $health.activeStatus); lastErrorPresent=($null -ne $health.lastError); databaseChecked=$false}
} catch { Add-Issue 'public-config-health' 'unavailable' }
try {
    $head=Git-Read 'rev-parse --verify HEAD'; $branch=Git-Read 'symbolic-ref --quiet --short HEAD'; $status=Git-Read 'status --porcelain=v1 -z --untracked-files=normal --ignore-submodules=all'
    $changes=[Collections.Generic.List[object]]::new(); $counts=@{code=0; 'public-config'=0; protected=0; unclassified=0}
    if ($null -ne $status) { $records=$status.Split([char]0); for ($i=0; $i -lt $records.Length; $i++) {
        $record=$records[$i]; if ($record.Length -lt 4) { continue }; $xy=$record.Substring(0,2); $relative=$record.Substring(3); $kind=Git-PathClass $relative; $old=$null
        if ($xy -match '[RC]') { $i++; if ($i -lt $records.Length) { $old=$records[$i]; if ((Git-PathClass $old) -notin @('code','public-config')) { $kind='protected' } } }
        $counts[$kind]++; if ($kind -in @('code','public-config') -and $changes.Count -lt 200) { $changes.Add([pscustomobject]@{status=$xy; path=$relative; oldPath=$old; category=$kind}) }
    } }
    $report.git=@{available=($null -ne $head -and $null -ne $status); head=$(if ($head -and $head.Trim() -match '^[a-f0-9]{40}$') {$head.Trim()} else {$null}); branch=$(if ($branch) {Safe-Id $branch.Trim()} else {$null}); counts=$counts; changes=@($changes); changesLimitedTo=200; rawDiffRead=$false}
} catch { Add-Issue 'git' 'unavailable' }
$report.finishedAt=[datetimeoffset]::UtcNow.ToString('o'); $report.issues=@($issues)
$report | ConvertTo-Json -Depth 12
