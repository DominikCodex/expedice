$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$source = Get-Content -LiteralPath (Join-Path $root 'vba/ExpediceUploadJedenSkript.bas') -Raw -Encoding UTF8
if (-not $source.Contains('CreateObject("MSXML2.ServerXMLHTTP.6.0")')) { throw 'Network interception missing.' }
$source = $source.Replace('CreateObject("MSXML2.ServerXMLHTTP.6.0")', 'New FakeHttp')
$source = $source.Replace('http.Open ', 'http.TestOpen ')
$source = $source.Replace('Application.Wait DateAdd("s", seconds, Now)', 'testWaits = testWaits & seconds & ","')
$source = [regex]::Replace($source, '\bMsgBox\b', 'TestMessage')
$declarations = @'
Public testGets As Long, testPosts As Long, testMessages As Long
Public testWaits As String, testMessageText As String, testPayload As String
Public testMode As String, testGetTimeout As Long, testPostTimeout As Long
'@
$harness = @'
Public Sub TestReset(ByVal mode As String)
    testMode = mode
    testGets = 0
    testPosts = 0
    testMessages = 0
    testWaits = ""
    testMessageText = ""
    testPayload = ""
End Sub
Public Sub TestMessage(ByVal message As String, ByVal style As Long)
    testMessages = testMessages + 1
    testMessageText = message
End Sub
Public Function TestState() As Variant
    TestState = Array(testGets, testPosts, testMessages, testWaits, testMessageText, testPayload, testGetTimeout, testPostTimeout)
End Function
'@
$fakeHttp = @'
Private method As String, receiveTimeout As Long
Public Sub setTimeouts(ByVal a As Long, ByVal b As Long, ByVal c As Long, ByVal d As Long)
    receiveTimeout = d
End Sub
Public Sub TestOpen(ByVal verb As String, ByVal url As String, ByVal asynchronous As Boolean)
    method = verb
    If asynchronous Then Err.Raise 5, , "Expected synchronous request"
    If verb = "GET" And url <> "https://expedice-production.up.railway.app/api/health" Then Err.Raise 5, , "Wrong health URL"
    If verb = "POST" And url <> "https://expedice-production.up.railway.app/api/datasets/upload" Then Err.Raise 5, , "Wrong upload URL"
End Sub
Public Sub setRequestHeader(ByVal name As String, ByVal value As String)
End Sub
Public Sub send(Optional ByVal payload As Variant)
    If method = "GET" Then
        TestModule.testGets = TestModule.testGets + 1
        TestModule.testGetTimeout = receiveTimeout
        If TestModule.testMode = "reentrant" Then TestModule.UploadRoztrideniAktualniTabulky
        If TestModule.testMode = "network-recover" And TestModule.testGets < 3 Then Err.Raise &H80072EE2, , "Timeout"
        If TestModule.testMode = "certificate" Then Err.Raise &H80072F8F, , "Certificate error"
    Else
        TestModule.testPosts = TestModule.testPosts + 1
        TestModule.testPostTimeout = receiveTimeout
        Dim stream As Object
        Set stream = CreateObject("ADODB.Stream")
        stream.Type = 1
        stream.Open
        stream.Write payload
        stream.Position = 0
        stream.Type = 2
        stream.Charset = "utf-8"
        TestModule.testPayload = stream.ReadText
        stream.Close
        If TestModule.testMode = "lost-post" Then Err.Raise &H80072EE2, , "Lost upload response"
    End If
End Sub
Public Property Get Status() As Long
    Status = 200
    If method = "GET" Then
        Select Case TestModule.testMode
            Case "http-recover"
                If TestModule.testGets < 3 Then Status = 502
            Case "unavailable"
                Status = 503
            Case "forbidden"
                Status = 403
        End Select
    Else
        Select Case TestModule.testMode
            Case "post-error": Status = 500
            Case "unauthorized": Status = 401
        End Select
    End If
End Property
Public Property Get responseText() As String
    responseText = "{""ok"": true}"
    If TestModule.testMode = "invalid-post" And method = "POST" Then responseText = "{""ok"": false}"
End Property
Public Function getResponseHeader(ByVal name As String) As String
    getResponseHeader = "application/json; charset=utf-8"
    If TestModule.testMode = "html-health" And method = "GET" Then getResponseHeader = "text/html"
End Function
'@
function Assert($condition, $message) { if (-not $condition) { throw $message } }
$excel = $null
$book = $null
$folder = Join-Path $root ('test-results/upload-vba-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $folder)
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $book = $excel.Workbooks.Add()
    $module = $book.VBProject.VBComponents.Add(1)
    $module.Name = 'TestModule'
    $module.CodeModule.AddFromString($declarations + "`r`n" + $source + "`r`n" + $harness)
    $httpClass = $book.VBProject.VBComponents.Add(2)
    $httpClass.Name = 'FakeHttp'
    $httpClass.CodeModule.AddFromString($fakeHttp)
    $book.SaveAs((Join-Path $folder 'upload-test.xlsm'), 52)
    $sorting = $book.Worksheets.Item(1)
    $sorting.Name = 'EXCEL'
    $sorting.Cells.Item(1, 2).Value2 = 'Code'
    $sorting.Cells.Item(2, 2).Value2 = '6002-HOLLAND'
    # Keep this test script ASCII-compatible with Windows PowerShell 5.
    $czech = 'P' + [char]0x159 + [char]0xed + 'li' + [char]0x161 + ' ' + [char]0x17e + 'lu' + [char]0x165 + 'ou' + [char]0x10d + 'k' + [char]0xfd
    $sorting.Cells.Item(2, 10).Value2 = $czech
    $completion = $book.Worksheets.Add()
    $completion.Name = 'KOMPLETACE'
    $completion.Cells.Item(2, 12).Value2 = '1700096195'
    $completion.Cells.Item(2, 1).Value2 = $czech
    $prefix = "'" + $book.Name + "'!TestModule."
    foreach ($mode in @('success', 'http-recover', 'network-recover', 'reentrant', 'unavailable', 'forbidden', 'certificate', 'html-health', 'lost-post', 'post-error', 'unauthorized', 'invalid-post')) {
        $excel.Run($prefix + 'TestReset', $mode)
        $excel.StatusBar = 'Original status'
        $excel.Run($prefix + 'UploadRoztrideniAktualniTabulky')
        $state = $excel.Run($prefix + 'TestState')
        Assert ($excel.StatusBar -eq 'Original status') "$mode did not restore status"
        $success = $mode -in @('success', 'http-recover', 'network-recover', 'reentrant')
        $noPost = $mode -in @('unavailable', 'forbidden', 'certificate', 'html-health')
        Assert ($state[1] -eq $(if ($noPost) { 0 } else { 1 })) "$mode sent wrong number of uploads"
        Assert ($state[2] -eq $(if ($success) { 0 } else { 1 })) "$mode dialog count wrong"
        $gets = if ($mode -eq 'unavailable') { 5 } elseif ($mode -in @('http-recover', 'network-recover')) { 3 } else { 1 }
        Assert ($state[0] -eq $gets) "$mode probe count wrong"
        $waits = if ($gets -eq 5) { '5,10,15,20,' } elseif ($gets -eq 3) { '5,10,' } else { '' }
        Assert ([string]$state[3] -eq $waits) "$mode wait sequence wrong"
        Assert ($state[6] -eq 60000) "$mode probe timeout wrong"
        if (-not $noPost) {
            Assert ($state[7] -eq 180000) "$mode upload timeout wrong"
            $payload = $state[5] | ConvertFrom-Json
            Assert ($payload.datasetKind -eq 'sorting') 'Wrong dataset kind'
            Assert ($payload.rows[0].info -eq $czech) 'Unicode did not survive UTF-8 upload'
        }
        if ($mode -eq 'lost-post') { Assert ($state[4] -like '*data uz mohou byt ulozena*') 'Missing uncertain-upload warning' }
        Write-Output "PASS $mode"
    }
    $sorting.Activate()
    $excel.Run($prefix + 'TestReset', 'success')
    $excel.Run($prefix + 'UploadKompletaceAktualniTabulky')
    $state = $excel.Run($prefix + 'TestState')
    $payload = $state[5] | ConvertFrom-Json
    Assert ($state[2] -eq 0 -and $payload.datasetKind -eq 'completion' -and $payload.rows[0].firstName -eq $czech) 'Completion from another sheet failed'
    Write-Output 'PASS completion from any sheet, silent, Unicode'
    $sorting.Cells.Item(2, 2).ClearContents()
    $excel.Run($prefix + 'TestReset', 'success')
    $excel.Run($prefix + 'UploadRoztrideniAktualniTabulky')
    $state = $excel.Run($prefix + 'TestState')
    Assert ($state[0] -eq 0 -and $state[1] -eq 0 -and $state[2] -eq 1) 'Empty sheet not rejected'
    Write-Output 'PASS empty sheet'
    $sorting.Name = 'MissingEXCEL'
    $excel.Run($prefix + 'TestReset', 'success')
    $excel.Run($prefix + 'UploadRoztrideniAktualniTabulky')
    $state = $excel.Run($prefix + 'TestState')
    Assert ($state[0] -eq 0 -and $state[1] -eq 0 -and $state[2] -eq 1) 'Missing sheet fell back to active sheet'
    Write-Output 'PASS missing sheet'
} finally {
    if ($null -ne $book) { $book.Saved = $true; $book.Close($false) }
    if ($null -ne $excel) { $excel.Quit() }
    foreach ($object in @($completion, $sorting, $httpClass, $module, $book, $excel)) {
        if ($null -ne $object) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($object) }
    }
}
