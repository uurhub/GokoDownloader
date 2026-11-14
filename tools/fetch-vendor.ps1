param([switch]$Force)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $root 'helper\vendor'
New-Item -ItemType Directory -Force $vendor | Out-Null

$ytdlp = Join-Path $vendor 'yt-dlp.exe'
if ($Force -or -not (Test-Path $ytdlp)) {
    Write-Host 'Downloading yt-dlp.exe ...'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $ytdlp
}

$ffmpeg = Join-Path $vendor 'ffmpeg.exe'
$ffprobe = Join-Path $vendor 'ffprobe.exe'
if ($Force -or -not (Test-Path $ffmpeg) -or -not (Test-Path $ffprobe)) {
    Write-Host 'Downloading ffmpeg essentials ...'
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('goko-ffmpeg-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force $tmp | Out-Null
    try {
        $zip = Join-Path $tmp 'ffmpeg.zip'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $zip
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $za = [IO.Compression.ZipFile]::OpenRead($zip)
        try {
            foreach ($e in $za.Entries) {
                if ($e.Name -eq 'ffmpeg.exe' -or $e.Name -eq 'ffprobe.exe') {
                    [IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path $vendor $e.Name), $true)
                }
            }
        } finally { $za.Dispose() }
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}
$deno = Join-Path $vendor 'deno.exe'
if ($Force -or -not (Test-Path $deno)) {
    Write-Host 'Downloading deno (JS runtime for yt-dlp) ...'
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('goko-deno-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force $tmp | Out-Null
    try {
        $zip = Join-Path $tmp 'deno.zip'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip' -OutFile $zip
        Expand-Archive -Path $zip -DestinationPath $tmp -Force
        Copy-Item (Join-Path $tmp 'deno.exe') $deno -Force
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}
Get-ChildItem $vendor | Format-Table Name, Length
