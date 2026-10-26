# Read-only second-pass package/declaration graph. No application code is imported or run.
# Origins remain evidence labels, never permission to remove a package or a shared file.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ProductRoot = 'C:\DSH\DaFeiYu'
$MaxPackages = 700
$MaxEdges = 6000
$MaxFileBytes = 1048576
$issues = [Collections.Generic.List[object]]::new()
$queue = [Collections.Generic.Queue[object]]::new()
$nodes = @{}
$edges = @{}
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$missing = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

function Issue([string]$code) { if (!($issues | Where-Object { $_.code -eq $code })) { $issues.Add([pscustomobject]@{code=$code}) } }
function Package-Name($value) { if ([string]$value -match '^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]{0,159}$') { return [string]$value }; return $null }
function Module-Name($value) { if ([string]$value -match '^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*(?:/[a-zA-Z0-9._-]+)*$' -and [string]$value -notmatch '(^|/)\.\.?(/|$)') { return [string]$value }; return $null }
function Module-Package([string]$value) { if (!(Module-Name $value)) { return $null }; $parts=$value.Split('/'); if ($value.StartsWith('@')) { return ($parts[0]+'/'+$parts[1]) }; return $parts[0] }
function Safe-Version($value) { if ([string]$value -match '^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]{1,50})?(?:\+[a-zA-Z0-9.-]{1,30})?$') { return [string]$value }; return $null }
function Safe-Path($value, [string]$base=$ProductRoot) {
    try {
        $text=[string]$value
        if (!$text -or $text -match '[\x00-\x1f]' -or $text -match '^[\\/]{2}') { return $null }
        if (![IO.Path]::IsPathRooted($text)) { $text=Join-Path $base $text }
        $full=[IO.Path]::GetFullPath($text)
        if ($full -notmatch '^(?i)C:\\DSH(?:\\|$)' -or $full.Substring(2) -match ':') { return $null }
        if ($full -match '(?i)[\\/](凭据|credentials?|secrets?|sessions?|storages|历史记录|人格|共享记忆库)([\\/]|$)' -or $full -match '(?i)[\\/]\.env(?:[./\\]|$)') { return $null }
        if ($full -match '\\运行状态\\' -and $full -notmatch '^C:\\DSH\\DaFeiYu\\运行状态\\dsh-(desktop|cli)\\profiles\\(desktop|headless)(\\|$)') { return $null }
        return $full
    } catch { return $null }
}
function Resolve-PublicPath([string]$file) {
    $current=Safe-Path $file
    for ($hop=0; $current -and $hop -lt 12; $hop++) {
        $cursor=$current; $redirected=$false
        while ($cursor -and $cursor.Length -gt 3) {
            try { $item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop } catch { return $null }
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                $targets=@($item.Target); if ($targets.Count -ne 1 -or !$targets[0]) { return $null }
                $target=Safe-Path (([string]$targets[0]) -replace '^\\\?\?\\','') (Split-Path -Parent $cursor)
                if (!$target) { return $null }; $current=Safe-Path ($target.TrimEnd('\')+$current.Substring($cursor.Length))
                $redirected=$true; break
            }
            $cursor=Split-Path -Parent $cursor
        }
        if (!$redirected) { return $current }
    }
    return $null
}
function Public-Json([string]$file) {
    $resolved=Resolve-PublicPath $file; if (!$resolved) { return $null }
    try {
        $stat=Get-Item -LiteralPath $resolved
        if ($stat.PSIsContainer -or $stat.Length -gt $MaxFileBytes) { Issue 'metadata-size-limit'; return $null }
        return (Get-Content -LiteralPath $resolved -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch { Issue 'metadata-unavailable-or-invalid'; return $null }
}
function Safe-Specifier($value,[string]$directory) {
    $text=[string]$value
    if ($text -in @('*','latest','next','workspace:*','workspace:^','workspace:~')) { return $text }
    if ($text -match '^(?:workspace:)?[~^<>=]{0,2}v?[0-9xX*]+(?:\.[0-9xX*]+){0,2}(?:-[a-zA-Z0-9.-]{1,50})?(?:\+[a-zA-Z0-9.-]{1,30})?$') { return $text }
    if ($text -match '^(link|file):(.+)$') { $kind=$Matches[1]; $target=Safe-Path $Matches[2] $directory; if ($target) { return ($kind+':'+$target) }; return ($kind+':<path-omitted>') }
    return '<specifier-not-in-whitelist>'
}
function Relative-Entry($value) {
    $text=[string]$value
    if ($text -and $text.Length -le 300 -and $text -match '^(?:\./)?[a-zA-Z0-9_.*@/-]+$' -and $text -notmatch '(^|/)\.\.(?:/|$)' -and !$text.StartsWith('/')) { return $text }
    return $null
}
function Entry-Fields($value,[string]$selector,[int]$depth=0) {
    if ($depth -gt 6) { Issue 'export-depth-limit'; return }
    if ($value -is [string]) { $entry=Relative-Entry $value; if ($entry) { [pscustomobject]@{selector=$selector; target=$entry} }; return }
    if ($value -is [Array]) { $i=0; foreach ($entry in @($value | Select-Object -First 20)) { Entry-Fields $entry ($selector+'['+$i+']') ($depth+1); $i++ }; return }
    foreach ($property in @($value.PSObject.Properties | Select-Object -First 80)) {
        if ($property -and $property.Name -match '^[a-zA-Z0-9_./*+-]{1,160}$') { Entry-Fields $property.Value ($selector+'/'+$property.Name) ($depth+1) }
    }
}
function Find-Package([string]$directory,[string]$name) {
    if (!(Package-Name $name)) { return $null }
    $cursor=$directory
    for ($hop=0; $cursor -and $hop -lt 18; $hop++) {
        $candidate=Safe-Path (Join-Path (Join-Path $cursor 'node_modules') (Join-Path $name 'package.json'))
        if ($candidate) { $actual=Resolve-PublicPath $candidate; if ($actual) { return [pscustomobject]@{file=$actual; evidence='ancestor-node_modules'} } }
        $parent=Split-Path -Parent $cursor; if ($parent -eq $cursor -or !(Safe-Path $parent)) { break }; $cursor=$parent
    }
    # DSH bundles may be resolved by its distribution loader. A fallback is a candidate,
    # not evidence that a profile actually loaded that exact package instance.
    foreach ($base in @('C:\DSH\app','C:\DSH\desktop-app\resources\app')) {
        $candidate=Join-Path (Join-Path $base 'node_modules') (Join-Path $name 'package.json'); $actual=Resolve-PublicPath $candidate
        if ($actual) { return [pscustomobject]@{file=$actual; evidence='distribution-fallback-candidate'} }
    }
    return $null
}
function Queue-Package([string]$file,[string]$origin) {
    $actual=Resolve-PublicPath $file
    if (!$actual) { [void]$missing.Add($origin+':package-unavailable'); return }
    $key=$origin+'|'+$actual
    if ($seen.Add($key)) { $queue.Enqueue([pscustomobject]@{file=$actual; origin=$origin}) }
}
function Add-Reference($node,[string]$name,[string]$kind,$specifier) {
    $package=Module-Package $name; if (!$package) { return }
    $found=Find-Package $node.directory $package
    $key=$node.path+'|'+$kind+'|'+$name
    if (!$edges.ContainsKey($key)) {
        if ($edges.Count -ge $MaxEdges) { Issue 'dependency-edge-limit'; return }
        $edge=[pscustomobject]@{from=$node.path; requested=$name; package=$package; kind=$kind; specifier=(Safe-Specifier $specifier $node.directory); to=$(if($found){$found.file}else{$null}); resolution=$(if($found){$found.evidence}else{'unresolved'}); activationProven=$false}
        $edges[$key]=$edge; $node.references.Add($edge)
    }
}
function Read-Declarations([string]$file) {
    $actual=Resolve-PublicPath $file; if (!$actual) { return $null }
    if ([IO.Path]::GetExtension($actual) -notin @('.yml','.yaml','.json')) { return $null }
    $modules=[Collections.Generic.List[object]]::new(); $includes=[Collections.Generic.List[string]]::new(); $limited=$false
    try {
        if ((Get-Item -LiteralPath $actual).Length -gt $MaxFileBytes) { Issue 'declaration-size-limit'; return $null }
        if ([IO.Path]::GetExtension($actual) -eq '.json') {
            $value=Public-Json $actual
            foreach ($name in @($value.bundles)+@($value.include)) { if ($name -is [string] -and (Module-Name $name)) { $includes.Add($name) } }
            $items=@($value.plugins)+@($value.modules); if ($value -is [Array]) { $items=$value }
            foreach ($item in @($items | Select-Object -First 400)) {
                if ($item -is [string]) { if (Module-Name $item) { $modules.Add([pscustomobject]@{id=$null; package=$item; disabled=$null}) }; continue }
                $id=Module-Name $item.id; $name=Module-Name $item.name
                if ($id -or $name) { $modules.Add([pscustomobject]@{id=$id; package=$name; disabled=$(if($item.disabled -is [bool]){$item.disabled}else{$null})}) }
            }
            $limited=$true
        } else {
            # No YAML evaluation: only identifier scalars in module lists. All config and
            # block-scalar subtrees are skipped, so model IDs inside config are not modules.
            $current=$null; $moduleIndent=-1; $skipIndent=$null; $includeIndent=$null
            foreach ($line in [IO.File]::ReadLines($actual)) {
                if ($line -match '^\s*(?:#.*)?$') { continue }; $indent=$line.Length-$line.TrimStart().Length
                if ($null -ne $skipIndent) { if ($indent -gt $skipIndent) { continue }; $skipIndent=$null }
                if ($line -match '^\s*(?:-\s*)?(?:config|options|env|settings|parameters|context|scripts|prompt|description):' -or $line -match '^\s*(?:-\s*)?[a-zA-Z0-9_-]+:\s*[|>][+-]?\s*$') { $skipIndent=$indent; $limited=$true; continue }
                if ($line -match '^\s*(?:bundles|include):\s*$') { $includeIndent=$indent; $current=$null; continue }
                if ($null -ne $includeIndent) {
                    if ($indent -gt $includeIndent -and $line -match '^\s*-\s*["'']?([@a-zA-Z0-9._/-]+)["'']?\s*$') { if(Module-Name $Matches[1]){$includes.Add($Matches[1])}; continue }
                    if ($indent -le $includeIndent) { $includeIndent=$null }
                }
                if ($line -match '^\s*-\s*(id|name):\s*["'']?([@a-zA-Z0-9._/-]+)["'']?\s*$') {
                    $field=$Matches[1]; $value=Module-Name $Matches[2]; $current=$null
                    if ($value) { $current=[pscustomobject]@{id=$null; package=$null; disabled=$null}; if($field -eq 'id'){$current.id=$value}else{$current.package=$value}; $modules.Add($current); $moduleIndent=$indent+2 }
                } elseif ($current -and $indent -eq $moduleIndent -and $line -match '^\s*name:\s*["'']?([@a-zA-Z0-9._/-]+)["'']?\s*$') { $current.package=Module-Name $Matches[1] }
                elseif ($current -and $indent -eq $moduleIndent -and $line -match '^\s*disabled:\s*(true|false)\s*$') { $current.disabled=$Matches[1] -eq 'true' }
                elseif ($indent -lt $moduleIndent) { $current=$null }
                if ($modules.Count -ge 400) { Issue 'module-declaration-limit'; break }
            }
            $limited=$true
        }
        return [pscustomobject]@{path=$actual; hash=(Get-FileHash -LiteralPath $actual -Algorithm SHA256).Hash.ToLowerInvariant(); modules=@($modules); includes=@($includes); parserLimited=$limited; configValuesIncluded=$false}
    } catch { Issue 'declaration-unavailable-or-invalid'; return $null }
}
function Load-Node([string]$file) {
    if ($nodes.ContainsKey($file)) { return $nodes[$file] }
    if ($nodes.Count -ge $MaxPackages) { Issue 'package-limit'; return $null }
    $data=Public-Json $file; if (!$data) { return $null }
    $directory=Split-Path -Parent $file; $name=Package-Name $data.name
    if (!$name) { Issue 'package-name-unclassified'; return $null }
    $entrypoints=[Collections.Generic.List[object]]::new()
    foreach ($field in @('main','module','types','typings','bin','exports')) { foreach ($entry in @(Entry-Fields $data.$field $field)) { $entrypoints.Add($entry) } }
    $node=[pscustomobject]@{path=$file; directory=$directory; name=$name; version=(Safe-Version $data.version); hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant(); entrypoints=@($entrypoints); declarations=[Collections.Generic.List[object]]::new(); references=[Collections.Generic.List[object]]::new(); roots=[Collections.Generic.HashSet[string]]::new(); originClass='unknown'; dependenciesComplete=$true}
    $nodes[$file]=$node
    foreach ($kind in @('dependencies','optionalDependencies','peerDependencies')) {
        foreach ($property in @($data.$kind.PSObject.Properties)) {
            if ($property -and (Package-Name $property.Name)) { Add-Reference $node $property.Name $kind $property.Value }
        }
    }
    foreach ($bundle in @($data.dsh.profile.bundles)+@($data.dsh.bundle.bundles)+@($data.dsh.bundle.include)) {
        if ($bundle -is [string] -and (Module-Name $bundle)) { Add-Reference $node $bundle 'bundle-reference' $null }
    }
    $files=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($value in @($data.dsh.bundle)+@($data.dsh.bundle.entry)+@($data.dsh.bundle.patch)+@($data.dsh.bundle.file)) {
        if ($value -is [string] -and (Relative-Entry $value) -and [IO.Path]::GetExtension($value) -in @('.yml','.yaml','.json')) {
            $target=Safe-Path $value $directory; if ($target -and $target.StartsWith($directory+'\',[StringComparison]::OrdinalIgnoreCase)) { [void]$files.Add($target) }
        }
    }
    foreach ($known in @('cordis.yml','cordis.yaml','cordis.patch.yml','bundle.yml','bundle.yaml','bundle.json')) { $target=Join-Path $directory $known; if(Test-Path -LiteralPath $target){[void]$files.Add($target)} }
    foreach ($file in $files) {
        $declaration=Read-Declarations $file; if (!$declaration) { continue }; $node.declarations.Add($declaration)
        foreach ($module in $declaration.modules) { if ($module.package) { Add-Reference $node $module.package 'module-declaration' $null } }
        foreach ($include in $declaration.includes) { Add-Reference $node $include 'bundle-include' $null }
    }
    return $node
}

$roots=@(
    @{id='distribution-cli'; path='C:\DSH\app\node_modules\@deepseek-ai\dsh\package.json'},
    @{id='distribution-desktop'; path='C:\DSH\desktop-app\resources\app\package.json'},
    @{id='profile-desktop-live'; path='C:\DSH\DaFeiYu\运行状态\dsh-desktop\profiles\desktop\package.json'},
    @{id='profile-headless-live'; path='C:\DSH\DaFeiYu\运行状态\dsh-cli\profiles\headless\package.json'},
    @{id='protected-update-guard'; path='C:\DSH\DaFeiYu\程序\update-guard\package.json'},
    @{id='compatibility-qq'; path='C:\DSH\DaFeiYu\程序\qq-bridge-v073\package.json'},
    @{id='compatibility-bili'; path='C:\DSH\DaFeiYu\程序\bili-lite\package.json'}
)
$started=[datetimeoffset]::UtcNow.ToString('o')
foreach ($root in $roots) { Queue-Package $root.path $root.id }
while ($queue.Count -gt 0) {
    $item=$queue.Dequeue()
    try { $node=Load-Node $item.file } catch { Issue 'package-metadata-unavailable'; $node=$null }
    if (!$node) { [void]$missing.Add($item.origin+':metadata-unavailable'); continue }
    [void]$node.roots.Add($item.origin)
    foreach ($edge in $node.references) {
        if ($edge.to) { Queue-Package $edge.to $item.origin }
        else { $node.dependenciesComplete=$false; [void]$missing.Add($node.name+':'+$edge.kind+':'+$edge.requested) }
    }
}
$facts=@($nodes.Values | Sort-Object path | ForEach-Object {
    $origin=@($_.roots | Sort-Object); $distribution=@($origin | Where-Object { $_ -like 'distribution-*' }).Count -gt 0
    $protected=($origin -contains 'protected-update-guard') -or $_.path -match '^C:\\DSH\\DaFeiYu\\程序\\(update-guard|maintenance)(\\|$)'
    [pscustomobject]@{path=$_.path; name=$_.name; version=$_.version; hash=$_.hash; entrypoints=$_.entrypoints; declarations=@($_.declarations); reachableFrom=$origin; distributionDependency=$distribution; protectedOperationsComponent=$protected; originClass=$_.originClass; localDependencyEdgesResolved=$_.dependenciesComplete; dispositionHint=$(if($protected){'retain-protected'}elseif($distribution){'retain-distribution-reachable'}else{'pending-source-and-required-service-confirmation'}); removalEligible=$false}
})
[pscustomobject]@{
    schemaVersion=1; observedAt=$started; finishedAt=[datetimeoffset]::UtcNow.ToString('o'); mode='read-only-dependency-facts';
    roots=@($roots | ForEach-Object { [pscustomobject]@{id=$_.id; requestedPath=$_.path; resolvedPath=(Resolve-PublicPath $_.path)} });
    packages=$facts; edges=@($edges.Values | Sort-Object from,kind,requested); unresolved=@($missing | Sort-Object); issues=@($issues);
    limits=@{packages=$MaxPackages; edges=$MaxEdges; bytesPerFile=$MaxFileBytes};
    protections=@{dshFoundation=$true; originalSoftware=$true; maintenance=(Test-Path -LiteralPath 'C:\DSH\DaFeiYu\程序\maintenance'); credentials=$true; newRealMemory=$true};
    limitations=@('no namespace-prefix classification','static candidate resolution is not runtime activation proof','YAML parser returns identifier declarations only; config omitted','origin history and complete service dependency closure require review','optional and peer dependencies retained as evidence','QQ/Bili package exports do not prove DM or nightly behavior','no removal authorized by this output');
    serviceDependencyClosureProven=$false; rawConfigIncluded=$false; applicationCodeExecuted=$false; remoteFilesWritten=$false
} | ConvertTo-Json -Depth 14
