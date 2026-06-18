$ErrorActionPreference = "Stop"

param(
    [switch]$KeepConfig
)

$AppName = "ExpedicePrintAgent"
$InstallDir = Join-Path $env:LOCALAPPDATA $AppName
$ConfigDir = Join-Path $env:APPDATA $AppName
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "$AppName.lnk"

Write-Host "Odinstalace Expedice Print Agent..."

Get-CimInstance Win32_Process |
    Where-Object {
        ($_.CommandLine -like "*$AppName*") -or
        ($_.CommandLine -like "*agent.py*") -or
        ($_.Name -eq "ExpedicePrintAgent.exe")
    } |
    ForEach-Object {
        Write-Host "Ukoncuji proces: $($_.ProcessId) $($_.Name)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

if (Test-Path $ShortcutPath) {
    Remove-Item -Force $ShortcutPath
    Write-Host "Odebran autostart: $ShortcutPath"
}

if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir
    Write-Host "Smazana instalacni slozka: $InstallDir"
}

if (-not $KeepConfig -and (Test-Path $ConfigDir)) {
    Remove-Item -Recurse -Force $ConfigDir
    Write-Host "Smazana konfigurace: $ConfigDir"
} elseif ($KeepConfig -and (Test-Path $ConfigDir)) {
    Write-Host "Konfigurace ponechana: $ConfigDir"
}

Write-Host "Odinstalace hotova."
