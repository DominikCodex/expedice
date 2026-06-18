$ErrorActionPreference = "Stop"

$AppName = "ExpedicePrintAgent"
$InstallDir = Join-Path $env:LOCALAPPDATA $AppName
$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "$AppName.lnk"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Force (Join-Path $SourceDir "agent.py") (Join-Path $InstallDir "agent.py")

$RunBat = Join-Path $InstallDir "run-agent.bat"
@"
@echo off
cd /d "$InstallDir"
py -3 agent.py
"@ | Set-Content -Encoding ASCII -Path $RunBat

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $RunBat
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.WindowStyle = 7
$Shortcut.Description = "Expedice Print Agent"
$Shortcut.Save()

Start-Process -FilePath $RunBat -WindowStyle Hidden

Write-Host "Expedice Print Agent nainstalovan do: $InstallDir"
Write-Host "Spusteni po startu Windows: $ShortcutPath"
Write-Host "Health check: http://127.0.0.1:8787/health"
