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
Public testMessageCount As Long
Public testMissingImages As Long
Public Sub TestMissingPhotos(ByVal count As Long)
    testMissingImages = count
End Sub
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
Public Function TestFolderName(ByVal path As String) As String
    TestFolderName = WhPrintWorkbookFolderName(path)
End Function
Public Function TestExpeditionDate(ByVal path As String) As String
    On Error GoTo Failed
    TestExpeditionDate = Format$(WhPrintExpeditionDay(path), "yyyy-mm-dd")
    Exit Function
Failed:
    TestExpeditionDate = "ERROR"
End Function
Public Sub TestArchive(ByVal path As String)
    VyskladneniPdfDoSlozky path, DateSerial(2026, 9, 17)
End Sub
Public Sub TestForgetPdfs()
    whPrintPdfRoot = ""
    whPrintPdfSelectionKnown = False
    Dim index As Long
    For index = 0 To 2
        whPrintPdfPaths(index) = ""
    Next index
End Sub
Public Function TestResolvePdf(ByVal path As String, ByVal index As Long) As String
    On Error GoTo Failed
    TestResolvePdf = WhPrintResolveSavedPdf(index, path)
    Exit Function
Failed:
    TestResolvePdf = "ERROR: " & Err.Description
End Function
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
    testMessageCount = testMessageCount + 1
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
    testMessageCount = 0
    testMessageText = ""
    testMissingImages = 0
End Sub
Public Function TestAdobeForPrint() As String
    If Not testMissingAdobe Then TestAdobeForPrint = WhPrintAdobePath()
End Function
Public Function TestState() As Variant
    TestState = Array(testLaunchCount, testLastExe, testLastArguments, testRequests, testSelectedPdf, testMessageText, testUrl, testPayload, testUrls, testMessageCount)
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
    ElseIf header = "X-Warehouse-Missing-Images" Then
        getResponseHeader = CStr(TestModule.testMissingImages)
    Else
        getResponseHeader = "0"
    End If
End Function
'@
$folder = Join-Path $root ('test-results/av-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
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
    if ($state[9] -ne 0) { throw 'Successful generation showed a message box.' }
    $pdfRoot = Join-Path $folder 'VyskladneniPDF'
    $pdfs = @(Get-ChildItem -LiteralPath $pdfRoot -Recurse -Filter '*.pdf')
    if ($pdfs.Count -ne 3) { throw 'Expected three saved PDFs.' }
    foreach ($subfolder in @('Bezne-poradi', 'Prioritni-zasilky-prvni', 'Prioritni-kusy-zvlast')) {
        if (@(Get-ChildItem -LiteralPath (Join-Path $pdfRoot $subfolder) -Filter '*.pdf').Count -ne 1) { throw "Missing PDF in $subfolder" }
    }
    foreach ($file in $pdfs) {
        if (-not $file.Name.EndsWith('-' + $file.Directory.Name + '.pdf')) { throw 'PDF filename does not identify its report type.' }
    }
    $batchNames = @($pdfs | ForEach-Object { $_.Name.Substring(0, $_.Name.Length - $_.Directory.Name.Length - 5) } | Select-Object -Unique)
    if ($batchNames.Count -ne 1) { throw 'PDF filenames do not share a batch identifier.' }
    if (@($pdfs.Name | Select-Object -Unique).Count -ne 3) { throw 'Report types have identical filenames.' }
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
        if ($state[9] -ne 0) { throw 'Successful direct print showed a message box.' }
    }
    $sent = $state[7] | ConvertFrom-Json
    if ($sent.workbookFolderName -cne (Get-Date -Format 'dd.MM.yyyy') -or $sent.datasetDate -cne (Get-Date -Format 'yyyy-MM-dd')) { throw 'Default expedition date missing.' }
    $czechFolder = 'Ned' + [char]0x11b + 'le - ' + [char]0x10d + 'erven' + [char]0xe1
    foreach ($base in @('C:\sklad\', '\\server\sdilene\')) {
        if ($excel.Run($prefix + 'TestFolderName', ($base + $czechFolder)) -cne $czechFolder) { throw 'Unicode/local/UNC folder name changed.' }
    }
    foreach ($unsupported in @('', 'https://example.test/secret/path')) {
        if ([string]$excel.Run($prefix + 'TestFolderName', $unsupported) -ne '') { throw 'Unsupported workbook location exposed.' }
    }
    if ($sent.rows[0].variant -cne "L/XL, $([char]0x10d)ern$([char]0xe1)") { throw 'Czech text corrupted.' }
    $excel.Run($prefix + 'VyskladneniPdfVytisknoutAdobe')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 3) { throw 'Cancelled file picker launched application.' }
    if ($state[9] -ne 0) { throw 'Cancelled file picker showed a message box.' }
    $excel.Run($prefix + 'TestSelectPdf', $pdf)
    $excel.Run($prefix + 'TestConfigure', $true, 200, $true)
    $excel.Run($prefix + 'VyskladneniPdfVytisknoutAdobe')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 3 -or $state[5] -notmatch 'nebyl nalezen') { throw 'Missing Adobe did not stop safely.' }
    $excel.Run($prefix + 'TestConfigure', $true, 200)
    $excel.Run($prefix + 'VyskladneniPdfVytisknoutAdobe')
    $state = $excel.Run($prefix + 'TestState')
    $expected = '/t "' + $pdf + '" "Test Printer" "Test Driver" "WSD-TEST"'
    if ($state[0] -ne 4 -or $state[1] -ne $adobe -or $state[2] -cne $expected -or $state[3] -ne 3) { throw 'Adobe print did not use selected PDF and explicit printer tuple.' }
    if ($state[9] -ne 0) { throw 'Successful selected-file print showed a message box.' }
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
    if ($state[9] -ne 0) { throw 'Successful legacy generation showed a message box.' }
    if (@(Get-ChildItem -LiteralPath $pdfRoot -Recurse -Filter '*.pdf').Count -ne 6) { throw 'Regeneration overwrote previous PDFs.' }
    $excel.Run($prefix + 'TestConfigure', $false, 503)
    $excel.Run($prefix + 'VyskladneniPdfVygenerovat')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 4 -or $state[5] -notmatch 'Ulozeno 0/3') { throw 'Failed generation launched an app or claimed success.' }
    if ($state[9] -ne 1) { throw 'Failed generation must show one consolidated error.' }
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
    $excel.Run($prefix + 'VyskladneniTiskPrioritniZasilky')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[0] -ne 5 -or $state[5] -notmatch 'neni k dispozici') { throw 'Reset selected an old PDF automatically.' }
    $excel.Run($prefix + 'TestConfigure', $false, 200)
    $excel.Run($prefix + 'VyskladneniNahratATisk')
    $state = $excel.Run($prefix + 'TestState')
    if (-not $state[6].EndsWith('/render-print') -or $state[0] -ne 6) { throw 'Original manual HTML workflow changed.' }
    if ($state[9] -ne 0) { throw 'Successful HTML generation showed a message box.' }
    $excel.Run($prefix + 'TestConfigure', $false, 200)
    $excel.Run($prefix + 'TestMissingPhotos', 2)
    $excel.Run($prefix + 'VyskladneniPdfVygenerovat')
    $state = $excel.Run($prefix + 'TestState')
    if ($state[9] -ne 1 -or $state[5] -notmatch 'Bez fotografie: 2' -or $state[5] -notmatch 'Ulozeno 3/3') { throw 'Missing photos were not reported in one warning.' }
    Write-Output 'PASS: successful generation and printing are silent; errors and incomplete photos remain visible.'
    foreach ($datedPath in @('C:\sklad\17.09.2026', 'C:\sklad\17. 9. 2026 OBJEDNAVKA', '\\server\sklad\17.09.2026\Samostatne skladovky')) {
        if ($excel.Run($prefix + 'TestExpeditionDate', $datedPath) -ne '2026-09-17') { throw 'Saved-copy expedition date was replaced with today.' }
    }
    if ($excel.Run($prefix + 'TestExpeditionDate', 'C:\sklad\31.02.2026') -ne 'ERROR') { throw 'Invalid folder date accepted.' }
    $archive = Join-Path $folder ('Bal' + [char]0xed + [char]0x10d + 'ky - Expedice\Expedice\17.09.2026')
    [void](New-Item -ItemType Directory -Path $archive)
    # The daily workbook copy is created BEFORE generation, just like the user's master.
    $book.SaveCopyAs((Join-Path $archive 'daily.xlsm'))
    $excel.Run($prefix + 'TestConfigure', $false, 200)
    $before = $excel.Run($prefix + 'TestState')
    $excel.Run($prefix + 'TestArchive', $archive)
    $state = $excel.Run($prefix + 'TestState')
    $sent = $state[7] | ConvertFrom-Json
    if ($state[0] -ne $before[0] -or $state[3] -ne ($before[3] + 3) -or $state[9] -ne 0) { throw ('Archive generation failed: ' + $state[5] + ' / Requests: ' + $state[3] + ' (before ' + $before[3] + ')') }
    if ($sent.datasetDate -ne '2026-09-17' -or $sent.workbookFolderName -ne '17.09.2026') { throw 'Archive date did not override master date/folder.' }
    if (@(Get-ChildItem -LiteralPath (Join-Path $archive 'VyskladneniPDF') -Recurse -Filter '*.pdf').Count -ne 3) { throw 'Archive did not receive all three PDFs.' }
    for ($i = 0; $i -lt 3; $i++) {
        $saved = $excel.Run($prefix + 'TestSavedPdf', $i)
        if (-not $saved.StartsWith($archive + '\')) { throw 'Print macro still points at master folder.' }
    }
    $indexPath = Join-Path $archive 'VyskladneniPDF/posledni-sestava.xml'
    $indexText = Get-Content -LiteralPath $indexPath -Raw
    if ($indexText.Contains($folder) -or $indexText -notmatch 'Bezne-poradi\\Vyskladneni-') { throw 'Index is missing or contains machine-specific paths.' }
    $moved = Join-Path $root ('test-results/mv-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    Copy-Item -LiteralPath $archive -Destination $moved -Recurse
    $colleague = $null
    try {
        $colleague = $excel.Workbooks.Open((Join-Path $moved 'daily.xlsm'))
        $colleaguePrefix = "'" + $colleague.Name + "'!TestModule."
        for ($i = 0; $i -lt 3; $i++) {
            $excel.Run($colleaguePrefix + $printMacros[$i])
            $state = $excel.Run($colleaguePrefix + 'TestState')
            if ($state[0] -ne ($i + 1) -or $state[3] -ne 0 -or $state[9] -ne 0) { throw ('Reopened daily copy failed to print without upload: ' + $state[5]) }
            if (-not $state[2].Contains($moved + '\VyskladneniPDF\')) { throw 'Reopened copy still prints from original computer path.' }
        }
        $nested = Join-Path $moved ('Samostatn' + [char]0xe9 + ' skladovky')
        [void](New-Item -ItemType Directory -Path $nested)
        $resolved = $excel.Run($colleaguePrefix + 'TestResolvePdf', $nested, 0)
        if (-not $resolved.StartsWith($moved + '\VyskladneniPDF\')) { throw 'Nested daily copy did not find parent day PDFs.' }
        $movedIndex = Join-Path $moved 'VyskladneniPDF/posledni-sestava.xml'
        $resolved = $excel.Run($colleaguePrefix + 'TestResolvePdf', $moved, 0)
        # Simulate sync lag without destroying the test fixture.
        Move-Item -LiteralPath $resolved -Destination ($resolved + '.pending')
        $excel.Run($colleaguePrefix + 'TestConfigure', $false, 200)
        $excel.Run($colleaguePrefix + 'VyskladneniTiskBeznePoradi')
        $state = $excel.Run($colleaguePrefix + 'TestState')
        if ($state[0] -ne 3 -or $state[3] -ne 0 -or $state[9] -ne 1) { throw 'Missing synchronized PDF printed a fallback or uploaded.' }
        Move-Item -LiteralPath ($resolved + '.pending') -Destination $resolved
        foreach ($badIndex in @('<broken', '<warehousePrint version="1"><pdf mode="normal" path="..\outside.pdf"/></warehousePrint>', '<warehousePrint version="1"><pdf mode="normal" path=""/></warehousePrint>')) {
            [IO.File]::WriteAllText($movedIndex, $badIndex)
            $excel.Run($colleaguePrefix + 'TestConfigure', $false, 200)
            $excel.Run($colleaguePrefix + 'VyskladneniTiskBeznePoradi')
            $state = $excel.Run($colleaguePrefix + 'TestState')
            if ($state[0] -ne 3 -or $state[3] -ne 0 -or $state[9] -ne 1) { throw 'Invalid or empty index fell back to older PDFs.' }
        }
        [IO.File]::WriteAllText($movedIndex, $indexText)
        # Existing PDF sets produced by older versions have no index.
        Move-Item -LiteralPath $movedIndex -Destination ($movedIndex + '.bak')
        $legacy = $excel.Run($colleaguePrefix + 'TestResolvePdf', $moved, 0)
        if ($legacy -ne $resolved) { throw 'Legacy day did not find its complete batch.' }
        $newer = Join-Path $moved 'VyskladneniPDF/Prioritni-kusy-zvlast/Vyskladneni-20990101-010101-radABC-Prioritni-kusy-zvlast.pdf'
        Copy-Item -LiteralPath $resolved -Destination $newer
        if ([string]$excel.Run($colleaguePrefix + 'TestResolvePdf', $moved, 0) -ne '') { throw 'Legacy fallback mixed an older normal PDF with newer partial batch.' }
        $ambiguous = Join-Path $moved 'VyskladneniPDF/Bezne-poradi/Vyskladneni-20990101-010101-radXYZ-Bezne-poradi.pdf'
        Copy-Item -LiteralPath $resolved -Destination $ambiguous
        if ($excel.Run($colleaguePrefix + 'TestResolvePdf', $moved, 0) -notlike 'ERROR:*') { throw 'Legacy fallback guessed between two batches with identical timestamp.' }
    } finally {
        if ($colleague) { $colleague.Close($false); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($colleague) }
    }
    Write-Output 'PASS: pre-generation workbook copy reopened at another location prints all three without upload; relative XML, nested daily copy, sync lag, corrupt/empty/traversal index and coherent legacy batches.'
    foreach ($badDestination in @('', (Join-Path $folder 'not-created'))) {
        $excel.Run($prefix + 'TestConfigure', $false, 200)
        $before = $excel.Run($prefix + 'TestState')
        $excel.Run($prefix + 'TestArchive', $badDestination)
        $state = $excel.Run($prefix + 'TestState')
        if ($state[3] -ne $before[3] -or $state[9] -ne 1) { throw 'Invalid archive folder used default path or contacted server.' }
        for ($i = 0; $i -lt 3; $i++) {
            if ([string]$excel.Run($prefix + 'TestSavedPdf', $i) -ne '') { throw 'Failed archive retained previous print paths.' }
        }
    }
    Write-Output 'PASS: archive target independent of master, all three PDFs, explicit historical date, Czech paths, saved-copy dates, invalid paths and no automatic print.'
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
