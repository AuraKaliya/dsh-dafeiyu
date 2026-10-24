$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$fixtureRoot = Join-Path $projectRoot '.runtime/phase1-probes/audio/fixtures'
[System.IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$samples = @(
    @{ id = 'speech-zh'; voice = 'Microsoft Huihui Desktop'; language = 'zh'; text = '这是大肥鱼的本地音频测试。蓝色灯亮了三次，然后关闭。' },
    @{ id = 'speech-en'; voice = 'Microsoft Zira Desktop'; language = 'en'; text = 'This is a local audio test. The blue lamp flashed three times and then switched off.' }
)
try {
    foreach ($sample in $samples) {
        $synth.SelectVoice($sample.voice)
        $synth.Rate = -1
        $synth.SetOutputToWaveFile((Join-Path $fixtureRoot ($sample.id + '.wav')), $format)
        $synth.Speak($sample.text)
        $synth.SetOutputToNull()
    }
} finally { $synth.Dispose() }
$manifest = @{ source = 'local Windows system TTS; no microphone or private audio'; sampleRate = 16000; channels = 1; samples = $samples }
[System.IO.File]::WriteAllText((Join-Path $fixtureRoot 'speech-source.json'), ($manifest | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
Write-Output 'Prepared two fictional PCM audio fixtures.'
