Option Explicit

' Samostatny helper pro tisk hotovych PDF stitku pres SumatraPDF.
' Master sesit si tuto funkci muze zavolat po vygenerovani nebo stazeni PDF.

Private Const EXPEDICE_STITEK_SUMATRA_EXE As String = ""
Private Const EXPEDICE_STITEK_DPD_PRINTER As String = "Brother QL-1100"
Private Const EXPEDICE_STITEK_PACKETA_PRINTER As String = "Brother QL-700"

Public Function ExpediceTiskStitekPresSumatra(ByVal pdfPathOrName As String, Optional ByVal carrier As String = "", Optional ByVal printer As String = "", Optional ByVal copies As Long = 1) As Boolean
    Dim pdfPath As String
    pdfPath = ExpediceStitekNajdiPdf(pdfPathOrName)

    If copies < 1 Then copies = 1

    Dim selectedPrinter As String
    selectedPrinter = Trim$(printer)
    If Len(selectedPrinter) = 0 Then
        selectedPrinter = ExpediceStitekPrinterProDopravce(carrier)
    End If

    Dim sumatraPath As String
    sumatraPath = ExpediceStitekNajdiSumatraPDF()

    Dim command As String
    command = ExpediceStitekSumatraCommand(sumatraPath, pdfPath, selectedPrinter, copies)

    Dim shell As Object
    Set shell = CreateObject("WScript.Shell")

    Dim exitCode As Long
    exitCode = shell.Run(command, 0, True)
    If exitCode <> 0 Then
        Err.Raise vbObjectError + 711, "ExpediceTiskStitekPresSumatra", _
            "SumatraPDF vratila chybu " & CStr(exitCode) & " pri tisku PDF:" & vbCrLf & pdfPath
    End If

    ExpediceTiskStitekPresSumatra = True
End Function

Private Function ExpediceStitekNajdiPdf(ByVal pdfPathOrName As String) As String
    Dim rawValue As String
    rawValue = Trim$(pdfPathOrName)
    If Len(rawValue) = 0 Then
        Err.Raise vbObjectError + 700, "ExpediceStitekNajdiPdf", "Neni zadany nazev ani cesta k PDF stitku."
    End If

    Dim candidates As Collection
    Set candidates = New Collection

    If ExpediceStitekJeAbsolutniCesta(rawValue) Then
        ExpediceStitekAddPdfCandidate candidates, rawValue
    Else
        ExpediceStitekAddPdfCandidate candidates, ThisWorkbook.Path & "\stitky\" & rawValue
        ExpediceStitekAddPdfCandidate candidates, ThisWorkbook.Path & "\" & rawValue
        ExpediceStitekAddPdfCandidate candidates, rawValue
    End If

    Dim candidate As Variant
    For Each candidate In candidates
        If ExpediceStitekSouborExistuje(CStr(candidate)) Then
            If FileLen(CStr(candidate)) <= 0 Then
                Err.Raise vbObjectError + 701, "ExpediceStitekNajdiPdf", _
                    "PDF stitek existuje, ale je prazdny:" & vbCrLf & CStr(candidate)
            End If
            ExpediceStitekNajdiPdf = CStr(candidate)
            Exit Function
        End If
    Next candidate

    Err.Raise vbObjectError + 702, "ExpediceStitekNajdiPdf", _
        "PDF stitek se nepodarilo najit. Zkontroluj cestu, nazev souboru nebo slozku:" & vbCrLf & _
        ThisWorkbook.Path & "\stitky\"
End Function

Private Sub ExpediceStitekAddPdfCandidate(ByVal candidates As Collection, ByVal path As String)
    path = Trim$(path)
    If Len(path) = 0 Then Exit Sub

    candidates.Add path
    If Not ExpediceStitekMaPdfPriponu(path) Then
        candidates.Add path & ".pdf"
    End If
End Sub

Private Function ExpediceStitekPrinterProDopravce(ByVal carrier As String) As String
    Dim normalizedCarrier As String
    normalizedCarrier = ExpediceStitekNormalizeCarrier(carrier)

    If InStr(1, normalizedCarrier, "dpd", vbTextCompare) > 0 Then
        ExpediceStitekPrinterProDopravce = EXPEDICE_STITEK_DPD_PRINTER
        Exit Function
    End If

    If InStr(1, normalizedCarrier, "packeta", vbTextCompare) > 0 _
        Or InStr(1, normalizedCarrier, "zasilkovna", vbTextCompare) > 0 _
        Or InStr(1, normalizedCarrier, "z-box", vbTextCompare) > 0 Then
        ExpediceStitekPrinterProDopravce = EXPEDICE_STITEK_PACKETA_PRINTER
        Exit Function
    End If

    Err.Raise vbObjectError + 703, "ExpediceStitekPrinterProDopravce", _
        "Neznamy dopravce stitku: " & carrier & vbCrLf & _
        "Zadej carrier 'dpd' nebo 'packeta', pripadne predej presny nazev tiskarny v parametru printer."
End Function

Private Function ExpediceStitekNormalizeCarrier(ByVal value As String) As String
    value = LCase$(Trim$(value))
    value = Replace(value, ChrW$(225), "a")
    value = Replace(value, ChrW$(269), "c")
    value = Replace(value, ChrW$(271), "d")
    value = Replace(value, ChrW$(233), "e")
    value = Replace(value, ChrW$(283), "e")
    value = Replace(value, ChrW$(237), "i")
    value = Replace(value, ChrW$(328), "n")
    value = Replace(value, ChrW$(243), "o")
    value = Replace(value, ChrW$(345), "r")
    value = Replace(value, ChrW$(353), "s")
    value = Replace(value, ChrW$(357), "t")
    value = Replace(value, ChrW$(250), "u")
    value = Replace(value, ChrW$(367), "u")
    value = Replace(value, ChrW$(253), "y")
    value = Replace(value, ChrW$(382), "z")
    ExpediceStitekNormalizeCarrier = value
End Function

Private Function ExpediceStitekNajdiSumatraPDF() As String
    Dim candidates As Collection
    Set candidates = New Collection

    ExpediceStitekAddCandidate candidates, EXPEDICE_STITEK_SUMATRA_EXE
    ExpediceStitekAddCandidate candidates, Environ$("SUMATRA_PDF_EXE")
    ExpediceStitekAddCandidate candidates, ThisWorkbook.Path & "\SumatraPDF.exe"
    ExpediceStitekAddCandidate candidates, ThisWorkbook.Path & "\bin\SumatraPDF.exe"
    ExpediceStitekAddWorkbookTreeSumatraCandidates candidates
    ExpediceStitekAddCandidate candidates, Environ$("LOCALAPPDATA") & "\ExpedicePrintAgentV2\bin\SumatraPDF.exe"
    ExpediceStitekAddCandidate candidates, Environ$("LOCALAPPDATA") & "\ExpedicePrintAgent\bin\SumatraPDF.exe"
    ExpediceStitekAddCandidate candidates, Environ$("ProgramFiles") & "\SumatraPDF\SumatraPDF.exe"
    ExpediceStitekAddCandidate candidates, Environ$("ProgramFiles(x86)") & "\SumatraPDF\SumatraPDF.exe"

    Dim candidate As Variant
    For Each candidate In candidates
        If ExpediceStitekSouborExistuje(CStr(candidate)) Then
            ExpediceStitekNajdiSumatraPDF = CStr(candidate)
            Exit Function
        End If
    Next candidate

    Err.Raise vbObjectError + 704, "ExpediceStitekNajdiSumatraPDF", _
        "SumatraPDF.exe nebyla nalezena. Dej ji do Expedice\Adresy, vedle sesitu, do podslozky bin, nebo vypln EXPEDICE_STITEK_SUMATRA_EXE."
End Function

Private Sub ExpediceStitekAddWorkbookTreeSumatraCandidates(ByVal candidates As Collection)
    Dim folderPath As String
    folderPath = ThisWorkbook.Path

    Do While Len(folderPath) > 0
        ExpediceStitekAddCandidate candidates, folderPath & "\Expedice\Adresy\SumatraPDF.exe"
        ExpediceStitekAddCandidate candidates, folderPath & "\Adresy\SumatraPDF.exe"

        Dim parentPath As String
        parentPath = ExpediceStitekParentFolder(folderPath)
        If Len(parentPath) = 0 Or parentPath = folderPath Then Exit Do
        folderPath = parentPath
    Loop
End Sub

Private Function ExpediceStitekSumatraCommand(ByVal sumatraPath As String, ByVal pdfPath As String, ByVal printer As String, ByVal copies As Long) As String
    Dim printSettings As String
    printSettings = "fit"
    If copies > 1 Then
        printSettings = printSettings & "," & CStr(copies) & "x"
    End If

    ExpediceStitekSumatraCommand = _
        ExpediceStitekQuoteArg(sumatraPath) & " " & _
        "-print-to " & ExpediceStitekQuoteArg(printer) & " " & _
        "-print-settings " & ExpediceStitekQuoteArg(printSettings) & " " & _
        "-silent -exit-on-print " & _
        ExpediceStitekQuoteArg(pdfPath)
End Function

Private Function ExpediceStitekJeAbsolutniCesta(ByVal path As String) As Boolean
    path = Trim$(path)
    ExpediceStitekJeAbsolutniCesta = _
        (Len(path) >= 3 And Mid$(path, 2, 2) = ":\") _
        Or Left$(path, 2) = "\\"
End Function

Private Function ExpediceStitekMaPdfPriponu(ByVal path As String) As Boolean
    ExpediceStitekMaPdfPriponu = (LCase$(Right$(Trim$(path), 4)) = ".pdf")
End Function

Private Sub ExpediceStitekAddCandidate(ByVal candidates As Collection, ByVal path As String)
    path = Trim$(path)
    If Len(path) > 0 Then candidates.Add path
End Sub

Private Function ExpediceStitekParentFolder(ByVal folderPath As String) As String
    folderPath = Trim$(folderPath)
    Do While Len(folderPath) > 3 And Right$(folderPath, 1) = "\"
        folderPath = Left$(folderPath, Len(folderPath) - 1)
    Loop

    Dim separatorPosition As Long
    separatorPosition = InStrRev(folderPath, "\")
    If separatorPosition <= 0 Then
        ExpediceStitekParentFolder = ""
    ElseIf separatorPosition <= 3 Then
        ExpediceStitekParentFolder = Left$(folderPath, separatorPosition)
    Else
        ExpediceStitekParentFolder = Left$(folderPath, separatorPosition - 1)
    End If
End Function

Private Function ExpediceStitekSouborExistuje(ByVal path As String) As Boolean
    If Len(path) = 0 Then
        ExpediceStitekSouborExistuje = False
        Exit Function
    End If

    On Error Resume Next
    ExpediceStitekSouborExistuje = Len(Dir$(path, vbNormal)) > 0
    On Error GoTo 0
End Function

Private Function ExpediceStitekQuoteArg(ByVal value As String) As String
    ExpediceStitekQuoteArg = """" & Replace(value, """", """""") & """"
End Function
