Option Explicit

' Volitelne vypln, pokud je SumatraPDF.exe na jine ceste.
' Kdyz zustane prazdne, modul zkusi bezna umisteni vcetne slozky u sesitu
' a slozek, kam ji rozbaluje print agent. Agent se ale nespousti ani nepouziva.
Private Const EXPEDICE_SUMATRA_EXE As String = ""

' Volitelne vypln presny nazev tiskarny. Prazdne = vychozi tiskarna Windows.
Private Const EXPEDICE_DEFAULT_PRINTER As String = ""

Public Sub ExpediceTiskAktivniListPresSumatra()
    On Error GoTo ErrHandler
    ExpediceTiskObjektPresSumatra ActiveSheet, ActiveSheet.Name, EXPEDICE_DEFAULT_PRINTER
    Exit Sub

ErrHandler:
    Application.StatusBar = False
    MsgBox "Tisk aktivniho listu se nepodaril:" & vbCrLf & Err.Description, vbCritical
End Sub

Public Sub ExpediceTiskVyberPresSumatra()
    On Error GoTo ErrHandler

    If TypeName(Selection) <> "Range" Then
        MsgBox "Vyber bunky nebo oblast bunek, kterou chces vytisknout.", vbExclamation
        Exit Sub
    End If

    ExpediceTiskObjektPresSumatra Selection, ActiveSheet.Name & "-vyber", EXPEDICE_DEFAULT_PRINTER
    Exit Sub

ErrHandler:
    Application.StatusBar = False
    MsgBox "Tisk vyberu se nepodaril:" & vbCrLf & Err.Description, vbCritical
End Sub

Public Sub ExpediceTestSumatraPDF()
    On Error GoTo ErrHandler

    MsgBox "SumatraPDF nalezena:" & vbCrLf & ExpediceNajdiSumatraPDF(), vbInformation
    Exit Sub

ErrHandler:
    MsgBox "SumatraPDF se nepodarilo najit:" & vbCrLf & Err.Description, vbCritical
End Sub

Private Sub ExpediceTiskObjektPresSumatra(ByVal sourceObject As Object, ByVal nameHint As String, ByVal printer As String)
    On Error GoTo ErrHandler

    Dim pdfPath As String
    pdfPath = ExpediceTempPdfPath(nameHint)

    Application.StatusBar = "Pripravuji PDF pro tisk..."
    sourceObject.ExportAsFixedFormat _
        Type:=xlTypePDF, _
        Filename:=pdfPath, _
        Quality:=xlQualityStandard, _
        IncludeDocProperties:=True, _
        IgnorePrintAreas:=False, _
        OpenAfterPublish:=False

    Application.StatusBar = "Tisknu PDF pres SumatraPDF..."
    ExpedicePrintPdfSouborPresSumatra pdfPath, printer, 1

    Application.StatusBar = False
    ExpediceSmazTempPdf pdfPath
    MsgBox "PDF bylo odeslano do SumatraPDF.", vbInformation
    Exit Sub

ErrHandler:
    Application.StatusBar = False
    ExpediceSmazTempPdf pdfPath
    Err.Raise Err.Number, "ExpediceTiskObjektPresSumatra", Err.Description
End Sub

Public Sub ExpedicePrintPdfSouborPresSumatra(ByVal pdfPath As String, Optional ByVal printer As String = "", Optional ByVal copies As Long = 1)
    If Not ExpediceSouborExistuje(pdfPath) Then
        Err.Raise vbObjectError + 520, "ExpedicePrintPdfSouborPresSumatra", "PDF soubor neexistuje: " & pdfPath
    End If
    If copies < 1 Then copies = 1

    Dim sumatraPath As String
    sumatraPath = ExpediceNajdiSumatraPDF()

    Dim command As String
    command = ExpediceSumatraCommand(sumatraPath, pdfPath, printer, copies)

    Dim shell As Object
    Set shell = CreateObject("WScript.Shell")

    Dim exitCode As Long
    exitCode = shell.Run(command, 0, True)
    If exitCode <> 0 Then
        Err.Raise vbObjectError + 521, "ExpedicePrintPdfSouborPresSumatra", "SumatraPDF vratila chybu " & CStr(exitCode) & "."
    End If
End Sub

Private Function ExpediceNajdiSumatraPDF() As String
    Dim candidates As Collection
    Set candidates = New Collection

    ExpediceAddCandidate candidates, EXPEDICE_SUMATRA_EXE
    ExpediceAddCandidate candidates, Environ$("SUMATRA_PDF_EXE")
    ExpediceAddCandidate candidates, ThisWorkbook.Path & "\SumatraPDF.exe"
    ExpediceAddCandidate candidates, ThisWorkbook.Path & "\bin\SumatraPDF.exe"
    ExpediceAddCandidate candidates, Environ$("LOCALAPPDATA") & "\ExpedicePrintAgentV2\bin\SumatraPDF.exe"
    ExpediceAddCandidate candidates, Environ$("LOCALAPPDATA") & "\ExpedicePrintAgent\bin\SumatraPDF.exe"
    ExpediceAddCandidate candidates, Environ$("ProgramFiles") & "\SumatraPDF\SumatraPDF.exe"
    ExpediceAddCandidate candidates, Environ$("ProgramFiles(x86)") & "\SumatraPDF\SumatraPDF.exe"

    Dim candidate As Variant
    For Each candidate In candidates
        If ExpediceSouborExistuje(CStr(candidate)) Then
            ExpediceNajdiSumatraPDF = CStr(candidate)
            Exit Function
        End If
    Next candidate

    Err.Raise vbObjectError + 522, "ExpediceNajdiSumatraPDF", _
        "SumatraPDF.exe nebyla nalezena. Dej ji vedle sesitu, do podslozky bin, nebo vypln EXPEDICE_SUMATRA_EXE."
End Function

Private Sub ExpediceAddCandidate(ByVal candidates As Collection, ByVal path As String)
    path = Trim$(path)
    If Len(path) > 0 Then candidates.Add path
End Sub

Private Function ExpediceSumatraCommand(ByVal sumatraPath As String, ByVal pdfPath As String, ByVal printer As String, ByVal copies As Long) As String
    Dim command As String
    command = ExpediceQuoteArg(sumatraPath) & " "

    If Len(Trim$(printer)) > 0 Then
        command = command & "-print-to " & ExpediceQuoteArg(printer) & " "
    Else
        command = command & "-print-to-default "
    End If

    command = command & "-silent -exit-on-print "
    If copies > 1 Then
        command = command & "-print-settings " & ExpediceQuoteArg(CStr(copies) & "x") & " "
    End If
    command = command & ExpediceQuoteArg(pdfPath)

    ExpediceSumatraCommand = command
End Function

Private Function ExpediceTempPdfPath(ByVal nameHint As String) As String
    ExpediceTempPdfPath = Environ$("TEMP") & "\" & ExpediceSafeFileName("expedice-" & nameHint & "-" & Format$(Now, "yyyymmdd-hhnnss")) & ".pdf"
End Function

Private Sub ExpediceSmazTempPdf(ByVal pdfPath As String)
    If Len(pdfPath) = 0 Then Exit Sub
    On Error Resume Next
    Kill pdfPath
    On Error GoTo 0
End Sub

Private Function ExpediceSouborExistuje(ByVal path As String) As Boolean
    If Len(path) = 0 Then
        ExpediceSouborExistuje = False
        Exit Function
    End If

    On Error Resume Next
    ExpediceSouborExistuje = Len(Dir$(path, vbNormal)) > 0
    On Error GoTo 0
End Function

Private Function ExpediceQuoteArg(ByVal value As String) As String
    ExpediceQuoteArg = """" & Replace(value, """", """""") & """"
End Function

Private Function ExpediceSafeFileName(ByVal value As String) As String
    Dim invalidChars As Variant
    invalidChars = Array("\", "/", ":", "*", "?", """", "<", ">", "|")

    Dim index As Long
    For index = LBound(invalidChars) To UBound(invalidChars)
        value = Replace(value, CStr(invalidChars(index)), "-")
    Next index

    value = Trim$(value)
    If Len(value) = 0 Then value = "excel-tisk"
    ExpediceSafeFileName = value
End Function
