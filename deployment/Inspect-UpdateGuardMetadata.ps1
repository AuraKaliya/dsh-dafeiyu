# Read-only, bounded hash comparison for the existing guard. No application module is imported.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$guardRoot = 'C:\DSH\DaFeiYu\程序\update-guard'
$names = @('package.json','cli.mjs','client.mjs','control.ps1','cordis.patch.yml','daemon.mjs','engine.mjs','files.mjs','platform.mjs','store.mjs','tools.mjs','validate.mjs','guard.test.mjs')
$watch = [Diagnostics.Stopwatch]::StartNew()
$files = [Collections.Generic.List[object]]::new()
foreach ($name in $names) {
    if ($watch.ElapsedMilliseconds -gt 15000) { throw 'GUARD_INSPECTION_DEADLINE' }
    $path = [IO.Path]::GetFullPath((Join-Path $guardRoot $name))
    if (!(Split-Path -Parent $path).Equals($guardRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'GUARD_INSPECTION_PATH' }
    $cursor = $path
    while ($cursor -and $cursor -ne [IO.Path]::GetPathRoot($cursor)) {
        if (Test-Path -LiteralPath $cursor) {
            $entry = Get-Item -LiteralPath $cursor -Force
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'GUARD_INSPECTION_REPARSE' }
        }
        $cursor = Split-Path -Parent $cursor
    }
    if (!(Test-Path -LiteralPath $path)) { $files.Add([pscustomobject]@{name=$name;status='missing'});continue }
    $item = Get-Item -LiteralPath $path -Force
    if ($item.PSIsContainer -or $item.Length -gt 131072) { throw 'GUARD_INSPECTION_SIZE' }
    $digest = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    $files.Add([pscustomobject]@{name=$name;status='present';bytes=$item.Length;sha256=$digest})
}
[pscustomobject]@{schemaVersion=1;kind='update-guard-public-file-hashes';observedAt=(Get-Date).ToString('o');root=$guardRoot;files=@($files.ToArray());elapsedMs=$watch.ElapsedMilliseconds;
    applicationExecuted=$false;dataRead=$false;databaseOpened=$false;remoteFilesWritten=$false;activeUpdateChecked=$false} | ConvertTo-Json -Depth 5 -Compress
