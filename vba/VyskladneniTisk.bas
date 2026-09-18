Private Const WHPRINT_BASE_URL As String = "https://expedice-production.up.railway.app"

#If VBA7 Then
Private Declare PtrSafe Function WhPrintShellExecute Lib "shell32.dll" Alias "ShellExecuteW" ( _
    ByVal hwnd As LongPtr, ByVal operation As LongPtr, ByVal file As LongPtr, _
    ByVal parameters As LongPtr, ByVal directory As LongPtr, ByVal show As Long) As LongPtr
#Else
Private Declare Function WhPrintShellExecute Lib "shell32.dll" Alias "ShellExecuteW" ( _
    ByVal hwnd As Long, ByVal operation As Long, ByVal file As Long, _
    ByVal parameters As Long, ByVal directory As Long, ByVal show As Long) As Long
#End If

Public Sub VyskladneniNahratATisk()
    On Error GoTo Failed
    Dim ws As Worksheet
    Set ws = ActiveSheet
    Dim lastRow As Long, r As Long, payload As String, rows As String, helperSheets As String
    lastRow = ws.Cells(ws.Rows.Count, "B").End(xlUp).Row
    If lastRow < 2 Then Err.Raise vbObjectError + 801, , "Na aktivnim listu nejsou data vyskladneni."
    If InStr(1, WhPrintCell(ws.Cells(1, 2)), "variant", vbTextCompare) = 0 Or _
       InStr(1, WhPrintCell(ws.Cells(1, 4)), "kam", vbTextCompare) = 0 Or _
       InStr(1, WhPrintCell(ws.Cells(1, 5)), "Celk", vbTextCompare) = 0 Then
        Err.Raise vbObjectError + 802, , "Otevri list vyskladneni: B = kod varianty, C = varianta, D = kolik a kam, E = celkem, F = nazev."
    End If

    For r = 2 To lastRow
        If Len(Trim$(WhPrintCell(ws.Cells(r, 2)))) > 0 Then
            If Len(rows) > 0 Then rows = rows & ","
            rows = rows & "{" & _
                """productCode"":" & WhPrintJson(WhPrintCell(ws.Cells(r, 1))) & "," & _
                """variantCode"":" & WhPrintJson(WhPrintCell(ws.Cells(r, 2))) & "," & _
                """variant"":" & WhPrintJson(WhPrintCell(ws.Cells(r, 3))) & "," & _
                """sequence"":" & WhPrintJson(WhPrintCell(ws.Cells(r, 4))) & "," & _
                """quantity"":" & WhPrintJson(WhPrintCell(ws.Cells(r, 5))) & "," & _
                """info"":" & WhPrintJson(WhPrintCell(ws.Cells(r, 6))) & "}"
        ElseIf Application.CountA(ws.Range(ws.Cells(r, 1), ws.Cells(r, 6))) > 0 Then
            Err.Raise vbObjectError + 803, , "Na radku " & r & " chybi kod varianty."
        End If
    Next r
    If Len(rows) = 0 Then Err.Raise vbObjectError + 804, , "Nejsou vyplnene varianty."
    helperSheets = WhPrintHelperSheets(ws.Parent)

    payload = "{""datasetKind"":""warehouse"",""source"":""excel-vba-print""," & _
        """shopCode"":""unknown"",""shopName"":""Sklad""," & _
        """workbookName"":" & WhPrintJson(ws.Parent.Name) & "," & _
        """worksheetName"":" & WhPrintJson(ws.Name) & "," & _
        """datasetDate"":" & WhPrintJson(Format$(Date, "yyyy-mm-dd")) & "," & _
        """datasetTime"":" & WhPrintJson(Format$(Now, "hh:nn:ss")) & "," & _
        """rows"": [" & rows & "],""helperSheets"":" & helperSheets & "}"
    ' WhPrintJson emits ASCII, so character count equals the UTF-8 byte count.
    If Len(payload) > 2 * 1024 * 1024 Then Err.Raise vbObjectError + 811, , "Tiskova data vcetne pomocnych listu presahuji limit 2 MB. Nic nebylo odeslano."

    Application.StatusBar = "Nahravam vyskladneni k tisku..."
    Dim http As Object
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.setTimeouts 10000, 10000, 30000, 60000
    http.Open "POST", WHPRINT_BASE_URL & "/api/warehouse/render-print", False
    http.setRequestHeader "Content-Type", "application/json; charset=utf-8"
    http.send payload
    If http.Status < 200 Or http.Status >= 300 Then
        Err.Raise vbObjectError + 805, , "HTTP " & http.Status & ": " & http.responseText
    End If

    If InStr(1, http.getResponseHeader("Content-Type"), "text/html", vbTextCompare) = 0 Then
        Err.Raise vbObjectError + 806, , "Server nevratil tiskovou sestavu."
    End If
    Dim files As Object, outputFolder As String, printPath As String, stream As Object
    Set files = CreateObject("Scripting.FileSystemObject")
    outputFolder = files.BuildPath(files.GetSpecialFolder(2), "ExpediceVyskladneni")
    If Not files.FolderExists(outputFolder) Then files.CreateFolder outputFolder
    printPath = files.BuildPath(outputFolder, files.GetBaseName(files.GetTempName) & ".html")
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 1
    stream.Open
    stream.Write http.responseBody
    stream.SaveToFile printPath, 2
    stream.Close
    Application.StatusBar = False
    WhPrintOpenBrowser printPath
    Exit Sub
Failed:
    Application.StatusBar = False
    Dim failure As String
    failure = "Vyskladneni k tisku se nepodarilo:" & vbCrLf & Err.Description
    If Len(printPath) > 0 Then failure = failure & vbCrLf & vbCrLf & "Soubor sestavy: " & printPath
    MsgBox failure, vbExclamation
End Sub

Private Function WhPrintHelperSheets(ByVal book As Workbook) As String
    Dim name As Variant, ws As Worksheet, result As String, cellCount As Long
    For Each name In Array("EXCEL", "KOMPLETACE")
        Set ws = Nothing
        On Error Resume Next
        Set ws = book.Worksheets(CStr(name))
        On Error GoTo 0
        If ws Is Nothing Then Err.Raise vbObjectError + 812, , "V sesitu chybi pomocny list " & CStr(name) & ". Nic nebylo odeslano."
        If Len(result) > 0 Then result = result & ","
        result = result & WhPrintJson(CStr(name)) & ":" & WhPrintSheetJson(ws, cellCount)
    Next name
    WhPrintHelperSheets = "{" & result & "}"
End Function

Private Function WhPrintSheetJson(ByVal ws As Worksheet, ByRef cellCount As Long) As String
    Dim lastCell As Range, lastRow As Long, lastColumn As Long, r As Long, c As Long
    Set lastCell = ws.Cells.Find(What:="*", After:=ws.Cells(1, 1), LookIn:=xlFormulas, _
        LookAt:=xlPart, SearchOrder:=xlByRows, SearchDirection:=xlPrevious, MatchCase:=False, SearchFormat:=False)
    If lastCell Is Nothing Then Err.Raise vbObjectError + 813, , "Pomocny list " & ws.Name & " je prazdny."
    lastRow = lastCell.Row
    Set lastCell = ws.Cells.Find(What:="*", After:=ws.Cells(1, 1), LookIn:=xlFormulas, _
        LookAt:=xlPart, SearchOrder:=xlByColumns, SearchDirection:=xlPrevious, MatchCase:=False, SearchFormat:=False)
    lastColumn = lastCell.Column
    If lastRow > 10000 Or lastColumn > 128 Then Err.Raise vbObjectError + 814, , "Pomocny list " & ws.Name & " presahuje limit 10000 radku nebo 128 sloupcu."
    cellCount = cellCount + lastRow * lastColumn
    If cellCount > 200000 Then Err.Raise vbObjectError + 814, , "Pomocne listy dohromady presahuji limit 200000 bunek."
    Dim values As Variant, lines() As String, fields() As String, value As Variant
    values = ws.Range(ws.Cells(1, 1), ws.Cells(lastRow, lastColumn)).Value2
    ReDim lines(1 To lastRow)
    ReDim fields(1 To lastColumn)
    For r = 1 To lastRow
        For c = 1 To lastColumn
            If lastRow = 1 And lastColumn = 1 Then
                value = values
            Else
                value = values(r, c)
            End If
            If IsError(value) Then Err.Raise vbObjectError + 807, , "Chyba Excelu v " & ws.Name & "!" & ws.Cells(r, c).Address(False, False)
            If IsEmpty(value) Or IsNull(value) Then
                fields(c) = """"""
            Else
                fields(c) = WhPrintJson(CStr(value))
            End If
        Next c
        lines(r) = "[" & Join(fields, ",") & "]"
    Next r
    WhPrintSheetJson = "{""cells"":[" & Join(lines, ",") & "]}"
End Function

Private Sub WhPrintOpenBrowser(ByVal printPath As String)
    Dim files As Object, browser As String, operation As String, arguments As String
    Set files = CreateObject("Scripting.FileSystemObject")
    If Not files.FileExists(printPath) Then Err.Raise vbObjectError + 808, , "Tiskovy soubor nebyl ulozen."
    browser = WhPrintBrowserPath()
    If Len(browser) = 0 Then Err.Raise vbObjectError + 809, , "Webovy prohlizec nebyl nalezen. Otevri soubor sestavy rucne v prohlizeci."
    operation = "open"
    arguments = Chr$(34) & printPath & Chr$(34)
#If VBA7 Then
    Dim result As LongPtr
#Else
    Dim result As Long
#End If
    result = WhPrintShellExecute(0, StrPtr(operation), StrPtr(browser), StrPtr(arguments), 0, 1)
    If result <= 32 Then Err.Raise vbObjectError + 810, , "Prohlizec se nepodarilo otevrit (kod Windows " & CStr(result) & ")."
End Sub

Private Function WhPrintBrowserPath() As String
    Dim shell As Object, files As Object, progId As String, candidate As String
    Dim appName As Variant, root As Variant
    Set shell = CreateObject("WScript.Shell")
    Set files = CreateObject("Scripting.FileSystemObject")
    ' Use the web browser association, never .html (which may open a text editor).
    progId = WhPrintRegRead(shell, "HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice\ProgId")
    If Len(progId) > 0 Then
        candidate = WhPrintExecutable(WhPrintRegRead(shell, "HKCR\" & progId & "\shell\open\command\"))
        candidate = shell.ExpandEnvironmentStrings(candidate)
        If files.FileExists(candidate) Then
            WhPrintBrowserPath = candidate
            Exit Function
        End If
    End If
    For Each appName In Array("chrome.exe", "msedge.exe", "firefox.exe")
        For Each root In Array("HKCU", "HKLM")
            candidate = WhPrintRegRead(shell, CStr(root) & "\Software\Microsoft\Windows\CurrentVersion\App Paths\" & CStr(appName) & "\")
            candidate = shell.ExpandEnvironmentStrings(candidate)
            If files.FileExists(candidate) Then
                WhPrintBrowserPath = candidate
                Exit Function
            End If
        Next root
    Next appName
End Function

Private Function WhPrintRegRead(ByVal shell As Object, ByVal key As String) As String
    On Error Resume Next
    WhPrintRegRead = CStr(shell.RegRead(key))
    On Error GoTo 0
End Function

Private Function WhPrintExecutable(ByVal command As String) As String
    Dim ending As Long
    command = Trim$(command)
    If Left$(command, 1) = Chr$(34) Then
        ending = InStr(2, command, Chr$(34))
        If ending > 2 Then WhPrintExecutable = Mid$(command, 2, ending - 2)
    Else
        ending = InStr(1, command, ".exe", vbTextCompare)
        If ending > 0 Then WhPrintExecutable = Left$(command, ending + 3)
    End If
    If LCase$(Right$(WhPrintExecutable, 4)) <> ".exe" Then WhPrintExecutable = ""
End Function

Public Sub VlozitTlacitkoVyskladneniTisk()
    Dim ws As Worksheet, button As Shape
    Set ws = ActiveSheet
    On Error Resume Next
    Set button = ws.Shapes("VyskladneniTiskButton")
    On Error GoTo 0
    If button Is Nothing Then
        Set button = ws.Shapes.AddFormControl(xlButtonControl, ws.Range("H2").Left, ws.Range("H2").Top, 180, 32)
        button.Name = "VyskladneniTiskButton"
    End If
    button.TextFrame.Characters.Text = "Vyskladneni k tisku"
    button.OnAction = "'" & Replace(ThisWorkbook.Name, "'", "''") & "'!VyskladneniNahratATisk"
End Sub

Private Function WhPrintCell(ByVal cell As Range) As String
    If IsError(cell.Value) Then
        Err.Raise vbObjectError + 807, , "Chyba Excelu v bunce " & cell.Address(False, False)
    ElseIf IsEmpty(cell.Value) Or IsNull(cell.Value) Then
        WhPrintCell = ""
    Else
        WhPrintCell = CStr(cell.Value)
    End If
End Function

Private Function WhPrintJson(ByVal value As String) As String
    Dim i As Long, code As Long, ch As String, result As String
    result = Chr$(34)
    For i = 1 To Len(value)
        ch = Mid$(value, i, 1)
        code = AscW(ch)
        If code < 0 Then code = code + 65536
        Select Case code
            Case 34: result = result & Chr$(92) & Chr$(34)
            Case 92: result = result & Chr$(92) & Chr$(92)
            Case 0 To 31, 127 To 65535
                result = result & "\u" & Right$("0000" & Hex$(code), 4)
            Case Else: result = result & ch
        End Select
    Next i
    WhPrintJson = result & Chr$(34)
End Function
