$ErrorActionPreference = "Stop"

$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $SourceDir

$SumatraVersion = "3.6.1"
$BinDir = Join-Path $SourceDir "bin"
$SumatraTarget = Join-Path $BinDir "SumatraPDF.exe"
if (-not (Test-Path $SumatraTarget)) {
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    $TempZip = Join-Path $env:TEMP "SumatraPDF-$SumatraVersion-64.zip"
    $TempDir = Join-Path $env:TEMP "SumatraPDF-$SumatraVersion-64-build"
    $SumatraZipUrl = "https://www.sumatrapdfreader.org/dl/rel/$SumatraVersion/SumatraPDF-$SumatraVersion-64.zip"
    Write-Host "Stahuji SumatraPDF portable pro pribaleni k agentovi..."
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
}

py -3 -m pip install --upgrade pyinstaller
py -3 -m PyInstaller --onefile --noconsole --name ExpedicePrintAgent agent.py

Write-Host "Hotovo: $SourceDir\dist\ExpedicePrintAgent.exe"
Write-Host "SumatraPDF pripravena: $SumatraTarget"
Write-Host "Pro produkcni instalator pribal slozku bin vedle EXE."
