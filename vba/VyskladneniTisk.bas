Private Const WHPRINT_BASE_URL As String = "https://expedice-production.up.railway.app"
Private Const WHPRINT_MAX_PAYLOAD_BYTES As Long = 10485760
Private whPrintPdfPaths(0 To 2) As String
Private whPrintPdfRoot As String
Private whPrintPdfSelectionKnown As Boolean
Private Const WHPRINT_PDF_INDEX As String = "posledni-sestava.xml"
Private whPrintAdobePid As Long
Private whPrintAdobeCreated As String
Private whPrintAdobePrinter As String
Private whPrintAdobeDocument As String
Private whPrintAdobeBaseline As Object
Private whPrintAdobeSeen As Object
Private whPrintAdobeDeadline As Date
Private whPrintAdobeClosing As Boolean
Private whPrintAdobeClosePosted As Boolean

#If VBA7 Then
Private Declare PtrSafe Function WhPrintEnumWindows Lib "user32" Alias "EnumWindows" (ByVal callback As LongPtr, ByVal parameter As LongPtr) As Long
Private Declare PtrSafe Function WhPrintWindowPid Lib "user32" Alias "GetWindowThreadProcessId" (ByVal hwnd As LongPtr, ByRef pid As Long) As Long
Private Declare PtrSafe Function WhPrintGetWindow Lib "user32" Alias "GetWindow" (ByVal hwnd As LongPtr, ByVal command As Long) As LongPtr
Private Declare PtrSafe Function WhPrintWindowTitleLength Lib "user32" Alias "GetWindowTextLengthW" (ByVal hwnd As LongPtr) As Long
Private Declare PtrSafe Function WhPrintPostMessage Lib "user32" Alias "PostMessageW" (ByVal hwnd As LongPtr, ByVal message As Long, ByVal wParam As LongPtr, ByVal lParam As LongPtr) As Long
Private Declare PtrSafe Function WhPrintShellExecute Lib "shell32.dll" Alias "ShellExecuteW" ( _
    ByVal hwnd As LongPtr, ByVal operation As LongPtr, ByVal file As LongPtr, _
    ByVal parameters As LongPtr, ByVal directory As LongPtr, ByVal show As Long) As LongPtr
#Else
Private Declare Function WhPrintEnumWindows Lib "user32" Alias "EnumWindows" (ByVal callback As Long, ByVal parameter As Long) As Long
Private Declare Function WhPrintWindowPid Lib "user32" Alias "GetWindowThreadProcessId" (ByVal hwnd As Long, ByRef pid As Long) As Long
Private Declare Function WhPrintGetWindow Lib "user32" Alias "GetWindow" (ByVal hwnd As Long, ByVal command As Long) As Long
Private Declare Function WhPrintWindowTitleLength Lib "user32" Alias "GetWindowTextLengthW" (ByVal hwnd As Long) As Long
Private Declare Function WhPrintPostMessage Lib "user32" Alias "PostMessageW" (ByVal hwnd As Long, ByVal message As Long, ByVal wParam As Long, ByVal lParam As Long) As Long
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

Public Sub VyskladneniPdfDoSlozky(ByVal cilovaSlozka As String, ByVal expedicniDen As Date)
    WhPrintRun True, cilovaSlozka, expedicniDen
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

Private Sub WhPrintRun(ByVal generatePdf As Boolean, Optional ByVal destination As Variant, Optional ByVal expeditionDay As Date = 0)
    On Error GoTo Failed
    Static running As Boolean
    If running Then Exit Sub
    running = True
    Dim pdfFolder As String, index As Long, outputRoot As String
    If generatePdf Then
        ' Never reuse a previous batch after a failed or partial generation.
        whPrintPdfSelectionKnown = True
        whPrintPdfRoot = ""
        For index = 0 To 2
            whPrintPdfPaths(index) = ""
        Next index
        outputRoot = ThisWorkbook.Path
        If Not IsMissing(destination) Then
            outputRoot = CStr(destination)
            If Len(outputRoot) = 0 Then Err.Raise vbObjectError + 824, , "Chybi cilova slozka expedicniho dne."
            If Not CreateObject("Scripting.FileSystemObject").FolderExists(outputRoot) Then _
                Err.Raise vbObjectError + 824, , "Cilova slozka expedicniho dne neexistuje. Nejprve uloz kopii sesitu."
        End If
        pdfFolder = WhPrintPdfFolder(outputRoot)
        Dim indexFiles As Object
        Set indexFiles = CreateObject("Scripting.FileSystemObject")
        If Not indexFiles.FolderExists(pdfFolder) Then indexFiles.CreateFolder pdfFolder
        ' Invalidate old entries before uploading, including across Excel sessions.
        WhPrintWritePdfIndex pdfFolder
        whPrintPdfRoot = pdfFolder
    End If
    If expeditionDay = 0 Then expeditionDay = WhPrintExpeditionDay(ThisWorkbook.Path)
    If Year(expeditionDay) < 1900 Or Year(expeditionDay) > 9999 Then _
        Err.Raise vbObjectError + 825, , "Neplatne datum expedicniho dne."
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
        """workbookFolderName"":" & WhPrintJson(Format$(expeditionDay, "dd.mm.yyyy")) & "," & _
        """worksheetName"":" & WhPrintJson(ws.Name) & "," & _
        """datasetDate"":" & WhPrintJson(Format$(expeditionDay, "yyyy-mm-dd")) & "," & _
        """datasetTime"":" & WhPrintJson(Format$(Now, "hh:nn:ss")) & "," & _
        """rows"": [" & rows & "],""helperSheets"":" & helperSheets & "}"
    ' WhPrintJson emits ASCII, so character count equals the UTF-8 byte count.
    If Len(payload) > WHPRINT_MAX_PAYLOAD_BYTES Then Err.Raise vbObjectError + 811, , "Tiskova data vcetne pomocnych listu presahuji limit 10 MB. Nic nebylo odeslano."

    Dim files As Object, printPath As String, missing As Long
    Set files = CreateObject("Scripting.FileSystemObject")
    If generatePdf Then
        If Not files.FolderExists(pdfFolder) Then files.CreateFolder pdfFolder
        Dim modes As Variant, folders As Variant, saved As Long, notice As String, batchFile As String, variantNotice As String
        modes = Array("normal", "first", "split")
        folders = Array("Bezne-poradi", "Prioritni-zasilky-prvni", "Prioritni-kusy-zvlast")
        batchFile = "Vyskladneni-" & Format$(Now, "yyyymmdd-hhnnss") & "-" & files.GetBaseName(files.GetTempName)
        For index = 0 To 2
            Application.StatusBar = "Vytvarim PDF " & (index + 1) & "/3: " & folders(index)
            variantNotice = WhPrintPdfVariant(payload, pdfFolder, CStr(folders(index)), CStr(modes(index)), _
                batchFile & "-" & CStr(folders(index)) & ".pdf", saved, whPrintPdfPaths(index))
            If Len(variantNotice) > 0 Then notice = notice & vbCrLf & variantNotice
        Next index
        WhPrintWritePdfIndex pdfFolder
        If Len(notice) > 0 Then MsgBox "Ulozeno " & saved & "/3 PDF. Pri generovani nastaly problemy:" & vbCrLf & notice, vbExclamation
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
    Dim path As String, missing As Long, imageRows As Long
    path = WhPrintDownload(payload, CreateObject("Scripting.FileSystemObject").BuildPath(root, folder), filename, mode, missing, imageRows)
    generatedPath = path
    saved = saved + 1
    ' Isolated unmatched products are normal. Warn only about a confirmed majority.
    If imageRows > 0 And missing > imageRows / 2 Then _
        WhPrintPdfVariant = folder & ": Chybi vetsina fotografii: " & missing & " z " & imageRows & " radku." & vbCrLf & path
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
    pdfPath = WhPrintResolveSavedPdf(variantIndex, ThisWorkbook.Path)
    If Len(pdfPath) = 0 Then Err.Raise vbObjectError + 823, , _
        "Tato varianta PDF z posledniho generovani neni k dispozici. Overte dokonceni generovani a synchronizaci slozky VyskladneniPDF pro tento expedicni den."
    pdfPath = WhPrintValidatedPdf(pdfPath)
    adobe = WhPrintAdobePath()
    If Len(adobe) = 0 Then Err.Raise vbObjectError + 818, , "Adobe Acrobat nebo Reader nebyl nalezen. PDF zustava ulozene."
    printer = WhPrintDefaultPrinter()
    arguments = WhPrintAdobeArguments(pdfPath, CStr(printer(0)), CStr(printer(1)), CStr(printer(2)))
    WhPrintStartAdobe adobe, arguments, pdfPath, CStr(printer(0))
    running = False
    Exit Sub
Failed:
    running = False
    MsgBox "Tisk pres Adobe se nepodarilo spustit:" & vbCrLf & Err.Description, vbExclamation
End Sub

Private Sub WhPrintWritePdfIndex(ByVal root As String)
    Dim document As Object, entry As Object, files As Object, folders As Variant, modes As Variant, index As Long
    Set files = CreateObject("Scripting.FileSystemObject")
    Set document = CreateObject("MSXML2.DOMDocument.6.0")
    document.LoadXML "<warehousePrint version=""1""/>"
    folders = Array("Bezne-poradi", "Prioritni-zasilky-prvni", "Prioritni-kusy-zvlast")
    modes = Array("normal", "first", "split")
    For index = 0 To 2
        Set entry = document.createElement("pdf")
        entry.setAttribute "mode", modes(index)
        entry.setAttribute "path", ""
        If Len(whPrintPdfPaths(index)) > 0 Then _
            entry.setAttribute "path", CStr(folders(index)) & "\" & files.GetFileName(whPrintPdfPaths(index))
        document.documentElement.appendChild entry
    Next index
    document.Save files.BuildPath(root, WHPRINT_PDF_INDEX)
End Sub

Private Function WhPrintResolveSavedPdf(ByVal variantIndex As Long, ByVal workbookFolder As String) As String
    Dim root As String, files As Object, document As Object, entries As Object, relative As String
    Dim folders As Variant, modes As Variant, indexPath As String, parts As Variant
    Set files = CreateObject("Scripting.FileSystemObject")
    folders = Array("Bezne-poradi", "Prioritni-zasilky-prvni", "Prioritni-kusy-zvlast")
    modes = Array("normal", "first", "split")
    If whPrintPdfSelectionKnown Then
        root = whPrintPdfRoot
        If Len(root) = 0 Then Exit Function
    Else
        root = WhPrintPdfFolder(workbookFolder)
        If Not files.FolderExists(root) Then
            If StrComp(files.GetFileName(workbookFolder), "Samostatn" & ChrW(233) & " skladovky", vbTextCompare) = 0 Then _
                root = WhPrintPdfFolder(files.GetParentFolderName(workbookFolder))
        End If
    End If
    If Not files.FolderExists(root) Then Exit Function
    indexPath = files.BuildPath(root, WHPRINT_PDF_INDEX)
    If Not files.FileExists(indexPath) Then
        ' Older generated sets have no index: select one whole batch, never one latest file per mode.
        WhPrintResolveSavedPdf = WhPrintLegacyPdf(root, variantIndex)
        Exit Function
    End If
    If files.GetFile(indexPath).Size > 32768 Then Err.Raise vbObjectError + 826, , "Neplatny seznam PDF sestav."
    Set document = CreateObject("MSXML2.DOMDocument.6.0")
    document.async = False
    document.resolveExternals = False
    document.setProperty "ProhibitDTD", True
    If Not document.Load(indexPath) Then Err.Raise vbObjectError + 826, , "Seznam PDF nelze nacist. Pockejte na dokonceni synchronizace."
    If document.selectNodes("/warehousePrint[@version='1']").Length <> 1 Then _
        Err.Raise vbObjectError + 826, , "Neznama verze seznamu PDF."
    Set entries = document.selectNodes("/warehousePrint/pdf[@mode='" & modes(variantIndex) & "']")
    If entries.Length <> 1 Then Err.Raise vbObjectError + 826, , "Neplatny seznam variant PDF."
    relative = CStr(entries(0).getAttribute("path"))
    If Len(relative) = 0 Then Exit Function
    parts = Split(relative, "\")
    If UBound(parts) <> 1 Then Err.Raise vbObjectError + 826, , "Neplatna relativni cesta PDF."
    If parts(0) <> folders(variantIndex) Or InStr(parts(1), ":") > 0 Or InStr(parts(1), "/") > 0 Or _
        files.GetFileName(parts(1)) <> parts(1) Or LCase$(files.GetExtensionName(parts(1))) <> "pdf" Then _
        Err.Raise vbObjectError + 826, , "Neplatna relativni cesta PDF."
    WhPrintResolveSavedPdf = files.BuildPath(root, relative)
End Function

Private Function WhPrintLegacyPdf(ByVal root As String, ByVal variantIndex As Long) As String
    Dim files As Object, folders As Variant, index As Long, folder As String, file As Object
    Dim suffix As String, candidate As String, newest As String, pattern As Object
    Dim ambiguous As Boolean, timeOrder As Long
    Set files = CreateObject("Scripting.FileSystemObject")
    Set pattern = CreateObject("VBScript.RegExp")
    pattern.Pattern = "^Vyskladneni-[0-9]{8}-[0-9]{6}-[A-Za-z0-9]+$"
    folders = Array("Bezne-poradi", "Prioritni-zasilky-prvni", "Prioritni-kusy-zvlast")
    For index = 0 To 2
        folder = files.BuildPath(root, folders(index))
        suffix = "-" & folders(index) & ".pdf"
        If files.FolderExists(folder) Then
            For Each file In files.GetFolder(folder).Files
                If Right$(file.Name, Len(suffix)) = suffix Then
                    candidate = Left$(file.Name, Len(file.Name) - Len(suffix))
                    If pattern.Test(candidate) Then
                        timeOrder = StrComp(Left$(candidate, 27), Left$(newest, 27), vbBinaryCompare)
                        If timeOrder > 0 Then
                            newest = candidate
                            ambiguous = False
                        ElseIf timeOrder = 0 And candidate <> newest Then
                            ambiguous = True
                        End If
                    End If
                End If
            Next file
        End If
    Next index
    If Len(newest) = 0 Then Exit Function
    If ambiguous Then Err.Raise vbObjectError + 826, , "Vice starsich PDF sad ma stejny cas. Vyberte PDF rucne pres VyskladneniPdfVytisknoutAdobe."
    candidate = files.BuildPath(files.BuildPath(root, folders(variantIndex)), newest & "-" & folders(variantIndex) & ".pdf")
    If files.FileExists(candidate) Then WhPrintLegacyPdf = candidate
End Function

Private Function WhPrintDownload(ByVal payload As String, ByVal outputFolder As String, ByVal filename As String, _
    ByVal mode As String, ByRef missing As Long, Optional ByRef imageRows As Long = 0) As String
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
    imageRows = Val(http.getResponseHeader("X-Warehouse-Image-Rows"))
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
    WhPrintStartAdobe adobe, arguments, pdfPath, CStr(printer(0))
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

Private Sub WhPrintStartAdobe(ByVal executable As String, ByVal arguments As String, ByVal pdf As String, ByVal printer As String)
    If whPrintAdobePid <> 0 Then Err.Raise vbObjectError + 830, , _
        "Predchozi tisk pres Adobe jeste neni dokonceny. Pockejte na dokonceni tiskove ulohy."
    On Error GoTo Failed
    whPrintAdobePrinter = printer
    whPrintAdobeDocument = CreateObject("Scripting.FileSystemObject").GetFileName(pdf)
    Set whPrintAdobeBaseline = WhPrintQueueSnapshot(printer)
    Set whPrintAdobeSeen = CreateObject("Scripting.Dictionary")
    whPrintAdobeClosing = False
    whPrintAdobeClosePosted = False
    whPrintAdobeDeadline = DateAdd("n", 15, Now)
    whPrintAdobePid = WhPrintCreateAdobe(executable, arguments)
    whPrintAdobeCreated = WhPrintProcessCreated(whPrintAdobePid)
    ' Adobe may exit on its own or forward to another instance. Never close that instance.
    If Len(whPrintAdobeCreated) = 0 Then
        WhPrintResetAdobe
        Exit Sub
    End If
    VyskladneniDokoncitTiskAdobe
    Exit Sub
Failed:
    Dim description As String
    description = Err.Description
    WhPrintResetAdobe
    Err.Raise vbObjectError + 831, , description
End Sub

Private Function WhPrintCreateAdobe(ByVal executable As String, ByVal arguments As String) As Long
    Dim service As Object, startup As Object, pid As Variant, result As Long
    Set service = GetObject("winmgmts:\\.\root\cimv2")
    Set startup = service.Get("Win32_ProcessStartup").SpawnInstance_
    startup.ShowWindow = 7
    result = service.Get("Win32_Process").Create(WhPrintQuoteArgument(executable) & " " & arguments, Null, startup, pid)
    If result <> 0 Then Err.Raise vbObjectError + 832, , "Adobe se nepodarilo spustit. Kod Windows: " & result
    WhPrintCreateAdobe = CLng(pid)
End Function

Private Function WhPrintProcessCreated(ByVal pid As Long) As String
    Dim process As Object
    For Each process In GetObject("winmgmts:\\.\root\cimv2").ExecQuery("SELECT CreationDate FROM Win32_Process WHERE ProcessId = " & CStr(pid))
        If Not IsNull(process.CreationDate) Then WhPrintProcessCreated = CStr(process.CreationDate)
    Next process
End Function

Private Function WhPrintQueueSnapshot(ByVal printer As String) As Object
    Dim jobs As Object, job As Object, name As String, submitted As String, document As String, status As Long
    Set jobs = CreateObject("Scripting.Dictionary")
    For Each job In GetObject("winmgmts:\\.\root\cimv2").ExecQuery("SELECT Name, TimeSubmitted, Document, StatusMask FROM Win32_PrintJob")
        name = CStr(job.Name)
        If StrComp(Left$(name, Len(printer) + 2), printer & ", ", vbTextCompare) = 0 Then
            submitted = "": document = "": status = 0
            If Not IsNull(job.TimeSubmitted) Then submitted = CStr(job.TimeSubmitted)
            If Not IsNull(job.Document) Then document = CStr(job.Document)
            If Not IsNull(job.StatusMask) Then status = CLng(job.StatusMask)
            jobs(name & "|" & submitted) = Array(document, status)
        End If
    Next job
    Set WhPrintQueueSnapshot = jobs
End Function

Private Function WhPrintDocumentMatches(ByVal document As String) As Boolean
    Dim files As Object, name As String
    Set files = CreateObject("Scripting.FileSystemObject")
    name = files.GetFileName(document)
    WhPrintDocumentMatches = (StrComp(name, whPrintAdobeDocument, vbTextCompare) = 0 Or _
        StrComp(name, files.GetBaseName(whPrintAdobeDocument), vbTextCompare) = 0)
End Function

Private Function WhPrintQueueFinished(ByVal jobs As Object) As Boolean
    Dim key As Variant, entry As Variant, status As Long
    For Each key In jobs.Keys
        entry = jobs(key)
        If Not whPrintAdobeBaseline.Exists(key) Then
            If WhPrintDocumentMatches(CStr(entry(0))) Then whPrintAdobeSeen(key) = True
        End If
    Next key
    If whPrintAdobeSeen.Count = 0 Then Exit Function
    For Each key In whPrintAdobeSeen.Keys
        If jobs.Exists(key) Then
            entry = jobs(key)
            status = CLng(entry(1))
            ' Error/offline/paused/spooling/printing states take precedence over completion.
            If (status And 3711) <> 0 Then Exit Function
            If (status And (128 Or 4096)) = 0 Then Exit Function
        End If
    Next key
    WhPrintQueueFinished = True
End Function

Public Sub VyskladneniDokoncitTiskAdobe()
    If whPrintAdobePid = 0 Then Exit Sub
    On Error GoTo Failed
    If WhPrintProcessCreated(whPrintAdobePid) <> whPrintAdobeCreated Then
        WhPrintResetAdobe
        Exit Sub
    End If
    If whPrintAdobeClosing Then
        If Now >= whPrintAdobeDeadline Then Err.Raise vbObjectError + 833, , _
            "Adobe nepotvrdilo ukonceni. Zavrete jej prosim rucne; tisk znovu nespoustejte automaticky."
    Else
        Dim jobs As Object
        Set jobs = WhPrintQueueSnapshot(whPrintAdobePrinter)
        If WhPrintQueueFinished(jobs) Then
            ' A removed/completed queue job is safe to release; it is not proof of physical delivery.
            whPrintAdobeClosing = True
            whPrintAdobeDeadline = DateAdd("s", 30, Now)
            WhPrintCloseOwnedAdobe
        ElseIf Now >= whPrintAdobeDeadline Then
            Err.Raise vbObjectError + 834, , _
                "Dokonceni konkretni tiskove ulohy se nepodarilo overit. Adobe zustalo otevrene. Zkontrolujte tiskovou frontu pred dalsim tiskem."
        End If
    End If
    WhPrintScheduleAdobeCheck
    Exit Sub
Failed:
    Dim description As String
    description = Err.Description
    WhPrintResetAdobe
    MsgBox "Automaticke zavreni Adobe se nepodarilo:" & vbCrLf & description, vbExclamation
End Sub

Private Sub WhPrintScheduleAdobeCheck()
    Application.OnTime DateAdd("s", 2, Now), "'" & Replace(ThisWorkbook.Name, "'", "''") & "'!VyskladneniDokoncitTiskAdobe"
End Sub

Private Sub WhPrintCloseOwnedAdobe()
    If WhPrintProcessCreated(whPrintAdobePid) <> whPrintAdobeCreated Then Exit Sub
    WhPrintEnumWindows AddressOf WhPrintAdobeCloseWindow, 0
    If Not whPrintAdobeClosePosted Then Err.Raise vbObjectError + 835, , "Okno tiskove instance Adobe nebylo nalezeno. Zavrete Adobe prosim rucne."
End Sub

#If VBA7 Then
Public Function WhPrintAdobeCloseWindow(ByVal hwnd As LongPtr, ByVal parameter As LongPtr) As Long
#Else
Public Function WhPrintAdobeCloseWindow(ByVal hwnd As Long, ByVal parameter As Long) As Long
#End If
    Dim pid As Long
    WhPrintAdobeCloseWindow = 1
    WhPrintWindowPid hwnd, pid
    If pid <> whPrintAdobePid Then Exit Function
    If WhPrintGetWindow(hwnd, 4) <> 0 Then Exit Function
    If WhPrintWindowTitleLength(hwnd) = 0 Then Exit Function
    ' Normal WM_CLOSE, not termination; Adobe retains control over unsaved-document prompts.
    If WhPrintPostMessage(hwnd, &H10, 0, 0) <> 0 Then whPrintAdobeClosePosted = True
End Function

Private Sub WhPrintResetAdobe()
    whPrintAdobePid = 0
    whPrintAdobeCreated = ""
    Set whPrintAdobeBaseline = Nothing
    Set whPrintAdobeSeen = Nothing
End Sub

Private Function WhPrintAdobeArguments(ByVal pdf As String, ByVal printer As String, ByVal driver As String, ByVal port As String) As String
    ' A separate instance lets us close only the reader started for this print job.
    WhPrintAdobeArguments = "/n /s /h /t " & WhPrintQuoteArgument(pdf) & " " & WhPrintQuoteArgument(printer) & " " & _
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

Private Function WhPrintWorkbookFolderName(ByVal workbookFolder As String) As String
    ' Send only the folder name, never the full local or network path.
    If Len(workbookFolder) = 0 Or InStr(1, workbookFolder, "://", vbTextCompare) > 0 Then Exit Function
    WhPrintWorkbookFolderName = CreateObject("Scripting.FileSystemObject").GetFileName(workbookFolder)
End Function

Private Function WhPrintExpeditionDay(ByVal workbookFolder As String) As Date
    Dim files As Object, pattern As Object, matches As Object, match As Object
    Dim folder As String, level As Long, day As Long, month As Long, year As Long, value As Date
    Set files = CreateObject("Scripting.FileSystemObject")
    Set pattern = CreateObject("VBScript.RegExp")
    pattern.Pattern = "^([0-9]{1,2})\.\s*([0-9]{1,2})\.\s*([0-9]{4})( |$)"
    folder = workbookFolder
    ' A saved daily copy keeps its expedition date even when reopened another day.
    ' Also handle the copy in the daily folder's Samostatne skladovky subfolder.
    For level = 0 To 1
        Set matches = pattern.Execute(WhPrintWorkbookFolderName(folder))
        If matches.Count > 0 Then
            Set match = matches(0)
            day = CLng(match.SubMatches(0))
            month = CLng(match.SubMatches(1))
            year = CLng(match.SubMatches(2))
            value = DateSerial(year, month, day)
            If VBA.Day(value) <> day Or VBA.Month(value) <> month Or VBA.Year(value) <> year Then _
                Err.Raise vbObjectError + 825, , "Nazev slozky obsahuje neplatne datum expedicniho dne."
            WhPrintExpeditionDay = value
            Exit Function
        End If
        folder = files.GetParentFolderName(folder)
    Next level
    WhPrintExpeditionDay = Date
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

Private Sub WhPrintLaunchApplication(ByVal executable As String, ByVal arguments As String, Optional ByVal windowStyle As Long = 1)
    Dim operation As String
    operation = "open"
#If VBA7 Then
    Dim result As LongPtr
#Else
    Dim result As Long
#End If
    ' 7 = SW_SHOWMINNOACTIVE for printing; browser previews keep normal visible mode (1).
    result = WhPrintShellExecute(0, StrPtr(operation), StrPtr(executable), StrPtr(arguments), 0, windowStyle)
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
