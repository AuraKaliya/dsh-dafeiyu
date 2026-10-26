param([Parameter(Mandatory = $true)][string]$RequestFile)
$ErrorActionPreference = 'Stop'
$speechEngine = $null
$audioStream = $null
try {
  $request = Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
  Add-Type -AssemblyName System.Speech
  $speechEngine = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $speechEngine.SelectVoice([string]$request.voice)
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $audioStream = New-Object System.IO.MemoryStream
  $speechEngine.SetOutputToAudioStream($audioStream, $format)
  $speechEngine.Speak([string]$request.text)
  $speechEngine.SetOutputToNull()
  if ($audioStream.Length -gt 3840000) { throw 'MEDIA_TTS_LIMIT' }
  $bytes = $audioStream.ToArray()
  [Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
} catch {
  [Console]::Error.Write('MEDIA_TTS_FAILED')
  exit 1
} finally {
  if ($speechEngine) { $speechEngine.Dispose() }
  if ($audioStream) { $audioStream.Dispose() }
}
