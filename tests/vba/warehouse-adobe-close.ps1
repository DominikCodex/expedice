$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$source = Get-Content -LiteralPath (Join-Path $root 'vba/VyskladneniTisk.bas') -Raw
# Replace every external effect used by the monitor. Never launch Adobe or print.
$replacements = @{
    WhPrintCreateAdobe = 'Private Function WhPrintCreateAdobe(ByVal executable As String, ByVal arguments As String) As Long
    testLaunches = testLaunches + 1
    WhPrintCreateAdobe = 200
End Function'
    WhPrintProcessCreated = 'Private Function WhPrintProcessCreated(ByVal pid As Long) As String
    If pid <> 200 Then Err.Raise 5
    WhPrintProcessCreated = mockCreated
End Function'
    WhPrintQueueSnapshot = 'Private Function WhPrintQueueSnapshot(ByVal printer As String) As Object
    If mockQueueError Then Err.Raise 5, , "Queue unavailable"
    If printer <> "Test printer" Then Err.Raise 5
    Set WhPrintQueueSnapshot = testJobs
End Function'
}
foreach ($name in $replacements.Keys) {
    $pattern = '(?ms)^Private Function ' + $name + '\(.*?^End Function'
    if ([regex]::Matches($source, $pattern).Count -ne 1) { throw "Missing test boundary: $name" }
    $source = [regex]::Replace($source, $pattern, $replacements[$name])
}
$schedulePattern = '(?ms)^Private Sub WhPrintScheduleAdobeCheck\(\).*?^End Sub'
if ([regex]::Matches($source, $schedulePattern).Count -ne 1) { throw 'Missing scheduler boundary' }
$source = [regex]::Replace($source, $schedulePattern, 'Private Sub WhPrintScheduleAdobeCheck()
    testScheduled = testScheduled + 1
End Sub')
$source = [regex]::Replace($source, '(?m)^Private Declare(?: PtrSafe)? Function WhPrint(?:EnumWindows|WindowPid|GetWindow|WindowTitleLength|PostMessage) .+\r?\n', '')
$source = [regex]::Replace($source, '\bMsgBox\b', 'TestMessage')
if ($source -match 'service.Get\("Win32_Process"\).Create|Application.OnTime|Declare.*(?:EnumWindows|PostMessageW)') { throw 'Unintercepted monitor side effect' }
$declarations = @'
Private testJobs As Object
Private mockCreated As String
Private mockQueueError As Boolean
Private testLaunches As Long
Private testScheduled As Long
Private testCloses As Long
Private testMessages As Long
Private testMessageText As String
Private mockNoWindow As Boolean
'@
$harness = @'
Public Sub TestMessage(ByVal message As String, Optional ByVal style As Long = 0)
    testMessages = testMessages + 1
    testMessageText = message
End Sub
Public Sub TestReset()
    WhPrintResetAdobe
    Set testJobs = CreateObject("Scripting.Dictionary")
    mockCreated = "owned-instance-created-at-1"
    mockQueueError = False
    mockNoWindow = False
    testLaunches = 0
    testCloses = 0
    testMessages = 0
    testScheduled = 0
    testMessageText = ""
End Sub
Public Sub TestStart()
    On Error GoTo Failed
    WhPrintStartAdobe "C:\Adobe\Acrobat.exe", "/n /s /h /t test.pdf", "C:\Sklad\test.pdf", "Test printer"
    Exit Sub
Failed:
    TestMessage Err.Description
End Sub
Public Sub TestJob(ByVal key As String, ByVal document As String, ByVal status As Long)
    ' Snapshots must be independent, just like the WMI adapter.
    Dim copy As Object, existing As Variant
    Set copy = CreateObject("Scripting.Dictionary")
    For Each existing In testJobs.Keys
        copy(existing) = testJobs(existing)
    Next existing
    If Len(document) > 0 Then
        copy(key) = Array(document, status)
    ElseIf copy.Exists(key) Then
        copy.Remove key
    End If
    Set testJobs = copy
End Sub
Public Sub TestCreated(ByVal value As String)
    mockCreated = value
End Sub
Public Sub TestQueueError()
    mockQueueError = True
End Sub
Public Sub TestNoWindow()
    mockNoWindow = True
End Sub
Public Sub TestExpire()
    whPrintAdobeDeadline = DateAdd("s", -1, Now)
End Sub
Public Function TestState() As Variant
    TestState = Array(testLaunches, testCloses, testMessages, whPrintAdobePid, testScheduled, testMessageText)
End Function
#If VBA7 Then
Private Function WhPrintEnumWindows(ByVal callback As LongPtr, ByVal parameter As LongPtr) As Long
#Else
Private Function WhPrintEnumWindows(ByVal callback As Long, ByVal parameter As Long) As Long
#End If
    Dim index As Long
    For index = 1 To 4
        WhPrintAdobeCloseWindow index, 0
    Next index
    WhPrintEnumWindows = 1
End Function
#If VBA7 Then
Private Function WhPrintWindowPid(ByVal hwnd As LongPtr, ByRef pid As Long) As Long
#Else
Private Function WhPrintWindowPid(ByVal hwnd As Long, ByRef pid As Long) As Long
#End If
    pid = 200
    If hwnd = 2 Then pid = 100
End Function
#If VBA7 Then
Private Function WhPrintGetWindow(ByVal hwnd As LongPtr, ByVal command As Long) As LongPtr
#Else
Private Function WhPrintGetWindow(ByVal hwnd As Long, ByVal command As Long) As Long
#End If
    If hwnd = 3 Then WhPrintGetWindow = 1
End Function
#If VBA7 Then
Private Function WhPrintWindowTitleLength(ByVal hwnd As LongPtr) As Long
#Else
Private Function WhPrintWindowTitleLength(ByVal hwnd As Long) As Long
#End If
    If hwnd <> 4 And Not mockNoWindow Then WhPrintWindowTitleLength = 10
End Function
#If VBA7 Then
Private Function WhPrintPostMessage(ByVal hwnd As LongPtr, ByVal message As Long, ByVal wParam As LongPtr, ByVal lParam As LongPtr) As Long
#Else
Private Function WhPrintPostMessage(ByVal hwnd As Long, ByVal message As Long, ByVal wParam As Long, ByVal lParam As Long) As Long
#End If
    If hwnd <> 1 Or message <> &H10 Then Err.Raise 5, , "Unsafe window close"
    testCloses = testCloses + 1
    WhPrintPostMessage = 1
End Function
'@
$excel = $null
$book = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $book = $excel.Workbooks.Add()
    $module = $book.VBProject.VBComponents.Add(1)
    $module.Name = 'CloseTest'
    $module.CodeModule.AddFromString($declarations + "`r`n" + $source + "`r`n" + $harness)
    $prefix = "'$($book.Name)'!CloseTest."
    function Run($name, $a, $b, $c) {
        switch ($args.Count + $PSBoundParameters.Count - 1) {
            0 { $excel.Run($prefix + $name) }
            1 { $excel.Run($prefix + $name, $a) }
            2 { $excel.Run($prefix + $name, $a, $b) }
            3 { $excel.Run($prefix + $name, $a, $b, $c) }
        }
    }
    function AssertState($closes, $messages, $expectedPid) {
        $state = Run 'TestState'
        if ($state[1] -ne $closes -or $state[2] -ne $messages -or $state[3] -ne $expectedPid) {
            throw ('Unexpected state: ' + ($state -join '|'))
        }
    }
    Run 'TestReset'
    Run 'TestStart'
    AssertState 0 0 200
    Run 'TestJob' 'job1' 'C:\Sklad\test.pdf' 8
    Run 'VyskladneniDokoncitTiskAdobe'
    AssertState 0 0 200
    Run 'TestJob' 'job1' 'C:\Sklad\test.pdf' 16
    Run 'VyskladneniDokoncitTiskAdobe'
    AssertState 0 0 200
    Run 'TestJob' 'job1' '' 0
    Run 'VyskladneniDokoncitTiskAdobe'
    AssertState 1 0 200
    Run 'TestCreated' ''
    Run 'VyskladneniDokoncitTiskAdobe'
    AssertState 1 0 0
    Write-Output 'PASS: Spooling/printing stays open; removed job closes only owned top-level window; process exit is silent.'

    foreach ($status in @(128, 4096)) {
        Run 'TestReset'
        Run 'TestStart'
        Run 'TestJob' 'job1' 'test' $status
        Run 'VyskladneniDokoncitTiskAdobe'
        AssertState 1 0 200
    }
    foreach ($status in @(1, 2, 4, 8, 16, 32, 64, 512, 1024, 2048)) {
        Run 'TestReset'
        Run 'TestStart'
        Run 'TestJob' 'job1' 'test.pdf' ($status -bor 128)
        Run 'VyskladneniDokoncitTiskAdobe'
        AssertState 0 0 200
    }
    Write-Output 'PASS: Completion and printer-error state precedence.'

    Run 'TestReset'
    Run 'TestJob' 'old' 'test.pdf' 128
    Run 'TestStart'
    Run 'TestJob' 'foreign' 'other.pdf' 128
    Run 'VyskladneniDokoncitTiskAdobe'
    AssertState 0 0 200
    Run 'TestExpire'
    Run 'VyskladneniDokoncitTiskAdobe'
    AssertState 0 1 0
    Write-Output 'PASS: Existing/unrelated jobs never authorize closing; unobserved/slow job times out without closure.'

    Run 'TestReset'
    Run 'TestStart'
    Run 'TestJob' 'job1' 'test.pdf' 128
    Run 'TestJob' 'job2' 'test.pdf' 16
    Run 'VyskladneniDokoncitTiskAdobe'
    AssertState 0 0 200
    Run 'TestJob' 'job2' '' 0
    Run 'VyskladneniDokoncitTiskAdobe'
    AssertState 1 0 200
    Run 'TestExpire'
    Run 'VyskladneniDokoncitTiskAdobe'
    AssertState 1 1 0
    Write-Output 'PASS: All matching jobs must finish; an application refusing normal closure is not killed.'

    foreach ($identity in @('', 'different-process-reused-pid')) {
        Run 'TestReset'
        Run 'TestStart'
        Run 'TestJob' 'job1' 'test.pdf' 128
        Run 'TestCreated' $identity
        Run 'VyskladneniDokoncitTiskAdobe'
        AssertState 0 0 0
    }
    Run 'TestReset'
    Run 'TestQueueError'
    Run 'TestStart'
    AssertState 0 1 0
    if ((Run 'TestState')[0] -ne 0) { throw 'Launch occurred without baseline' }
    Run 'TestReset'
    Run 'TestStart'
    Run 'TestQueueError'
    Run 'VyskladneniDokoncitTiskAdobe'
    AssertState 0 1 0
    Write-Output 'PASS: Reused PID, exited instance and WMI failures never close another application.'

    Run 'TestReset'
    Run 'TestStart'
    Run 'TestStart'
    AssertState 0 1 200
    if ((Run 'TestState')[0] -ne 1) { throw 'Overlapping launch occurred' }
    Run 'TestReset'
    Run 'TestStart'
    Run 'TestJob' 'job1' 'test.pdf' 128
    Run 'TestNoWindow'
    Run 'VyskladneniDokoncitTiskAdobe'
    AssertState 0 1 0
    Write-Output 'PASS: Duplicate start blocked; missing owned window reports error without forced termination.'
} finally {
    if ($book) { $book.Close($false) }
    if ($excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
}
