param([switch]$ReadDefaultPrinter)

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$source = Get-Content -LiteralPath (Join-Path $root 'vba/VyskladneniTisk.bas') -Raw
$launchLine = 'result = WhPrintShellExecute(0, StrPtr(operation), StrPtr(executable), StrPtr(arguments), 0, 1)'
if (-not $source.Contains($launchLine)) { throw 'Launch interception no longer matches production code. Refusing to run.' }
# Test production control flow with network, process launches and dialogs replaced.
$source = $source.Replace($launchLine, 'result = TestLaunch(executable, arguments)')
$source = $source.Replace('CreateObject("MSXML2.ServerXMLHTTP.6.0")', 'New FakeHttp')
$source = $source.Replace('http.Open ', 'http.TestOpen ')
$source = $source.Replace('printer = WhPrintDefaultPrinter()', 'printer = Array("Test Printer", "Test Driver", "WSD-TEST")')
$source = $source.Replace('adobe = WhPrintAdobePath()', 'adobe = TestAdobeForPrint()')
$source = $source.Replace('pdfPath = WhPrintChoosePdf()', 'pdfPath = testSelectedPdf')
$source = [regex]::Replace($source, '\bMsgBox\b', 'TestMessage')
if ($source -match '(?m)^\s*result = WhPrintShellExecute\(') { throw 'Unintercepted launch.' }
$harness = @'
Public testLaunchCount As Long
Public testLastExe As String
Public testLastArguments As String
Public testRequests As Long
Public testUrl As String
Public testPayload As String
Public testHttpStatus As Long
Public testConfirm As Boolean
Public testMessageText As String
Public testMissingAdobe As Boolean
Public testInvalidPdf As Boolean
Public testSelectedPdf As String
Public testFailedMode As String
Public testWrongMode As Boolean
Public testUrls As String
Public Sub TestSelectPdf(ByVal path As String)
    testSelectedPdf = path
End Sub
Public Function TestSavedPdf(ByVal index As Long) As String
    TestSavedPdf = whPrintPdfPaths(index)
End Function
Public Sub TestForgetPdfs()
    Dim index As Long
    For index = 0 To 2
        whPrintPdfPaths(index) = ""
    Next index
End Sub
Public Sub TestModeFailure(ByVal mode As String, Optional ByVal wrongMode As Boolean = False)
    testFailedMode = mode
    testWrongMode = wrongMode
End Sub
Public Function TestLaunch(ByVal exe As String, ByVal args As String) As Long
    testLaunchCount = testLaunchCount + 1
    testLastExe = exe
    testLastArguments = args
    TestLaunch = 33
End Function
Public Function TestMessage(ByVal prompt As String, Optional ByVal buttons As Long = 0, Optional ByVal title As String = "") As Long
    testMessageText = prompt
    TestMessage = vbNo
    If testConfirm Then TestMessage = vbYes
End Function
Public Sub TestConfigure(ByVal confirm As Boolean, ByVal status As Long, Optional ByVal missingAdobe As Boolean = False, Optional ByVal invalidPdf As Boolean = False)
    testConfirm = confirm
    testHttpStatus = status
    testMissingAdobe = missingAdobe
    testInvalidPdf = invalidPdf
    testFailedMode = ""
    testWrongMode = False
End Sub
Public Function TestAdobeForPrint() As String
    If Not testMissingAdobe Then TestAdobeForPrint = WhPrintAdobePath()
End Function
Public Function TestState() As Variant
    TestState = Array(testLaunchCount, testLastExe, testLastArguments, testRequests, testSelectedPdf, testMessageText, testUrl, testPayload, testUrls)
End Function
Public Function TestAdobePath() As String
    TestAdobePath = WhPrintAdobePath()
End Function
Public Function TestPrinter() As String
    TestPrinter = Join(WhPrintDefaultPrinter(), "|")
End Function
Public Function TestArguments(ByVal pdf As String, ByVal printer As String) As String
    TestArguments = WhPrintAdobeArguments(pdf, printer, "Test Driver", "WSD-TEST")
End Function
Public Function TestArgumentFailure(ByVal value As String) As Long
    On Error GoTo Expected
    Dim quoted As String
    quoted = WhPrintQuoteArgument(value)
    Exit Function
Expected:
    TestArgumentFailure = Err.Number - vbObjectError
End Function
Public Function TestValidate(ByVal path As String) As Long
    On Error GoTo Expected
    Dim result As String
    result = WhPrintValidatedPdf(path)
    Exit Function
Expected:
    TestValidate = Err.Number - vbObjectError
End Function
'@
$fakeHttp = @'
Private endpoint As String
Public Sub setTimeouts(ByVal a As Long, ByVal b As Long, ByVal c As Long, ByVal d As Long)
End Sub
Public Sub TestOpen(ByVal method As String, ByVal url As String, ByVal asynchronous As Boolean)
    endpoint = url
    TestModule.testUrl = url
    TestModule.testUrls = TestModule.testUrls & url & vbLf
End Sub
Public Sub setRequestHeader(ByVal name As String, ByVal value As String)
End Sub
Public Sub send(ByVal payload As String)
    TestModule.testRequests = TestModule.testRequests + 1
    TestModule.testPayload = payload
End Sub
Public Property Get Status() As Long
    Status = TestModule.testHttpStatus
    If Len(TestModule.testFailedMode) > 0 And InStr(endpoint, "priority=" & TestModule.testFailedMode) > 0 Then Status = 503
End Property
Public Property Get responseText() As String
    responseText = "Test server failure"
End Property
Public Property Get responseBody() As Variant
    Dim content() As Byte
    content = StrConv("%PDF-1.4 test document", vbFromUnicode)
    If TestModule.testInvalidPdf Then content = StrConv("<html>error</html>", vbFromUnicode)
    responseBody = content
End Property
Public Function getResponseHeader(ByVal header As String) As String
    If header = "Content-Type" Then
        getResponseHeader = "text/html"
        If InStr(endpoint, "render-pdf") > 0 Then getResponseHeader = "application/pdf"
    ElseIf header = "X-Warehouse-Priority" Then
        If Not TestModule.testWrongMode Then getResponseHeader = Mid$(endpoint, InStr(endpoint, "priority=") + 9)
    Else
        getResponseHeader = "0"
    End If
End Function
'@
$folder = Join-Path $root ('test-results/adobe-vba-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $folder)
$excel = $null
$book = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $book = $excel.Workbooks.Add()
    $module = $book.VBProject.VBComponents.Add(1)
    $module.Name = 'TestModule'
    # Declarations must precede production procedures.
    $declarations = [regex]::Matches($harness, '(?m)^Public test[^\r\n]+') | ForEach-Object { $_.Value }
    $harness = [regex]::Replace($harness, '(?m)^Public test[^\r\n]+\r?\n', '')
    $module.CodeModule.AddFromString(($declarations -join "`r`n") + "`r`n" + $source + "`r`n" + $harness)
    $httpClass = $book.VBProject.VBComponents.Add(2)
    $httpClass.Name = 'FakeHttp'
    $httpClass.CodeModule.AddFromString($fakeHttp)
    $book.SaveAs((Join-Path $folder 'test.xlsm'), 52)
    $prefix = "'test.xlsm'!TestModule."
    $sheet = $book.Worksheets.Item(1)
    $sheet.Name = 'VYSKLADNI'
    $sheet.Cells.Item(1, 2).Value2 = 'Kod varianty'
    $sheet.Cells.Item(1, 4).Value2 = 'Kolik a kam'
    $sheet.Cells.Item(1, 5).Value2 = 'Celkem'
    $sheet.Cells.Item(2, 1).Value2 = '6002'
    $sheet.Cells.Item(2, 2).Value2 = '6002-TEST'
    $sheet.Cells.Item(2, 3).Value2 = "L/XL, $([char]0x10d)ern$([char]0xe1)"
    $sheet.Cells.Item(2, 4).Value2 = '1x3'
    $sheet.Cells.Item(2, 5).Value2 = '1'
    foreach ($name in @('EXCEL', 'KOMPLETACE')) {
        $helper = $book.Worksheets.Add()
        $helper.Name = $name
        $helper.Cells.Item(1, 1).Value2 = 'test'
    }
    $adobe = $excel.Run($prefix + 'TestAdobePath')
    if (-not $adobe -or -not (Test-Path -LiteralPath $adobe)) { throw 'Installed Adobe was not resolved.' }
    Write-Output "PASS: Adobe resolved without launching: $adobe"
    if ($ReadDefaultPrinter) { Write-Output ('Default printer (read-only): ' + $excel.Run($prefix + 'TestPrinter')) }
    $excel.Run($prefix + 'TestConfigure', $false, 200)
    $excel.Run($prefix + 'VyskladneniPdfVygenerovat')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 0 -or $state[3] -ne 3 -or -not $state[6].EndsWith('/render-pdf?priority=split')) { throw ('Generation failed: ' + $state[5]) }
    $pdfRoot = Join-Path $folder 'VyskladneniPDF'
    $pdfs = @(Get-ChildItem -LiteralPath $pdfRoot -Recurse -Filter '*.pdf')
    if ($pdfs.Count -ne 3) { throw 'Expected three saved PDFs.' }
    foreach ($subfolder in @('Bezne-poradi', 'Prioritni-zasilky-prvni', 'Prioritni-kusy-zvlast')) {
        if (@(Get-ChildItem -LiteralPath (Join-Path $pdfRoot $subfolder) -Filter '*.pdf').Count -ne 1) { throw "Missing PDF in $subfolder" }
    }
    if (@($pdfs.Name | Select-Object -Unique).Count -ne 1) { throw 'Batch filenames differ.' }
    foreach ($mode in @('normal', 'first', 'split')) {
        if ($state[8] -notmatch "/render-pdf\?priority=$mode") { throw "Missing mode $mode" }
    }
    $pdf = (Get-ChildItem -LiteralPath (Join-Path $pdfRoot 'Prioritni-kusy-zvlast') -Filter '*.pdf')[0].FullName
    if ([string]$state[2] -ne '' -or [string]$state[1] -ne '') { throw 'Generation opened a browser or printed.' }
    $printMacros = @('VyskladneniTiskBeznePoradi', 'VyskladneniTiskPrioritniZasilky', 'VyskladneniTiskPrioritniKusy')
    for ($i = 0; $i -lt 3; $i++) {
        $savedPdf = $excel.Run($prefix + 'TestSavedPdf', $i)
        if (-not (Test-Path -LiteralPath $savedPdf)) { throw 'Generated variant was not remembered.' }
        $excel.Run($prefix + $printMacros[$i])
        $state = $excel.Run($prefix + 'TestState')
        $expected = '/t "' + $savedPdf + '" "Test Printer" "Test Driver" "WSD-TEST"'
        if ($state[0] -ne ($i + 1) -or $state[3] -ne 3 -or $state[1] -ne $adobe -or $state[2] -cne $expected) { throw 'Variant macro printed wrong PDF, opened browser or uploaded again.' }
    }
    $sent = $state[7] | ConvertFrom-Json
    if ($sent.rows[0].variant -cne "L/XL, $([char]0x10d)ern$([char]0xe1)") { throw 'Czech text corrupted.' }
    $excel.Run($prefix + 'VyskladneniPdfVytisknoutAdobe')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 3) { throw 'Cancelled file picker launched application.' }
    $excel.Run($prefix + 'TestSelectPdf', $pdf)
    $excel.Run($prefix + 'VyskladneniPdfVytisknoutAdobe')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 3) { throw 'Cancelled print launched application.' }
    $excel.Run($prefix + 'TestConfigure', $true, 200, $true)
    $excel.Run($prefix + 'VyskladneniPdfVytisknoutAdobe')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 3 -or $state[5] -notmatch 'nebyl nalezen') { throw 'Missing Adobe did not stop safely.' }
    $excel.Run($prefix + 'TestConfigure', $true, 200)
    $excel.Run($prefix + 'VyskladneniPdfVytisknoutAdobe')
    $state = $excel.Run($prefix + 'TestState')
    $expected = '/t "' + $pdf + '" "Test Printer" "Test Driver" "WSD-TEST"'
    if ($state[0] -ne 4 -or $state[1] -ne $adobe -or $state[2] -cne $expected -or $state[3] -ne 3) { throw 'Adobe print did not use selected PDF and explicit printer tuple.' }
    Write-Output 'PASS: generation saves all three without preview; three direct macros print their own saved PDF without upload or picker.'
    foreach ($bad in @('', 'bad"quote', "bad`nline")) {
        if ($excel.Run($prefix + 'TestArgumentFailure', $bad) -ne 821) { throw 'Invalid command argument accepted.' }
    }
    $unicodePath = '\\server\sklad s mezerou\' + [char]0x10d + 'erven' + [char]0xe1 + '%TEST% &.pdf'
    $args = $excel.Run($prefix + 'TestArguments', $unicodePath, 'Tiskarna & sklad')
    if ($args -cne ('/t "' + $unicodePath + '" "Tiskarna & sklad" "Test Driver" "WSD-TEST"')) { throw 'Unicode/UNC command changed.' }
    if ($excel.Run($prefix + 'TestValidate', $pdf) -ne 0) { throw 'Valid PDF rejected.' }
    if ($excel.Run($prefix + 'TestValidate', (Join-Path $folder 'missing.pdf')) -ne 819) { throw 'Missing PDF accepted.' }
    $badPdf = Join-Path $folder 'invalid.pdf'
    [IO.File]::WriteAllBytes($badPdf, [Text.Encoding]::ASCII.GetBytes('<html>not PDF</html>'))
    if ($excel.Run($prefix + 'TestValidate', $badPdf) -ne 819) { throw 'HTML accepted as PDF.' }
    $excel.Run($prefix + 'VyskladneniPdfATisk')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 4) { throw 'Legacy alias prints or opens a browser.' }
    if (@(Get-ChildItem -LiteralPath $pdfRoot -Recurse -Filter '*.pdf').Count -ne 6) { throw 'Regeneration overwrote previous PDFs.' }
    $excel.Run($prefix + 'TestConfigure', $false, 503)
    $excel.Run($prefix + 'VyskladneniPdfVygenerovat')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 4 -or $state[5] -notmatch 'Ulozeno 0/3') { throw 'Failed generation launched an app or claimed success.' }
    foreach ($macro in $printMacros) { $excel.Run($prefix + $macro) }
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 4 -or $state[5] -notmatch 'neni k dispozici') { throw 'Failed generation reused previous batch for printing.' }
    $excel.Run($prefix + 'TestConfigure', $false, 200, $false, $true)
    $excel.Run($prefix + 'VyskladneniPdfVygenerovat')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 4 -or $state[5] -notmatch 'platny PDF') { throw 'Invalid server PDF accepted.' }
    $excel.Run($prefix + 'TestConfigure', $false, 200)
    $excel.Run($prefix + 'TestModeFailure', '', $true)
    $excel.Run($prefix + 'VyskladneniPdfVygenerovat')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 4 -or $state[5] -notmatch 'nepotvrdil') { throw 'Old server mode mismatch accepted.' }
    $excel.Run($prefix + 'TestConfigure', $false, 200)
    $excel.Run($prefix + 'TestModeFailure', 'first')
    $excel.Run($prefix + 'VyskladneniPdfVygenerovat')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 4 -or $state[5] -notmatch 'Ulozeno 2/3' -or -not $state[6].EndsWith('priority=split')) { throw 'One failed mode prevented other modes or misreported success.' }
    if (@(Get-ChildItem -LiteralPath $pdfRoot -Recurse -Filter '*.pdf').Count -ne 8) { throw 'Partial failure lost successful PDFs.' }
    if ([string]$excel.Run($prefix + 'TestSavedPdf', 1) -ne '') { throw 'Failed variant retained previous batch.' }
    $requests = $state[3]
    $excel.Run($prefix + 'VyskladneniTiskPrioritniZasilky')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 4 -or $state[3] -ne $requests) { throw 'Missing variant triggered print or upload.' }
    $excel.Run($prefix + 'VyskladneniTiskPrioritniKusy')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 5 -or $state[3] -ne $requests) { throw 'Successful variant of partial batch did not print correctly.' }
    $excel.Run($prefix + 'TestConfigure', $false, 200, $true)
    $excel.Run($prefix + 'VyskladneniTiskBeznePoradi')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 5 -or $state[5] -notmatch 'nebyl nalezen') { throw 'Direct print ignored missing Adobe.' }
    $excel.Run($prefix + 'TestForgetPdfs')
    $excel.Run($prefix + 'VyskladneniTiskBeznePoradi')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 5 -or $state[5] -notmatch 'neni k dispozici') { throw 'Reset selected an old PDF automatically.' }
    $excel.Run($prefix + 'TestConfigure', $false, 200)
    $excel.Run($prefix + 'VyskladneniNahratATisk')
    $state = $excel.Run($prefix + 'TestState')
    if (-not $state[6].EndsWith('/render-print') -or $state[0] -ne 6) { throw 'Original manual HTML workflow changed.' }
    foreach ($worksheet in $book.Worksheets) {
        if ($worksheet.Shapes.Count -ne 0) { throw 'A macro created a button or shape.' }
    }
    if ($source -match 'AddFormControl|Public Sub VlozitTlacit') { throw 'Automatic button helpers remain.' }
    Write-Output 'PASS: all three modes and folders, partial failures, old server rejection, Unicode/UNC quoting, PDF validation, manual HTML and no automatic buttons.'
    Write-Output 'No network requests, application launches or physical prints were performed.'
} finally {
    if ($book) { $book.Close($false) }
    if ($excel) { $excel.Quit() }
    foreach ($object in @($httpClass, $module, $book, $excel)) {
        if ($object) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($object) }
    }
}
