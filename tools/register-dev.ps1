param(
    [switch]$Remove,
    [string]$ExtensionId = 'ckhglpifnfloifbggnfbgecaeiaacjbf'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$helper = Join-Path $root 'helper'
$bat = Join-Path $helper 'host-dev.bat'
$json = Join-Path $helper 'com.goko.downloader.dev.json'
$keys = @(
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.goko.downloader',
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.goko.downloader',
    'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.goko.downloader'
)

if ($Remove) {
    foreach ($k in $keys) { if (Test-Path $k) { Remove-Item $k -Recurse -Force } }
    foreach ($f in @($bat, $json)) { if (Test-Path $f) { Remove-Item $f -Force } }
    Write-Host 'Removed dev registration.'
    return
}

$py = (& py -3 -c "import sys;print(sys.executable)").Trim()
if (-not (Test-Path $py)) { throw "python.exe not found: $py" }

$batText = "@echo off`r`n`"$py`" -u `"%~dp0host.py`" %*`r`n"
[IO.File]::WriteAllText($bat, $batText, (New-Object Text.ASCIIEncoding))

$manifest = [ordered]@{
    name            = 'com.goko.downloader'
    description     = 'Goko Downloader native helper (dev)'
    path            = $bat
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
$jsonText = $manifest | ConvertTo-Json
[IO.File]::WriteAllText($json, $jsonText, (New-Object Text.UTF8Encoding($false)))

foreach ($k in $keys) {
    if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
    Set-ItemProperty -Path $k -Name '(default)' -Value $json
    Write-Host "Registered: $k"
}
Write-Host "bat : $bat"
Write-Host "json: $json"
