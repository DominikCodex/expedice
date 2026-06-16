Attribute VB_Name = "UploadRoztrideniZbozi"
Option Explicit

Private Const UPLOAD_URL As String = "https://expedice-production.up.railway.app/api/datasets/upload"
Private Const UPLOAD_TOKEN As String = ""
Private Const SHEET_NAME As String = "EXCEL"

Public Sub UploadRoztrideniAktualniTabulky()
    On Error GoTo ErrHandler

    Dim ws As Worksheet
    Set ws = ResolveUploadSheet()

    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, "B").End(xlUp).Row
    If lastRow < 2 Then
        MsgBox "Na listu nejsou zadne radky k uploadu.", vbExclamation
        Exit Sub
    End If

    Dim lastCol As Long
    lastCol = LastUsedColumn(ws)
    If lastCol < 13 Then lastCol = 13

    Dim payload As String
    payload = BuildUploadPayload(ws, lastRow, lastCol)

    Dim responseText As String
    responseText = PostJson(UPLOAD_URL, UPLOAD_TOKEN, payload)

    MsgBox "Upload hotovy." & vbCrLf & responseText, vbInformation
    Exit Sub

ErrHandler:
    MsgBox "Upload se nepodaril:" & vbCrLf & Err.Description, vbCritical
End Sub

Private Function ResolveUploadSheet() As Worksheet
    On Error Resume Next
    Set ResolveUploadSheet = ThisWorkbook.Worksheets(SHEET_NAME)
    On Error GoTo 0

    If ResolveUploadSheet Is Nothing Then
        Set ResolveUploadSheet = ActiveSheet
    End If
End Function

Private Function LastUsedColumn(ByVal ws As Worksheet) As Long
    Dim usedLast As Long
    Dim headerLast As Long

    headerLast = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column

    With ws.UsedRange
        usedLast = .Column + .Columns.Count - 1
    End With

    If usedLast > headerLast Then
        LastUsedColumn = usedLast
    Else
        LastUsedColumn = headerLast
    End If
End Function

Private Function BuildUploadPayload(ByVal ws As Worksheet, ByVal lastRow As Long, ByVal lastCol As Long) As String
    Dim sb As String
    Dim r As Long

    sb = "{"
    sb = sb & JsonPair("source", "excel-vba") & ","
    sb = sb & JsonPair("workbookName", ThisWorkbook.Name) & ","
    sb = sb & JsonPair("worksheetName", ws.Name) & ","
    sb = sb & JsonPair("datasetDate", Format$(Date, "yyyy-mm-dd")) & ","
    sb = sb & JsonPair("datasetTime", Format$(Now, "hh:nn:ss")) & ","
    sb = sb & JsonPair("uploadedAtLocal", Format$(Now, "yyyy-mm-dd\Thh:nn:ss")) & ","
    sb = sb & JsonPair("label", Format$(Now, "yyyy-mm-dd hh:nn:ss")) & ","
    sb = sb & """lastRow"":" & CStr(lastRow) & ","
    sb = sb & """lastCol"":" & CStr(lastCol) & ","
    sb = sb & """headers"":" & BuildHeaders(ws, lastCol) & ","
    sb = sb & """rows"":["

    For r = 2 To lastRow
        If Len(Trim$(CellString(ws.Cells(r, 2)))) > 0 Then
            If Right$(sb, 1) <> "[" Then sb = sb & ","
            sb = sb & BuildRowObject(ws, r, lastCol)
        End If
    Next r

    sb = sb & "]}"
    BuildUploadPayload = sb
End Function

Private Function BuildHeaders(ByVal ws As Worksheet, ByVal lastCol As Long) As String
    Dim c As Long
    Dim sb As String

    sb = "["
    For c = 1 To lastCol
        If c > 1 Then sb = sb & ","
        sb = sb & JsonString(CellString(ws.Cells(1, c)))
    Next c
    sb = sb & "]"

    BuildHeaders = sb
End Function

Private Function BuildRowObject(ByVal ws As Worksheet, ByVal r As Long, ByVal lastCol As Long) As String
    Dim sb As String

    sb = "{"
    sb = sb & """rowNumber"":" & CStr(r) & ","
    sb = sb & JsonPair("productCode", CellString(ws.Cells(r, 2))) & ","
    sb = sb & JsonPair("variantCode", CellString(ws.Cells(r, 3))) & ","
    sb = sb & JsonPair("variant", CellString(ws.Cells(r, 4))) & ","
    sb = sb & JsonPair("quantity", CellString(ws.Cells(r, 5))) & ","
    sb = sb & JsonPair("orderNumber", CellString(ws.Cells(r, 6))) & ","
    sb = sb & JsonPair("weight", CellString(ws.Cells(r, 7))) & ","
    sb = sb & JsonPair("sequence", CellString(ws.Cells(r, 8))) & ","
    sb = sb & JsonPair("info", CellString(ws.Cells(r, 10))) & ","
    sb = sb & JsonPair("initialQuantity", CellString(ws.Cells(r, 11))) & ","
    sb = sb & JsonPair("paircode", CellString(ws.Cells(r, 12))) & ","
    sb = sb & JsonPair("history", CellString(ws.Cells(r, 13))) & ","
    sb = sb & """cells"":" & BuildCellArray(ws, r, lastCol)
    sb = sb & "}"

    BuildRowObject = sb
End Function

Private Function BuildCellArray(ByVal ws As Worksheet, ByVal r As Long, ByVal lastCol As Long) As String
    Dim c As Long
    Dim sb As String

    sb = "["
    For c = 1 To lastCol
        If c > 1 Then sb = sb & ","
        sb = sb & JsonString(CellString(ws.Cells(r, c)))
    Next c
    sb = sb & "]"

    BuildCellArray = sb
End Function

Private Function PostJson(ByVal url As String, ByVal token As String, ByVal payload As String) As String
    If InStr(1, url, "YOUR-RAILWAY-APP", vbTextCompare) > 0 Then
        Err.Raise vbObjectError + 101, , "Nejdriv nastav UPLOAD_URL na Railway endpoint."
    End If

    Dim http As Object
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")

    http.Open "POST", url, False
    http.setTimeouts 10000, 10000, 30000, 30000
    http.setRequestHeader "Content-Type", "application/json; charset=utf-8"
    If Len(token) > 0 Then http.setRequestHeader "X-Upload-Token", token
    http.send Utf8Bytes(payload)

    If http.Status < 200 Or http.Status >= 300 Then
        Err.Raise vbObjectError + 103, , "Server vratil HTTP " & http.Status & ": " & http.responseText
    End If

    PostJson = http.responseText
End Function

Private Function Utf8Bytes(ByVal text As String) As Variant
    Dim stream As Object
    Set stream = CreateObject("ADODB.Stream")

    stream.Type = 2
    stream.Charset = "utf-8"
    stream.Open
    stream.WriteText text
    stream.Position = 0
    stream.Type = 1
    Utf8Bytes = stream.Read
    stream.Close
End Function

Private Function JsonPair(ByVal key As String, ByVal value As String) As String
    JsonPair = JsonString(key) & ":" & JsonString(value)
End Function

Private Function JsonString(ByVal value As String) As String
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

    JsonString = sb
End Function

Private Function CellString(ByVal cell As Range) As String
    If IsError(cell.Value) Then
        CellString = ""
    ElseIf IsEmpty(cell.Value) Or IsNull(cell.Value) Then
        CellString = ""
    Else
        CellString = CStr(cell.Value)
    End If
End Function
