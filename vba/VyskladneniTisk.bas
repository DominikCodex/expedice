Private Const WHPRINT_BASE_URL As String = "https://expedice-production.up.railway.app"

Public Sub VyskladneniNahratATisk()
    On Error GoTo Failed
    Dim ws As Worksheet
    Set ws = ActiveSheet
    Dim lastRow As Long, r As Long, payload As String, rows As String
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

    payload = "{""datasetKind"":""warehouse"",""source"":""excel-vba-print""," & _
        """shopCode"":""unknown"",""shopName"":""Sklad""," & _
        """workbookName"":" & WhPrintJson(ws.Parent.Name) & "," & _
        """worksheetName"":" & WhPrintJson(ws.Name) & "," & _
        """datasetDate"":" & WhPrintJson(Format$(Date, "yyyy-mm-dd")) & "," & _
        """datasetTime"":" & WhPrintJson(Format$(Now, "hh:nn:ss")) & "," & _
        """rows"": [" & rows & "]}"

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
    ws.Parent.FollowHyperlink Address:=printPath, NewWindow:=True
    Exit Sub
Failed:
    Application.StatusBar = False
    MsgBox "Vyskladneni k tisku se nepodarilo:" & vbCrLf & Err.Description, vbExclamation
End Sub

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
