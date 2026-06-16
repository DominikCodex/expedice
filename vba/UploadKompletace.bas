Private Const KOMPLETACE_UPLOAD_URL As String = "https://expedice-production.up.railway.app/api/datasets/upload"
Private Const KOMPLETACE_UPLOAD_TOKEN As String = ""
Private Const KOMPLETACE_SHEET_NAME As String = "KOMPLETACE"

Public Sub UploadKompletaceAktualniTabulky()
    On Error GoTo ErrHandler

    Dim ws As Worksheet
    Set ws = KompletaceResolveSheet()

    Dim lastRow As Long
    lastRow = KompletaceLastDataRow(ws)
    If lastRow < 2 Then
        MsgBox "Na listu KOMPLETACE nejsou zadne radky k uploadu.", vbExclamation
        Exit Sub
    End If

    Dim lastCol As Long
    lastCol = KompletaceLastUsedColumn(ws)
    If lastCol < 44 Then lastCol = 44

    Dim payload As String
    payload = KompletaceBuildPayload(ws, lastRow, lastCol)

    Dim responseText As String
    responseText = KompletacePostJson(KOMPLETACE_UPLOAD_URL, KOMPLETACE_UPLOAD_TOKEN, payload)

    MsgBox "Upload KOMPLETACE hotovy." & vbCrLf & responseText, vbInformation
    Exit Sub

ErrHandler:
    MsgBox "Upload KOMPLETACE se nepodaril:" & vbCrLf & Err.Description, vbCritical
End Sub

Private Function KompletaceResolveSheet() As Worksheet
    On Error Resume Next
    Set KompletaceResolveSheet = ThisWorkbook.Worksheets(KOMPLETACE_SHEET_NAME)
    On Error GoTo 0

    If KompletaceResolveSheet Is Nothing Then
        Set KompletaceResolveSheet = ActiveSheet
    End If
End Function

Private Function KompletaceLastDataRow(ByVal ws As Worksheet) As Long
    Dim lastA As Long
    Dim lastL As Long
    Dim lastU As Long

    lastA = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row
    lastL = ws.Cells(ws.Rows.Count, "L").End(xlUp).Row
    lastU = ws.Cells(ws.Rows.Count, "U").End(xlUp).Row

    KompletaceLastDataRow = lastA
    If lastL > KompletaceLastDataRow Then KompletaceLastDataRow = lastL
    If lastU > KompletaceLastDataRow Then KompletaceLastDataRow = lastU
End Function

Private Function KompletaceLastUsedColumn(ByVal ws As Worksheet) As Long
    Dim usedLast As Long
    Dim headerLast As Long

    headerLast = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
    With ws.UsedRange
        usedLast = .Column + .Columns.Count - 1
    End With

    If usedLast > headerLast Then
        KompletaceLastUsedColumn = usedLast
    Else
        KompletaceLastUsedColumn = headerLast
    End If
End Function

Private Function KompletaceBuildPayload(ByVal ws As Worksheet, ByVal lastRow As Long, ByVal lastCol As Long) As String
    Dim sb As String
    Dim r As Long

    sb = "{"
    sb = sb & KompletaceJsonPair("datasetKind", "completion") & ","
    sb = sb & KompletaceJsonPair("source", "excel-vba-kompletace") & ","
    sb = sb & KompletaceJsonPair("workbookName", ThisWorkbook.Name) & ","
    sb = sb & KompletaceJsonPair("worksheetName", ws.Name) & ","
    sb = sb & KompletaceJsonPair("datasetDate", Format$(Date, "yyyy-mm-dd")) & ","
    sb = sb & KompletaceJsonPair("datasetTime", Format$(Now, "hh:nn:ss")) & ","
    sb = sb & KompletaceJsonPair("uploadedAtLocal", Format$(Now, "yyyy-mm-dd\Thh:nn:ss")) & ","
    sb = sb & KompletaceJsonPair("label", "KOMPLETACE " & Format$(Now, "yyyy-mm-dd hh:nn:ss")) & ","
    sb = sb & """lastRow"":" & CStr(lastRow) & ","
    sb = sb & """lastCol"":" & CStr(lastCol) & ","
    sb = sb & """headers"":" & KompletaceBuildHeaders(ws, lastCol) & ","
    sb = sb & """rows"":["

    For r = 2 To lastRow
        If Len(Trim$(KompletaceCellString(ws.Cells(r, 12)))) > 0 Or Len(Trim$(KompletaceCellString(ws.Cells(r, 21)))) > 0 Then
            If Right$(sb, 1) <> "[" Then sb = sb & ","
            sb = sb & KompletaceBuildRowObject(ws, r, lastCol)
        End If
    Next r

    sb = sb & "]}"
    KompletaceBuildPayload = sb
End Function

Private Function KompletaceBuildHeaders(ByVal ws As Worksheet, ByVal lastCol As Long) As String
    Dim c As Long
    Dim sb As String

    sb = "["
    For c = 1 To lastCol
        If c > 1 Then sb = sb & ","
        sb = sb & KompletaceJsonString(KompletaceCellString(ws.Cells(1, c)))
    Next c
    sb = sb & "]"

    KompletaceBuildHeaders = sb
End Function

Private Function KompletaceBuildRowObject(ByVal ws As Worksheet, ByVal r As Long, ByVal lastCol As Long) As String
    Dim sb As String

    sb = "{"
    sb = sb & """rowNumber"":" & CStr(r) & ","
    sb = sb & KompletaceJsonPair("firstName", KompletaceCellString(ws.Cells(r, 1))) & ","
    sb = sb & KompletaceJsonPair("lastName", KompletaceCellString(ws.Cells(r, 2))) & ","
    sb = sb & KompletaceJsonPair("note", KompletaceCellString(ws.Cells(r, 3))) & ","
    sb = sb & KompletaceJsonPair("streetWithNumber", KompletaceCellString(ws.Cells(r, 4))) & ","
    sb = sb & KompletaceJsonPair("city", KompletaceCellString(ws.Cells(r, 5))) & ","
    sb = sb & KompletaceJsonPair("zipCode", KompletaceCellString(ws.Cells(r, 6))) & ","
    sb = sb & KompletaceJsonPair("phone", KompletaceCellString(ws.Cells(r, 7))) & ","
    sb = sb & KompletaceJsonPair("email", KompletaceCellString(ws.Cells(r, 8))) & ","
    sb = sb & KompletaceJsonPair("weight", KompletaceCellString(ws.Cells(r, 9))) & ","
    sb = sb & KompletaceJsonPair("codAmount", KompletaceCellString(ws.Cells(r, 10))) & ","
    sb = sb & KompletaceJsonPair("paymentMethod", KompletaceCellString(ws.Cells(r, 11))) & ","
    sb = sb & KompletaceJsonPair("orderNumber", KompletaceCellString(ws.Cells(r, 12))) & ","
    sb = sb & KompletaceJsonPair("shippingMethod", KompletaceCellString(ws.Cells(r, 13))) & ","
    sb = sb & KompletaceJsonPair("amount", KompletaceCellString(ws.Cells(r, 14))) & ","
    sb = sb & KompletaceJsonPair("quantity", KompletaceCellString(ws.Cells(r, 15))) & ","
    sb = sb & KompletaceJsonPair("paidStatus", KompletaceCellString(ws.Cells(r, 16))) & ","
    sb = sb & KompletaceJsonPair("expeditionNumber", KompletaceCellString(ws.Cells(r, 17))) & ","
    sb = sb & KompletaceJsonPair("expeditionOrderCode", KompletaceCellString(ws.Cells(r, 18))) & ","
    sb = sb & KompletaceJsonPair("packetaId", KompletaceCellString(ws.Cells(r, 19))) & ","
    sb = sb & KompletaceJsonPair("completionStatus", KompletaceCellString(ws.Cells(r, 20))) & ","
    sb = sb & KompletaceJsonPair("orderId", KompletaceCellString(ws.Cells(r, 21))) & ","
    sb = sb & KompletaceJsonPair("street", KompletaceCellString(ws.Cells(r, 22))) & ","
    sb = sb & KompletaceJsonPair("houseNumber", KompletaceCellString(ws.Cells(r, 23))) & ","
    sb = sb & KompletaceJsonPair("dpdFlag", KompletaceCellString(ws.Cells(r, 24))) & ","
    sb = sb & KompletaceJsonPair("packetaStatus", KompletaceCellString(ws.Cells(r, 25))) & ","
    sb = sb & KompletaceJsonPair("packetaShipmentId", KompletaceCellString(ws.Cells(r, 26))) & ","
    sb = sb & KompletaceJsonPair("orderDate", KompletaceCellString(ws.Cells(r, 27))) & ","
    sb = sb & KompletaceJsonPair("twistoPaid", KompletaceCellString(ws.Cells(r, 29))) & ","
    sb = sb & KompletaceJsonPair("dpdOrderAndPieces", KompletaceCellString(ws.Cells(r, 31))) & ","
    sb = sb & KompletaceJsonPair("canceledOrderBackup", KompletaceCellString(ws.Cells(r, 34))) & ","
    sb = sb & KompletaceJsonPair("labelPrinted", KompletaceCellString(ws.Cells(r, 38))) & ","
    sb = sb & """cells"":" & KompletaceBuildCellArray(ws, r, lastCol)
    sb = sb & "}"

    KompletaceBuildRowObject = sb
End Function

Private Function KompletaceBuildCellArray(ByVal ws As Worksheet, ByVal r As Long, ByVal lastCol As Long) As String
    Dim c As Long
    Dim sb As String

    sb = "["
    For c = 1 To lastCol
        If c > 1 Then sb = sb & ","
        sb = sb & KompletaceJsonString(KompletaceCellString(ws.Cells(r, c)))
    Next c
    sb = sb & "]"

    KompletaceBuildCellArray = sb
End Function

Private Function KompletacePostJson(ByVal url As String, ByVal token As String, ByVal payload As String) As String
    Dim http As Object
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")

    http.Open "POST", url, False
    http.setTimeouts 10000, 10000, 30000, 30000
    http.setRequestHeader "Content-Type", "application/json; charset=utf-8"
    If Len(token) > 0 Then http.setRequestHeader "X-Upload-Token", token
    http.send KompletaceUtf8Bytes(payload)

    If http.Status < 200 Or http.Status >= 300 Then
        Err.Raise vbObjectError + 203, , "Server vratil HTTP " & http.Status & ": " & http.responseText
    End If

    KompletacePostJson = http.responseText
End Function

Private Function KompletaceUtf8Bytes(ByVal text As String) As Variant
    Dim stream As Object
    Set stream = CreateObject("ADODB.Stream")

    stream.Type = 2
    stream.Charset = "utf-8"
    stream.Open
    stream.WriteText text
    stream.Position = 0
    stream.Type = 1
    KompletaceUtf8Bytes = stream.Read
    stream.Close
End Function

Private Function KompletaceJsonPair(ByVal key As String, ByVal value As String) As String
    KompletaceJsonPair = KompletaceJsonString(key) & ":" & KompletaceJsonString(value)
End Function

Private Function KompletaceJsonString(ByVal value As String) As String
    Dim i As Long
    Dim ch As String
    Dim code As Long
    Dim sb As String

    sb = """"
    For i = 1 To Len(value)
        ch = Mid$(value, i, 1)
        code = AscW(ch)

        Select Case ch
            Case """"
                sb = sb & "\"""
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
    sb = sb & """"

    KompletaceJsonString = sb
End Function

Private Function KompletaceCellString(ByVal cell As Range) As String
    If IsError(cell.Value) Then
        KompletaceCellString = ""
    ElseIf IsEmpty(cell.Value) Or IsNull(cell.Value) Then
        KompletaceCellString = ""
    Else
        KompletaceCellString = CStr(cell.Value)
    End If
End Function
