Private Const WHPRINT_BASE_URL As String = "https://expedice-production.up.railway.app"
Private Const WHPRINT_MAX_PAYLOAD_BYTES As Long = 10485760
Private whPrintPdfPaths(0 To 2) As String

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
    WhPrintRun False
End Sub

Public Sub VyskladneniPdfATisk()
    ' Compatibility with existing buttons: download only, no preview or printing.
    VyskladneniPdfVygenerovat
End Sub

Public Sub VyskladneniPdfVygenerovat()
    WhPrintRun True
End Sub

Public Sub VyskladneniTiskBeznePoradi()
    WhPrintSavedPdf 0
End Sub

Public Sub VyskladneniTiskPrioritniZasilky()
    WhPrintSavedPdf 1
End Sub

Public Sub VyskladneniTiskPrioritniKusy()
    WhPrintSavedPdf 2
End Sub

Private Sub WhPrintRun(ByVal generatePdf As Boolean)
    On Error GoTo Failed
    Static running As Boolean
    If running Then Exit Sub
    running = True
    Dim pdfFolder As String, index As Long
    If generatePdf Then
        ' Never reuse a previous batch after a failed or partial generation.
        For index = 0 To 2
            whPrintPdfPaths(index) = ""
        Next index
        pdfFolder = WhPrintPdfFolder(ThisWorkbook.Path)
    End If
    Dim ws As Worksheet
    Set ws = WhPrintWarehouseSheet(ThisWorkbook)
    Dim lastRow As Long, r As Long, payload As String, rows As String, helperSheets As String
    lastRow = ws.Cells(ws.Rows.Count, "B").End(xlUp).Row
    If lastRow < 2 Then Err.Raise vbObjectError + 801, , "Na listu " & ws.Name & " nejsou data vyskladneni."

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
    If Len(payload) > WHPRINT_MAX_PAYLOAD_BYTES Then Err.Raise vbObjectError + 811, , "Tiskova data vcetne pomocnych listu presahuji limit 10 MB. Nic nebylo odeslano."

    Dim files As Object, printPath As String, missing As Long
    Set files = CreateObject("Scripting.FileSystemObject")
    If generatePdf Then
        If Not files.FolderExists(pdfFolder) Then files.CreateFolder pdfFolder
        Dim modes As Variant, folders As Variant, saved As Long, notice As String, batchFile As String
        modes = Array("normal", "first", "split")
        folders = Array("Bezne-poradi", "Prioritni-zasilky-prvni", "Prioritni-kusy-zvlast")
        batchFile = "Vyskladneni-" & Format$(Now, "yyyymmdd-hhnnss") & "-" & files.GetBaseName(files.GetTempName)
        For index = 0 To 2
            Application.StatusBar = "Vytvarim PDF " & (index + 1) & "/3: " & folders(index)
            notice = notice & vbCrLf & WhPrintPdfVariant(payload, pdfFolder, CStr(folders(index)), CStr(modes(index)), _
                batchFile & "-" & CStr(folders(index)) & ".pdf", saved, whPrintPdfPaths(index))
        Next index
        MsgBox "Ulozeno " & saved & "/3 PDF. Tisk nebyl spusten." & vbCrLf & notice & vbCrLf & _
            "Pro tisk spust makro pozadovane varianty sestavy.", IIf(saved = 3, vbInformation, vbExclamation)
    Else
        Application.StatusBar = "Nahravam vyskladneni k tisku..."
        printPath = WhPrintDownload(payload, files.BuildPath(files.GetSpecialFolder(2), "ExpediceVyskladneni"), _
            files.GetBaseName(files.GetTempName) & ".html", "", missing)
        WhPrintOpenBrowser printPath
    End If
    Application.StatusBar = False
    running = False
    Exit Sub
Failed:
    Application.StatusBar = False
    running = False
    MsgBox "Vyskladneni k tisku se nepodarilo:" & vbCrLf & Err.Description, vbExclamation
End Sub

Private Function WhPrintPdfVariant(ByVal payload As String, ByVal root As String, ByVal folder As String, _
    ByVal mode As String, ByVal filename As String, ByRef saved As Long, ByRef generatedPath As String) As String
    On Error GoTo Failed
    Dim path As String, missing As Long, note As String
    path = WhPrintDownload(payload, CreateObject("Scripting.FileSystemObject").BuildPath(root, folder), filename, mode, missing)
    generatedPath = path
    saved = saved + 1
    note = folder & ": " & path
    If missing > 0 Then note = note & vbCrLf & "Bez fotografie: " & missing & " radku."
    WhPrintPdfVariant = note
    Exit Function
Failed:
    WhPrintPdfVariant = folder & ": NEPODARILO SE - " & Err.Description
End Function

Private Sub WhPrintSavedPdf(ByVal variantIndex As Long)
    On Error GoTo Failed
    Static running As Boolean
    If running Then Exit Sub
    running = True
    Dim pdfPath As String, adobe As String, printer As Variant, arguments As String
    pdfPath = whPrintPdfPaths(variantIndex)
    If Len(pdfPath) = 0 Then Err.Raise vbObjectError + 823, , _
        "Tato varianta PDF z posledniho generovani neni k dispozici. Nejprve spust VyskladneniPdfVygenerovat. Po restartu Excelu je potreba PDF znovu vygenerovat nebo vybrat pres VyskladneniPdfVytisknoutAdobe."
    pdfPath = WhPrintValidatedPdf(pdfPath)
    adobe = WhPrintAdobePath()
    If Len(adobe) = 0 Then Err.Raise vbObjectError + 818, , "Adobe Acrobat nebo Reader nebyl nalezen. PDF zustava ulozene."
    printer = WhPrintDefaultPrinter()
    arguments = WhPrintAdobeArguments(pdfPath, CStr(printer(0)), CStr(printer(1)), CStr(printer(2)))
    WhPrintLaunchApplication adobe, arguments
    MsgBox "Pozadavek byl predan Adobe na tiskarnu " & CStr(printer(0)) & "." & vbCrLf & _
        "PDF: " & pdfPath & vbCrLf & "Pred opakovanim zkontroluj tiskovou frontu. Predani nepotvrzuje fyzicke vytisteni.", vbInformation
    running = False
    Exit Sub
Failed:
    running = False
    MsgBox "Tisk pres Adobe se nepodarilo spustit:" & vbCrLf & Err.Description, vbExclamation
End Sub

Private Function WhPrintDownload(ByVal payload As String, ByVal outputFolder As String, ByVal filename As String, _
    ByVal mode As String, ByRef missing As Long) As String
    Dim generatePdf As Boolean
    generatePdf = (Len(mode) > 0)
    Dim http As Object
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    Dim endpoint As String
    endpoint = "/api/warehouse/render-print"
    If generatePdf Then endpoint = "/api/warehouse/render-pdf?priority=" & mode
    http.setTimeouts 10000, 10000, 30000, IIf(generatePdf, 180000, 60000)
    http.Open "POST", WHPRINT_BASE_URL & endpoint, False
    http.setRequestHeader "Content-Type", "application/json; charset=utf-8"
    http.send payload
    If http.Status < 200 Or http.Status >= 300 Then
        Err.Raise vbObjectError + 805, , "HTTP " & http.Status & ": " & http.responseText
    End If

    Dim expectedType As String
    expectedType = IIf(generatePdf, "application/pdf", "text/html")
    If InStr(1, http.getResponseHeader("Content-Type"), expectedType, vbTextCompare) = 0 Then
        Err.Raise vbObjectError + 806, , "Server nevratil tiskovou sestavu."
    End If
    If generatePdf Then
        If http.getResponseHeader("X-Warehouse-Priority") <> mode Then Err.Raise vbObjectError + 822, , "Server nepotvrdil zvoleny rezim PDF. Je potreba aktualni verze serveru."
        If Not WhPrintIsPdf(http.responseBody) Then Err.Raise vbObjectError + 816, , "Server nevratil platny PDF soubor. Nic nebylo vytisteno."
    End If
    Dim files As Object, printPath As String, stream As Object
    Set files = CreateObject("Scripting.FileSystemObject")
    If Not files.FolderExists(outputFolder) Then files.CreateFolder outputFolder
    printPath = files.BuildPath(outputFolder, filename)
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 1
    stream.Open
    stream.Write http.responseBody
    stream.SaveToFile printPath, 1
    stream.Close
    missing = Val(http.getResponseHeader("X-Warehouse-Missing-Images"))
    WhPrintDownload = printPath
End Function

Public Sub VyskladneniPdfVytisknoutAdobe()
    On Error GoTo Failed
    Static running As Boolean
    If running Then Exit Sub
    running = True
    Dim pdfPath As String, adobe As String, printer As Variant, arguments As String
    pdfPath = WhPrintChoosePdf()
    If Len(pdfPath) = 0 Then GoTo Finished
    pdfPath = WhPrintValidatedPdf(pdfPath)
    adobe = WhPrintAdobePath()
    If Len(adobe) = 0 Then Err.Raise vbObjectError + 818, , "Adobe Acrobat nebo Reader nebyl nalezen. PDF zustava ulozene; muzes je vytisknout rucne z nahledu."
    printer = WhPrintDefaultPrinter()
    arguments = WhPrintAdobeArguments(pdfPath, CStr(printer(0)), CStr(printer(1)), CStr(printer(2)))
    If MsgBox("Odeslat PDF k tisku pres Adobe?" & vbCrLf & vbCrLf & pdfPath & vbCrLf & vbCrLf & _
        "Vychozi tiskarna: " & CStr(printer(0)) & vbCrLf & "Pred opakovanym tiskem zkontroluj tiskovou frontu.", _
        vbQuestion + vbYesNo + vbDefaultButton2, "Tisk vyskladneni") <> vbYes Then GoTo Finished
    WhPrintLaunchApplication adobe, arguments
    MsgBox "Pozadavek byl predan Adobe. To nepotvrzuje fyzicke vytisteni; zkontroluj tiskovou frontu." & vbCrLf & _
        "PDF zustava ulozene: " & pdfPath, vbInformation
Finished:
    running = False
    Exit Sub
Failed:
    running = False
    MsgBox "Tisk pres Adobe se nepodarilo spustit:" & vbCrLf & Err.Description, vbExclamation
End Sub

Private Function WhPrintChoosePdf() As String
    Dim picker As Object
    Set picker = Application.FileDialog(3)
    picker.Title = "Vyber variantu PDF vyskladneni k tisku pres Adobe"
    picker.AllowMultiSelect = False
    picker.Filters.Clear
    picker.Filters.Add "PDF", "*.pdf"
    If Len(ThisWorkbook.Path) > 0 And InStr(ThisWorkbook.Path, "://") = 0 Then
        picker.InitialFileName = WhPrintPdfFolder(ThisWorkbook.Path) & "\"
    End If
    If picker.Show = -1 Then WhPrintChoosePdf = picker.SelectedItems(1)
End Function

Private Function WhPrintValidatedPdf(ByVal path As String) As String
    Dim files As Object, stream As Object, content As Variant
    Set files = CreateObject("Scripting.FileSystemObject")
    If Not files.FileExists(path) Then Err.Raise vbObjectError + 819, , "PDF soubor nebyl nalezen."
    If LCase$(files.GetExtensionName(path)) <> "pdf" Then Err.Raise vbObjectError + 819, , "Vyber soubor PDF."
    If files.GetFile(path).Size < 5 Or files.GetFile(path).Size > 33554432 Then Err.Raise vbObjectError + 819, , "Neplatna velikost PDF (maximum 32 MB)."
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 1
    stream.Open
    stream.LoadFromFile path
    content = stream.Read(5)
    stream.Close
    If Not WhPrintIsPdf(content) Then Err.Raise vbObjectError + 819, , "Soubor nema PDF signaturu. Nic nebylo vytisteno."
    WhPrintValidatedPdf = files.GetAbsolutePathName(path)
End Function

Private Function WhPrintAdobePath() As String
    Dim shell As Object, files As Object, hive As Variant, exe As Variant, key As String, candidate As String
    Set shell = CreateObject("WScript.Shell")
    Set files = CreateObject("Scripting.FileSystemObject")
    For Each hive In Array("HKCU\SOFTWARE\", "HKLM\SOFTWARE\", "HKLM\SOFTWARE\WOW6432Node\")
        For Each exe In Array("Acrobat.exe", "AcroRd32.exe")
            key = CStr(hive) & "Microsoft\Windows\CurrentVersion\App Paths\" & CStr(exe) & "\"
            candidate = Trim$(shell.ExpandEnvironmentStrings(WhPrintRegRead(shell, key)))
            If Left$(candidate, 1) = Chr$(34) And Right$(candidate, 1) = Chr$(34) Then candidate = Mid$(candidate, 2, Len(candidate) - 2)
            If files.FileExists(candidate) Then
                WhPrintAdobePath = candidate
                Exit Function
            End If
        Next exe
    Next hive
    Dim base As Variant, relative As Variant
    For Each base In Array(Environ$("ProgramW6432"), Environ$("ProgramFiles"), Environ$("ProgramFiles(x86)"))
        If Len(CStr(base)) > 0 Then
            For Each relative In Array("Adobe\Acrobat DC\Acrobat\Acrobat.exe", "Adobe\Acrobat Reader DC\Reader\AcroRd32.exe", "Adobe\Reader 11.0\Reader\AcroRd32.exe")
                candidate = files.BuildPath(CStr(base), CStr(relative))
                If files.FileExists(candidate) Then
                    WhPrintAdobePath = candidate
                    Exit Function
                End If
            Next relative
        End If
    Next base
End Function

Private Function WhPrintDefaultPrinter() As Variant
    Dim printers As Object, printer As Object
    Set printers = GetObject("winmgmts:\\.\root\cimv2").ExecQuery("SELECT Name, DriverName, PortName FROM Win32_Printer WHERE Default = TRUE")
    For Each printer In printers
        WhPrintDefaultPrinter = Array(CStr(printer.Name), CStr(printer.DriverName), CStr(printer.PortName))
        Exit Function
    Next printer
    Err.Raise vbObjectError + 820, , "Ve Windows neni nastavena vychozi tiskarna."
End Function

Private Function WhPrintAdobeArguments(ByVal pdf As String, ByVal printer As String, ByVal driver As String, ByVal port As String) As String
    WhPrintAdobeArguments = "/t " & WhPrintQuoteArgument(pdf) & " " & WhPrintQuoteArgument(printer) & " " & _
        WhPrintQuoteArgument(driver) & " " & WhPrintQuoteArgument(port)
End Function

Private Function WhPrintQuoteArgument(ByVal value As String) As String
    If Len(value) = 0 Or InStr(value, Chr$(34)) > 0 Or InStr(value, vbCr) > 0 Or InStr(value, vbLf) > 0 Or InStr(value, Chr$(0)) > 0 Then
        Err.Raise vbObjectError + 821, , "Neplatna cesta nebo udaje tiskarny."
    End If
    WhPrintQuoteArgument = Chr$(34) & value & Chr$(34)
End Function

Private Function WhPrintIsPdf(ByVal content As Variant) As Boolean
    On Error GoTo Invalid
    Dim first As Long, size As Long
    first = LBound(content)
    size = UBound(content) - first + 1
    If size < 5 Or size > 33554432 Then Exit Function
    WhPrintIsPdf = (content(first) = 37 And content(first + 1) = 80 And content(first + 2) = 68 And content(first + 3) = 70 And content(first + 4) = 45)
Invalid:
End Function

Private Function WhPrintPdfFolder(ByVal workbookFolder As String) As String
    Dim files As Object
    Set files = CreateObject("Scripting.FileSystemObject")
    If Len(workbookFolder) = 0 Or InStr(1, workbookFolder, "://", vbTextCompare) > 0 Then
        Err.Raise vbObjectError + 817, , "Nejprve uloz sesit do mistni nebo sdilene slozky. PDF se uklada do podslozky VyskladneniPDF vedle sesitu."
    End If
    WhPrintPdfFolder = files.BuildPath(workbookFolder, "VyskladneniPDF")
End Function

Private Function WhPrintWarehouseSheet(ByVal book As Workbook) As Worksheet
    Dim ws As Worksheet, found As Worksheet, names As String, matches As Long
    For Each ws In book.Worksheets
        If UCase$(ws.Name) <> "EXCEL" And UCase$(ws.Name) <> "KOMPLETACE" Then
            If WhPrintHasWarehouseHeaders(ws) Then
                matches = matches + 1
                Set found = ws
                If Len(names) > 0 Then names = names & ", "
                names = names & ws.Name
            End If
        End If
    Next ws
    If matches = 0 Then Err.Raise vbObjectError + 802, , "V sesitu " & book.Name & " chybi list vyskladneni s hlavickou B = kod varianty, D = kolik a kam, E = celkem. Nic nebylo odeslano."
    If matches > 1 Then Err.Raise vbObjectError + 815, , "V sesitu je vice tabulek vyskladneni: " & names & ". Ponech pouze jednu tiskovou tabulku s touto hlavickou. Nic nebylo odeslano."
    Set WhPrintWarehouseSheet = found
End Function

Private Function WhPrintHasWarehouseHeaders(ByVal ws As Worksheet) As Boolean
    ' Unrelated sheets may contain formula errors in their first row.
    If IsError(ws.Cells(1, 2).Value) Or IsError(ws.Cells(1, 4).Value) Or IsError(ws.Cells(1, 5).Value) Then Exit Function
    WhPrintHasWarehouseHeaders = _
        InStr(1, WhPrintCell(ws.Cells(1, 2)), "variant", vbTextCompare) > 0 And _
        InStr(1, WhPrintCell(ws.Cells(1, 4)), "kam", vbTextCompare) > 0 And _
        InStr(1, WhPrintCell(ws.Cells(1, 5)), "Celk", vbTextCompare) > 0
End Function

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
    Dim files As Object, browser As String
    Set files = CreateObject("Scripting.FileSystemObject")
    If Not files.FileExists(printPath) Then Err.Raise vbObjectError + 808, , "Tiskovy soubor nebyl ulozen."
    browser = WhPrintBrowserPath()
    If Len(browser) = 0 Then Err.Raise vbObjectError + 809, , "Webovy prohlizec nebyl nalezen. Otevri soubor sestavy rucne v prohlizeci."
    WhPrintLaunchApplication browser, WhPrintQuoteArgument(printPath)
End Sub

Private Sub WhPrintLaunchApplication(ByVal executable As String, ByVal arguments As String)
    Dim operation As String
    operation = "open"
#If VBA7 Then
    Dim result As LongPtr
#Else
    Dim result As Long
#End If
    result = WhPrintShellExecute(0, StrPtr(operation), StrPtr(executable), StrPtr(arguments), 0, 1)
    If result <= 32 Then Err.Raise vbObjectError + 810, , "Aplikaci se nepodarilo spustit (kod Windows " & CStr(result) & ")."
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
