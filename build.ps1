param([switch]$SkipVendor, [switch]$SkipPyInstaller)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Step($t) { Write-Host ''; Write-Host "=== $t ===" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" } }

Step '1/5 Vendor binaries (yt-dlp, ffmpeg, deno)'
if ($SkipVendor) { Write-Host 'skipped' } else { & (Join-Path $PSScriptRoot 'tools\fetch-vendor.ps1') }

Step '2/5 Extension ID'
$extId = (& node tools/gen-key.mjs --id | Select-Object -Last 1).ToString().Trim()
Check 'gen-key'
if ($extId -notmatch '^[a-p]{32}$') { throw "Unexpected extension id: $extId" }
Write-Host "Extension ID: $extId"
$version = (Get-Content -Raw -Encoding UTF8 'extension\manifest.json' | ConvertFrom-Json).version
Write-Host "Version: $version"

Step '3/5 PyInstaller (GokoHost.exe)'
if ($SkipPyInstaller) { Write-Host 'skipped' } else {
    & py -m PyInstaller helper/host.spec --noconfirm --clean --distpath helper/dist --workpath helper/build
    Check 'PyInstaller'
}

Step '4/5 Locate Inno Setup'
$iscc = $null
$cands = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
)
foreach ($c in $cands) { if ($c -and (Test-Path $c)) { $iscc = $c; break } }
if (-not $iscc) {
    $cmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($cmd) { $iscc = $cmd.Source }
}
if (-not $iscc) {
    Write-Host 'Inno Setup 6 not found. Install it with:  winget install JRSoftware.InnoSetup' -ForegroundColor Red
    exit 1
}
Write-Host "ISCC: $iscc"

Step '5/5 Build installer'
& $iscc "/DExtensionId=$extId" "/DAppVersion=$version" 'installer\GokoDownloader.iss'
Check 'ISCC'

$out = Join-Path $PSScriptRoot 'installer\output\GokoDownloaderSetup.exe'
if (-not (Test-Path $out)) { throw "Installer not produced: $out" }
Write-Host ''
Write-Host ("Installer: {0}  ({1:N1} MB)" -f $out, ((Get-Item $out).Length / 1MB)) -ForegroundColor Green
