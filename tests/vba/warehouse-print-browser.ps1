param([string]$ReportPath = '')

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$source = Get-Content -LiteralPath (Join-Path $root 'vba/VyskladneniTisk.bas') -Raw
$payloadGuard = [regex]::Match($source, '(?m)^\s*If Len\(payload\) >[^\r\n]+').Value.Trim()
if (-not $payloadGuard) { throw 'Payload size guard not found in the production macro.' }
$harness = @'
Public Function TestPayloadLimit(ByVal size As Long) As Long
    On Error GoTo Expected
    Dim payload As String
    payload = String$(size, "x")
    __PAYLOAD_GUARD__
    Exit Function
Expected:
    TestPayloadLimit = Err.Number
End Function
Public Function TestExecutable(ByVal command As String) As String
    TestExecutable = WhPrintExecutable(command)
End Function
Public Function TestBrowserPath() As String
    TestBrowserPath = WhPrintBrowserPath()
End Function
Public Function TestHelperSheets() As String
    TestHelperSheets = WhPrintHelperSheets(ThisWorkbook)
End Function
Public Function TestWarehouseSheet() As String
    Dim ws As Worksheet
    Set ws = WhPrintWarehouseSheet(ThisWorkbook)
    TestWarehouseSheet = ws.Name
End Function
Public Function TestWarehouseFailure() As Long
    On Error GoTo Expected
    Dim ws As Worksheet
    Set ws = WhPrintWarehouseSheet(ThisWorkbook)
    Exit Function
Expected:
    TestWarehouseFailure = Err.Number - vbObjectError
End Function
Public Function TestHelperFailure() As Long
    On Error GoTo Expected
    Dim value As String
    value = WhPrintHelperSheets(ThisWorkbook)
    Exit Function
Expected:
    TestHelperFailure = Err.Number - vbObjectError
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
$harness = $harness.Replace('__PAYLOAD_GUARD__', $payloadGuard)
$excel = $null
$book = $null
$component = $null
$otherBook = $null
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
    foreach ($size in @(0, 32768, 2097152)) {
        $failure = $excel.Run($prefix + 'TestPayloadLimit', $size)
        if ($failure -ne 0) { throw "Payload limit check failed for $size bytes with VBA error $failure." }
    }
    if ($excel.Run($prefix + 'TestPayloadLimit', 2097153) -ne (-2147221504 + 811)) { throw 'Payload above 2 MB was not rejected with the intended error.' }
    Write-Output 'PASS: actual payload guard accepts up to 2 MB without overflow and rejects one byte above the limit.'
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

    if ($excel.Run($prefix + 'TestHelperFailure') -ne 812) { throw 'Missing helper sheet was not rejected.' }
    $sourceSheet = $book.Worksheets.Item(1)
    $sourceSheet.Name = 'EXCEL'
    $completionSheet = $book.Worksheets.Add()
    $completionSheet.Name = 'KOMPLETACE'
    if ($excel.Run($prefix + 'TestHelperFailure') -ne 813) { throw 'Empty helper sheet was not rejected.' }
    $sourceSheet.Cells.Item(1, 1).Value2 = 'Variant'
    $sourceSheet.Cells.Item(1, 3).Value2 = 'Product'
    $sourceSheet.Cells.Item(2, 1).Value2 = "SKU-$([char]0x10c)ERN$([char]0xc1)"
    $sourceSheet.Cells.Item(2, 3).Formula = '="6009"'
    $sourceSheet.Cells.Item(4, 1).NumberFormat = '@'
    $sourceSheet.Cells.Item(4, 1).Value2 = '00123'
    $sourceSheet.Cells.Item(4, 3).Value2 = '</script><img src=x>'
    $completionSheet.Cells.Item(1, 1).Value2 = "$([char]0x13e)$([char]0xf4)"
    $helpers = ([string]$excel.Run($prefix + 'TestHelperSheets')) | ConvertFrom-Json
    if ($helpers.EXCEL.cells.Count -ne 4 -or $helpers.EXCEL.cells[0].Count -ne 3) { throw 'Helper dimensions changed.' }
    if ($helpers.EXCEL.cells[1][0] -cne "SKU-$([char]0x10c)ERN$([char]0xc1)" -or $helpers.KOMPLETACE.cells[0][0] -cne "$([char]0x13e)$([char]0xf4)") { throw 'Unicode helper values changed.' }
    if ($helpers.EXCEL.cells[1][2] -cne '6009' -or $helpers.EXCEL.cells[3][0] -cne '00123') { throw 'Formula value or leading zeros changed.' }
    if ($helpers.EXCEL.cells[2][0] -ne '' -or $helpers.EXCEL.cells[0][1] -ne '') { throw 'Blank rows or columns were shifted.' }
    $sourceSheet.Cells.Item(2, 3).Formula = '=1/0'
    if ($excel.Run($prefix + 'TestHelperFailure') -ne 807) { throw 'Excel cell error was not rejected.' }
    $sourceSheet.Cells.Item(2, 3).Value2 = '6009'
    $sourceSheet.Cells.Item(10001, 1).Value2 = 'too far'
    if ($excel.Run($prefix + 'TestHelperFailure') -ne 814) { throw 'Oversize helper sheet was not rejected.' }
    Write-Output 'PASS: helper sheets, Unicode, cached formulas, leading zeros, blank positions, missing/empty/error/oversize rejection. No upload performed.'

    if ($excel.Run($prefix + 'TestWarehouseFailure') -ne 802) { throw 'Missing warehouse sheet was not rejected.' }
    $warehouseSheet = $book.Worksheets.Add()
    $warehouseSheet.Name = 'VYSKLADNI'
    $warehouseSheet.Cells.Item(1, 2).Value2 = 'Kod varianty:'
    $warehouseSheet.Cells.Item(1, 4).Value2 = 'Kolik a kam s tim:'
    $warehouseSheet.Cells.Item(1, 5).Value2 = 'Celk.:'
    foreach ($tab in @($sourceSheet, $completionSheet, $warehouseSheet)) {
        $tab.Activate()
        if ($excel.Run($prefix + 'TestWarehouseSheet') -cne 'VYSKLADNI') { throw 'Could not resolve warehouse sheet from another tab.' }
        if ($excel.ActiveSheet.Name -cne $tab.Name) { throw 'Resolver switched the active tab.' }
    }
    $warehouseSheet.Name = 'Tisk skladu'
    $completionSheet.Activate()
    $warehouseSheet.Visible = 0
    if ($excel.Run($prefix + 'TestWarehouseSheet') -cne 'Tisk skladu') { throw 'Renamed or hidden warehouse sheet was not found.' }
    $unrelatedSheet = $book.Worksheets.Add()
    $unrelatedSheet.Cells.Item(1, 2).Formula = '=1/0'
    if ($excel.Run($prefix + 'TestWarehouseSheet') -cne 'Tisk skladu') { throw 'Unrelated cell error broke discovery.' }
    foreach ($tab in @($sourceSheet, $completionSheet)) {
        $tab.Cells.Item(1, 2).Value2 = 'variant'
        $tab.Cells.Item(1, 4).Value2 = 'kam'
        $tab.Cells.Item(1, 5).Value2 = 'Celk'
    }
    if ($excel.Run($prefix + 'TestWarehouseSheet') -cne 'Tisk skladu') { throw 'A helper sheet was treated as warehouse data.' }
    $otherBook = $excel.Workbooks.Add()
    if ($excel.Run($prefix + 'TestWarehouseSheet') -cne 'Tisk skladu') { throw 'Resolver read the wrong workbook.' }
    $otherBook.Close($false)
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($otherBook)
    $otherBook = $null
    $duplicateSheet = $book.Worksheets.Add()
    $duplicateSheet.Cells.Item(1, 2).Value2 = 'variant'
    $duplicateSheet.Cells.Item(1, 4).Value2 = 'kam'
    $duplicateSheet.Cells.Item(1, 5).Value2 = 'Celk'
    if ($excel.Run($prefix + 'TestWarehouseFailure') -ne 815) { throw 'Ambiguous warehouse sheets were not rejected.' }
    Write-Output 'PASS: discovery from every tab; renamed/hidden sheets; unrelated errors; helper exclusion; workbook isolation; ambiguity rejection.'

    if ($ReportPath) {
        $resolved = (Resolve-Path -LiteralPath $ReportPath).Path
        if ([IO.Path]::GetExtension($resolved) -ne '.html') { throw 'Expected an HTML print report.' }
        $failure = [string]$excel.Run($prefix + 'TestOpenBrowser', $resolved)
        if ($failure) { throw $failure }
        Write-Output 'PASS: Excel requested report opening in the web browser.'
    }
} finally {
    if ($otherBook) { $otherBook.Close($false) }
    if ($book) { $book.Close($false) }
    if ($excel) { $excel.Quit() }
    foreach ($object in @($otherBook, $component, $book, $excel)) {
        if ($object) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($object) }
    }
}
