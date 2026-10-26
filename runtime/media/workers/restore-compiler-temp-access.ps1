param([Parameter(Mandatory=$true)][string]$WorkRoot,[Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
try {
  $rootPath = [IO.Path]::GetFullPath($WorkRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $targetPath = [IO.Path]::GetFullPath($Directory)
  if (-not $targetPath.StartsWith($rootPath + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'OUTSIDE_ROOT' }
  if ((Split-Path -Leaf $targetPath) -notmatch '^process-[A-Za-z0-9]+$') { throw 'NOT_WORKER_DIRECTORY' }
  $part = $targetPath
  while ($true) {
    $item = Get-Item -LiteralPath $part -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'PATH_ALIAS' }
    if ($part.Equals($rootPath,[StringComparison]::OrdinalIgnoreCase)) { break }
    $part = Split-Path -Parent $part
  }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $admins = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  foreach ($child in Get-ChildItem -LiteralPath $targetPath -Directory -Force) {
    if ($child.Name -notmatch '^[a-z0-9]{8}$' -or ($child.Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
    $acl = Get-Acl -LiteralPath $child.FullName
    $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier])
    if ($owner -ne $identity -and $owner -ne $admins) { continue }
    $changed = $false
    foreach ($rule in $acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier])) {
      if ($rule.IdentityReference -eq $identity -and $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Deny -and
          $rule.FileSystemRights -eq [Security.AccessControl.FileSystemRights]::Delete -and
          $rule.InheritanceFlags -eq [Security.AccessControl.InheritanceFlags]::ObjectInherit -and
          $rule.PropagationFlags -eq [Security.AccessControl.PropagationFlags]::None -and -not $rule.IsInherited) {
        $acl.RemoveAccessRuleSpecific($rule)
        $changed = $true
      }
    }
    if ($changed) { Set-Acl -LiteralPath $child.FullName -AclObject $acl }
  }
} catch { exit 1 }
