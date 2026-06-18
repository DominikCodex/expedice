$ErrorActionPreference = "Stop"

$AppName = "ExpedicePrintAgent"
$InstallDir = Join-Path $env:LOCALAPPDATA $AppName
$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "$AppName.lnk"
$BinDir = Join-Path $InstallDir "bin"
$SumatraTarget = Join-Path $BinDir "SumatraPDF.exe"
$BundledSumatra = Join-Path $SourceDir "bin\SumatraPDF.exe"
$SumatraVersion = "3.6.1"
$SumatraZipUrl = "https://www.sumatrapdfreader.org/dl/rel/$SumatraVersion/SumatraPDF-$SumatraVersion-64.zip"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
Copy-Item -Force (Join-Path $SourceDir "agent.py") (Join-Path $InstallDir "agent.py")

if (Test-Path $BundledSumatra) {
    Copy-Item -Force $BundledSumatra $SumatraTarget
    Write-Host "SumatraPDF zkopirovana z balicku: $SumatraTarget"
} elseif (-not (Test-Path $SumatraTarget)) {
    $TempZip = Join-Path $env:TEMP "SumatraPDF-$SumatraVersion-64.zip"
    $TempDir = Join-Path $env:TEMP "SumatraPDF-$SumatraVersion-64"
    Write-Host "Stahuji SumatraPDF portable z oficiálního zdroje..."
    try {
        Invoke-WebRequest -Uri $SumatraZipUrl -OutFile $TempZip -UseBasicParsing
        if (Test-Path $TempDir) {
            Remove-Item -Recurse -Force $TempDir
        }
        New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
        Expand-Archive -Path $TempZip -DestinationPath $TempDir -Force
        $SumatraExe = Get-ChildItem -Path $TempDir -Filter "SumatraPDF*.exe" -Recurse | Select-Object -First 1
        if (-not $SumatraExe) {
            throw "V archivu se nepodarilo najit SumatraPDF.exe"
        }
        Copy-Item -Force $SumatraExe.FullName $SumatraTarget
        Write-Host "SumatraPDF nainstalovana: $SumatraTarget"
    } catch {
        Write-Warning "SumatraPDF se nepodarilo stahnout: $($_.Exception.Message)"
        Write-Warning "Agent bude fungovat pres Windows tiskovy fallback, ale tichy tisk bude mene spolehlivy."
    }
}

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
Write-Host "SumatraPDF: $SumatraTarget"
Write-Host "Spusteni po startu Windows: $ShortcutPath"
Write-Host "Health check: http://127.0.0.1:8787/health"
