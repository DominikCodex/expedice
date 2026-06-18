$ErrorActionPreference = "Stop"

$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $SourceDir

py -3 -m pip install --upgrade pyinstaller
py -3 -m PyInstaller --onefile --noconsole --name ExpedicePrintAgent agent.py

Write-Host "Hotovo: $SourceDir\dist\ExpedicePrintAgent.exe"
Write-Host "Pro produkcni instalator pribal SumatraPDF.exe vedle EXE nebo do slozky bin."
