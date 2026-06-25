Private Const EXPEDICE_UPLOAD_URL As String = "https://expedice-production.up.railway.app/api/datasets/upload"
Private Const EXPEDICE_UPLOAD_TOKEN As String = ""

Public Sub UploadRoztrideniAktualniTabulky()
    ExpediceUploadSheet "sorting", "EXCEL"
End Sub

Public Sub UploadKompletaceAktualniTabulky()
    ExpediceUploadSheet "completion", "KOMPLETACE"
End Sub

Private Sub ExpediceUploadSheet(ByVal datasetKind As String, ByVal sheetName As String)
    On Error GoTo ErrHandler

    Dim ws As Worksheet
    Set ws = ExpediceResolveSheet(sheetName)

    Dim lastRow As Long
    lastRow = ExpediceLastDataRow(ws, datasetKind)
    If lastRow < 2 Then
        MsgBox "Na listu " & ws.Name & " nejsou zadne radky k uploadu.", vbExclamation
        Exit Sub
    End If

    Dim lastCol As Long
    lastCol = ExpediceLastUsedColumn(ws)
    If datasetKind = "completion" And lastCol < 50 Then lastCol = 50
    If datasetKind = "sorting" And lastCol < 30 Then lastCol = 30

    Dim payload As String
    payload = ExpediceBuildPayload(ws, datasetKind, lastRow, lastCol)

    Dim responseText As String
    responseText = ExpedicePostJson(EXPEDICE_UPLOAD_URL, EXPEDICE_UPLOAD_TOKEN, payload)

    MsgBox "Upload hotovy: " & sheetName & vbCrLf & ExpediceUploadSummary(responseText), vbInformation
    Exit Sub

ErrHandler:
    MsgBox "Upload se nepodaril: " & sheetName & vbCrLf & Err.Description, vbCritical
End Sub

Private Function ExpediceResolveSheet(ByVal sheetName As String) As Worksheet
    On Error Resume Next
    Set ExpediceResolveSheet = ThisWorkbook.Worksheets(sheetName)
    On Error GoTo 0

    If ExpediceResolveSheet Is Nothing Then
        Set ExpediceResolveSheet = ActiveSheet
    End If
End Function

Private Function ExpediceLastDataRow(ByVal ws As Worksheet, ByVal datasetKind As String) As Long
    If datasetKind = "completion" Then
        Dim lastA As Long
        Dim lastL As Long
        Dim lastU As Long

        lastA = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
        lastL = ws.Cells(ws.Rows.Count, "L").End(xlUp).Row
        lastU = ws.Cells(ws.Rows.Count, "U").End(xlUp).Row

        ExpediceLastDataRow = lastA
        If lastL > ExpediceLastDataRow Then ExpediceLastDataRow = lastL
        If lastU > ExpediceLastDataRow Then ExpediceLastDataRow = lastU
    Else
        ExpediceLastDataRow = ws.Cells(ws.Rows.Count, "B").End(xlUp).Row
    End If
End Function

Private Function ExpediceLastUsedColumn(ByVal ws As Worksheet) As Long
    Dim usedLast As Long
    Dim headerLast As Long

    headerLast = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
    With ws.UsedRange
        usedLast = .Column + .Columns.Count - 1
    End With

    If usedLast > headerLast Then
        ExpediceLastUsedColumn = usedLast
    Else
        ExpediceLastUsedColumn = headerLast
    End If
End Function

Private Function ExpediceBuildPayload(ByVal ws As Worksheet, ByVal datasetKind As String, ByVal lastRow As Long, ByVal lastCol As Long) As String
    Dim sb As String
    Dim r As Long
    Dim rowJson As String
    Dim batchName As String

    batchName = ExpediceBatchName()

    sb = "{"
    sb = sb & ExpediceJsonPair("datasetKind", datasetKind) & ","
    sb = sb & ExpediceJsonPair("expeditionDayDate", Format$(Date, "yyyy-mm-dd")) & ","
    sb = sb & ExpediceJsonPair("batchName", batchName) & ","
    sb = sb & ExpediceJsonPair("replaceMode", "replace-active") & ","
    sb = sb & ExpediceJsonPair("source", "excel-vba") & ","
    sb = sb & ExpediceJsonPair("workbookName", ThisWorkbook.Name) & ","
    sb = sb & ExpediceJsonPair("worksheetName", ws.Name) & ","
    sb = sb & ExpediceJsonPair("datasetDate", Format$(Date, "yyyy-mm-dd")) & ","
    sb = sb & ExpediceJsonPair("datasetTime", Format$(Now, "hh:nn:ss")) & ","
    sb = sb & ExpediceJsonPair("uploadedAtLocal", Format$(Now, "yyyy-mm-dd\Thh:nn:ss")) & ","
    sb = sb & ExpediceJsonPair("label", batchName & " " & ExpediceDatasetKindLabel(datasetKind) & " " & Format$(Now, "hh:nn:ss")) & ","
    sb = sb & """lastRow"":" & CStr(lastRow) & ","
    sb = sb & """lastCol"":" & CStr(lastCol) & ","
    sb = sb & """headers"":" & ExpediceBuildHeaders(ws, lastCol) & ","
    sb = sb & """rows"":["

    For r = 2 To lastRow
        If ExpediceShouldUploadRow(ws, datasetKind, r) Then
            rowJson = ExpediceBuildRowObject(ws, datasetKind, r, lastCol)
            If Right$(sb, 1) <> "[" Then sb = sb & ","
            sb = sb & rowJson
        End If
    Next r

    sb = sb & "]}"
    ExpediceBuildPayload = sb
End Function

Private Function ExpediceBatchName() As String
    ExpediceBatchName = Format$(Date, "d.m.yyyy")
End Function

Private Function ExpediceDatasetKindLabel(ByVal datasetKind As String) As String
    If datasetKind = "completion" Then
        ExpediceDatasetKindLabel = "Kompletace"
    Else
        ExpediceDatasetKindLabel = "Roztřídění"
    End If
End Function

Private Function ExpediceUploadSummary(ByVal responseText As String) As String
    Dim message As String

    If InStr(1, responseText, """replacedDatasets"":[]", vbTextCompare) > 0 Then
        message = "Vznikla nova aktivni davka."
    ElseIf InStr(1, responseText, """replacedDatasets"":", vbTextCompare) > 0 Then
        message = "Predchozi aktivni davka pro stejny den byla oznacena jako nahrazena."
    Else
        message = "Server upload prijal."
    End If

    ExpediceUploadSummary = message & vbCrLf & responseText
End Function

Private Function ExpediceShouldUploadRow(ByVal ws As Worksheet, ByVal datasetKind As String, ByVal r As Long) As Boolean
    If datasetKind = "completion" Then
        ExpediceShouldUploadRow = Len(Trim$(ExpediceCellString(ws.Cells(r, 12)))) > 0 Or Len(Trim$(ExpediceCellString(ws.Cells(r, 21)))) > 0
    Else
        ExpediceShouldUploadRow = Len(Trim$(ExpediceCellString(ws.Cells(r, 2)))) > 0
    End If
End Function

Private Function ExpediceBuildHeaders(ByVal ws As Worksheet, ByVal lastCol As Long) As String
    Dim c As Long
    Dim sb As String

    sb = "["
    For c = 1 To lastCol
        If c > 1 Then sb = sb & ","
        sb = sb & ExpediceJsonString(ExpediceCellString(ws.Cells(1, c)))
    Next c
    sb = sb & "]"

    ExpediceBuildHeaders = sb
End Function

Private Function ExpediceBuildRowObject(ByVal ws As Worksheet, ByVal datasetKind As String, ByVal r As Long, ByVal lastCol As Long) As String
    If datasetKind = "completion" Then
        ExpediceBuildRowObject = ExpediceBuildCompletionRow(ws, r, lastCol)
    Else
        ExpediceBuildRowObject = ExpediceBuildSortingRow(ws, r, lastCol)
    End If
End Function

Private Function ExpediceBuildSortingRow(ByVal ws As Worksheet, ByVal r As Long, ByVal lastCol As Long) As String
    Dim sb As String

    sb = "{"
    sb = sb & """rowNumber"":" & CStr(r) & ","
    sb = sb & ExpediceJsonPair("productCode", ExpediceCellString(ws.Cells(r, 2))) & ","
    sb = sb & ExpediceJsonPair("variantCode", ExpediceCellString(ws.Cells(r, 3))) & ","
    sb = sb & ExpediceJsonPair("variant", ExpediceCellString(ws.Cells(r, 4))) & ","
    sb = sb & ExpediceJsonPair("quantity", ExpediceCellString(ws.Cells(r, 5))) & ","
    sb = sb & ExpediceJsonPair("orderNumber", ExpediceCellString(ws.Cells(r, 6))) & ","
    sb = sb & ExpediceJsonPair("weight", ExpediceCellString(ws.Cells(r, 7))) & ","
    sb = sb & ExpediceJsonPair("sequence", ExpediceCellString(ws.Cells(r, 8))) & ","
    sb = sb & ExpediceJsonPair("info", ExpediceCellString(ws.Cells(r, 10))) & ","
    sb = sb & ExpediceJsonPair("initialQuantity", ExpediceCellString(ws.Cells(r, 11))) & ","
    sb = sb & ExpediceJsonPair("paircode", ExpediceCellString(ws.Cells(r, 12))) & ","
    sb = sb & ExpediceJsonPair("history", ExpediceCellString(ws.Cells(r, 13))) & ","
    sb = sb & """cells"":" & ExpediceBuildCellArray(ws, r, lastCol)
    sb = sb & "}"

    ExpediceBuildSortingRow = sb
End Function

Private Function ExpediceBuildCompletionRow(ByVal ws As Worksheet, ByVal r As Long, ByVal lastCol As Long) As String
    Dim sb As String

    sb = "{"
    sb = sb & """rowNumber"":" & CStr(r) & ","
    sb = sb & ExpediceJsonPair("firstName", ExpediceCellString(ws.Cells(r, 1))) & ","
    sb = sb & ExpediceJsonPair("lastName", ExpediceCellString(ws.Cells(r, 2))) & ","
    sb = sb & ExpediceJsonPair("note", ExpediceCellString(ws.Cells(r, 3))) & ","
    sb = sb & ExpediceJsonPair("streetWithNumber", ExpediceCellString(ws.Cells(r, 4))) & ","
    sb = sb & ExpediceJsonPair("city", ExpediceCellString(ws.Cells(r, 5))) & ","
    sb = sb & ExpediceJsonPair("zipCode", ExpediceCellString(ws.Cells(r, 6))) & ","
    sb = sb & ExpediceJsonPair("phone", ExpediceCellString(ws.Cells(r, 7))) & ","
    sb = sb & ExpediceJsonPair("email", ExpediceCellString(ws.Cells(r, 8))) & ","
    sb = sb & ExpediceJsonPair("weight", ExpediceCellString(ws.Cells(r, 9))) & ","
    sb = sb & ExpediceJsonPair("codAmount", ExpediceCellString(ws.Cells(r, 10))) & ","
    sb = sb & ExpediceJsonPair("paymentMethod", ExpediceCellString(ws.Cells(r, 11))) & ","
    sb = sb & ExpediceJsonPair("orderNumber", ExpediceCellString(ws.Cells(r, 12))) & ","
    sb = sb & ExpediceJsonPair("shippingMethod", ExpediceCellString(ws.Cells(r, 13))) & ","
    sb = sb & ExpediceJsonPair("amount", ExpediceCellString(ws.Cells(r, 14))) & ","
    sb = sb & ExpediceJsonPair("quantity", ExpediceCellString(ws.Cells(r, 15))) & ","
    sb = sb & ExpediceJsonPair("paidStatus", ExpediceCellString(ws.Cells(r, 16))) & ","
    sb = sb & ExpediceJsonPair("expeditionNumber", ExpediceCellString(ws.Cells(r, 17))) & ","
    sb = sb & ExpediceJsonPair("expeditionOrderCode", ExpediceCellString(ws.Cells(r, 18))) & ","
    sb = sb & ExpediceJsonPair("packetaId", ExpediceCellString(ws.Cells(r, 19))) & ","
    sb = sb & ExpediceJsonPair("completionStatus", ExpediceCellString(ws.Cells(r, 20))) & ","
    sb = sb & ExpediceJsonPair("orderId", ExpediceCellString(ws.Cells(r, 21))) & ","
    sb = sb & ExpediceJsonPair("street", ExpediceCellString(ws.Cells(r, 22))) & ","
    sb = sb & ExpediceJsonPair("houseNumber", ExpediceCellString(ws.Cells(r, 23))) & ","
    sb = sb & ExpediceJsonPair("dpdFlag", ExpediceCellString(ws.Cells(r, 24))) & ","
    sb = sb & ExpediceJsonPair("packetaStatus", ExpediceCellString(ws.Cells(r, 25))) & ","
    sb = sb & ExpediceJsonPair("packetaShipmentId", ExpediceCellString(ws.Cells(r, 26))) & ","
    sb = sb & ExpediceJsonPair("orderDate", ExpediceCellString(ws.Cells(r, 27))) & ","
    sb = sb & ExpediceJsonPair("twistoPaid", ExpediceCellString(ws.Cells(r, 29))) & ","
    sb = sb & ExpediceJsonPair("dpdOrderAndPieces", ExpediceCellString(ws.Cells(r, 31))) & ","
    sb = sb & ExpediceJsonPair("canceledOrderBackup", ExpediceCellString(ws.Cells(r, 34))) & ","
    sb = sb & ExpediceJsonPair("labelPrinted", ExpediceCellString(ws.Cells(r, 38))) & ","
    sb = sb & """cells"":" & ExpediceBuildCellArray(ws, r, lastCol)
    sb = sb & "}"

    ExpediceBuildCompletionRow = sb
End Function

Private Function ExpediceBuildCellArray(ByVal ws As Worksheet, ByVal r As Long, ByVal lastCol As Long) As String
    Dim c As Long
    Dim sb As String

    sb = "["
    For c = 1 To lastCol
        If c > 1 Then sb = sb & ","
        sb = sb & ExpediceJsonString(ExpediceCellString(ws.Cells(r, c)))
    Next c
    sb = sb & "]"

    ExpediceBuildCellArray = sb
End Function

Private Function ExpedicePostJson(ByVal url As String, ByVal token As String, ByVal payload As String) As String
    Dim http As Object
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")

    http.Open "POST", url, False
    http.setTimeouts 10000, 10000, 30000, 30000
    http.setRequestHeader "Content-Type", "application/json; charset=utf-8"
    If Len(token) > 0 Then http.setRequestHeader "X-Upload-Token", token
    http.send ExpediceUtf8Bytes(payload)

    If http.Status < 200 Or http.Status >= 300 Then
        Err.Raise vbObjectError + 303, , "Server vratil HTTP " & http.Status & ": " & http.responseText
    End If

    ExpedicePostJson = http.responseText
End Function

Private Function ExpediceUtf8Bytes(ByVal text As String) As Variant
    Dim stream As Object
    Set stream = CreateObject("ADODB.Stream")

    stream.Type = 2
    stream.Charset = "utf-8"
    stream.Open
    stream.WriteText text
    stream.Position = 0
    stream.Type = 1
    ExpediceUtf8Bytes = stream.Read
    stream.Close
End Function

Private Function ExpediceJsonPair(ByVal key As String, ByVal value As String) As String
    ExpediceJsonPair = ExpediceJsonString(key) & ":" & ExpediceJsonString(value)
End Function

Private Function ExpediceJsonString(ByVal value As String) As String
    Dim i As Long
    Dim ch As String
    Dim code As Long
    Dim sb As String

    sb = Chr$(34)
    For i = 1 To Len(value)
        ch = Mid$(value, i, 1)
        code = AscW(ch)

        Select Case ch
            Case Chr$(34)
                sb = sb & "\" & Chr$(34)
            Case "\"
                sb = sb & "\\"
            Case vbCr
                sb = sb & "\r"
            Case vbLf
                sb = sb & "\n"
            Case vbTab
                sb = sb & "\t"
            Case Else
                If code >= 0 And code < 32 Then
                    sb = sb & "\u" & Right$("0000" & Hex$(code), 4)
                Else
                    sb = sb & ch
                End If
        End Select
    Next i
    sb = sb & Chr$(34)

    ExpediceJsonString = sb
End Function

Private Function ExpediceCellString(ByVal cell As Range) As String
    If IsError(cell.Value) Then
        ExpediceCellString = ""
    ElseIf IsEmpty(cell.Value) Or IsNull(cell.Value) Then
        ExpediceCellString = ""
    Else
        ExpediceCellString = CStr(cell.Value)
    End If
End Function
