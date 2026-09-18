param([string]$ReportPath = '')

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$source = Get-Content -LiteralPath (Join-Path $root 'vba/VyskladneniTisk.bas') -Raw
$harness = @'
Public Function TestExecutable(ByVal command As String) As String
    TestExecutable = WhPrintExecutable(command)
End Function
Public Function TestBrowserPath() As String
    TestBrowserPath = WhPrintBrowserPath()
End Function
Public Function TestOpenBrowser(ByVal path As String) As String
    On Error GoTo Failed
    WhPrintOpenBrowser path
    Exit Function
Failed:
    TestOpenBrowser = Err.Description
End Function
Public Function TestMissingReport(ByVal path As String) As Boolean
    On Error GoTo Expected
    WhPrintOpenBrowser path
    Exit Function
Expected:
    TestMissingReport = (Err.Number = vbObjectError + 808)
End Function
'@
$excel = $null
$book = $null
$component = $null
try {
    # A new instance and unsaved workbook only; never attach to the user's workbook.
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $book = $excel.Workbooks.Add()
    $component = $book.VBProject.VBComponents.Add(1)
    $component.Name = 'PrintBrowserTest'
    $component.CodeModule.AddFromString($source + "`r`n" + $harness)
    $prefix = "'" + $book.Name.Replace("'", "''") + "'!PrintBrowserTest."
    $cases = @(
        @{ Command = '"C:\Program Files\Google\Chrome\Application\chrome.exe" --single-argument %1'; Expected = 'C:\Program Files\Google\Chrome\Application\chrome.exe' },
        @{ Command = 'C:\Browser\firefox.exe -url "%1"'; Expected = 'C:\Browser\firefox.exe' },
        @{ Command = '"C:\Program Files\Browser\browser.exe'; Expected = '' },
        @{ Command = '"C:\wrong.txt" "%1"'; Expected = '' },
        @{ Command = ''; Expected = '' }
    )
    foreach ($case in $cases) {
        $actual = $excel.Run($prefix + 'TestExecutable', $case.Command)
        if ([string]$actual -cne $case.Expected) { throw "Unexpected browser executable: $actual" }
    }
    $browser = [string]$excel.Run($prefix + 'TestBrowserPath')
    if (-not (Test-Path -LiteralPath $browser -PathType Leaf)) { throw 'No installed web browser found.' }
    Write-Output ('Browser resolved by VBA: ' + $browser)

    $missingPath = Join-Path $env:TEMP ([guid]::NewGuid().ToString() + '.html')
    $rejected = $excel.Run($prefix + 'TestMissingReport', $missingPath)
    if (-not $rejected) { throw 'Missing report was not rejected.' }
    Write-Output 'PASS: VBA compiles; 5 command parsing cases; missing-file rejection.'

    if ($ReportPath) {
        $resolved = (Resolve-Path -LiteralPath $ReportPath).Path
        if ([IO.Path]::GetExtension($resolved) -ne '.html') { throw 'Expected an HTML print report.' }
        $failure = [string]$excel.Run($prefix + 'TestOpenBrowser', $resolved)
        if ($failure) { throw $failure }
        Write-Output 'PASS: Excel requested report opening in the web browser.'
    }
} finally {
    if ($book) { $book.Close($false) }
    if ($excel) { $excel.Quit() }
    foreach ($object in @($component, $book, $excel)) {
        if ($object) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($object) }
    }
}
