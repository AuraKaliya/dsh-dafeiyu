param(
  [Parameter(Mandatory=$true)][ValidateSet('main','retry','matrix')][string]$Entry,
  [Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments
)
$ErrorActionPreference='Stop'
if($env:DAFEIYU_TEST_RUN){throw 'EVALUATION_LIVE_CALLS_DISABLED_IN_TESTS'}
$repository=Split-Path -Parent $PSScriptRoot
$proxyConfig=Get-ItemProperty -LiteralPath 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Internet Settings'
if(-not $proxyConfig.ProxyEnable){throw 'ACCEPTANCE_SYSTEM_PROXY_DISABLED'}
$proxyAddress=[string]$proxyConfig.ProxyServer
$proxyUri=[Uri]('http://'+$proxyAddress)
if($proxyUri.Host -ne '127.0.0.1' -or $proxyUri.UserInfo -or $proxyUri.Port -lt 1){throw 'ACCEPTANCE_UNEXPECTED_PROXY'}
if(-not(Get-NetTCPConnection -State Listen -LocalPort $proxyUri.Port -ErrorAction SilentlyContinue)){throw 'ACCEPTANCE_PROXY_NOT_LISTENING'}
$saved=@{}
foreach($key in @('HTTP_PROXY','HTTPS_PROXY','NODE_USE_ENV_PROXY','NO_PROXY','NODE_DISABLE_COMPILE_CACHE')){$saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
Push-Location -LiteralPath $repository
try{
  $env:HTTP_PROXY=$proxyUri.AbsoluteUri
  $env:HTTPS_PROXY=$proxyUri.AbsoluteUri
  $env:NODE_USE_ENV_PROXY='1'
  $env:NO_PROXY='127.0.0.1,localhost,::1'
  $env:NODE_DISABLE_COMPILE_CACHE='1'
  $target=if($Entry -eq 'main'){'scripts/run-integrated-real.mjs'}elseif($Entry -eq 'retry'){'scripts/retry-integrated-case.mjs'}else{'scripts/continue-integrated-matrix.mjs'}
  & node --import ./scripts/acceptance-network-preload.mjs $target @Arguments
  $resultCode=$LASTEXITCODE
}finally{
  foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}
  Pop-Location
}
exit $resultCode
