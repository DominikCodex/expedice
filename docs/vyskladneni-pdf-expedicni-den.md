# PDF ke kopii expedičního dne

Aktuální modul: `vba/VyskladneniTisk.bas`. Nahraď obsah stávajícího modulu; nevytvářej druhou kopii se stejnými názvy maker.

Nové volání:

```vb
Call VyskladneniPdfDoSlozky(saveittodir, expedicniDen)
```

`saveittodir` je existující složka expedičního dne, nikoli cesta k XLSM. Funkce čte data ze sešitu obsahujícího modul a uloží všechny tři sestavy do `saveittodir\VyskladneniPDF`, každou do vlastní podsložky. Nekopíruje Excel, neotevírá PDF a netiskne. Úspěch je bez MsgBoxu; chyby a chybějící fotografie zůstávají hlášené.

## Zapojení do archivace masteru

Na začátku archivačního makra zachyť datum jednou, aby se při dlouhém běhu nemohlo změnit přes půlnoc:

```vb
Dim expedicniDen As Date
expedicniDen = Date
```

V části vytvářející hlavní denní kopii (a před částí `Samostatné skladovky`) použij:

```vb
saveittodir = ThisWorkbook.Path & "\Balíčky - Expedice\Expedice\" & expedicniDen
MkDir saveittodir

finaldestination = saveittodir & "\import NEW MAKRO.XLSM"
ActiveWorkbook.SaveCopyAs finaldestination

Call VyskladneniPdfDoSlozky(saveittodir, expedicniDen)
```

Příklad pro 21. 9. 2026, při českém formátu data ve Windows:

```text
Balíčky - Expedice\Expedice\21.09.2026\
  import NEW MAKRO.XLSM
  VyskladneniPDF\
    Bezne-poradi\...-Bezne-poradi.pdf
    Prioritni-zasilky-prvni\...-Prioritni-zasilky-prvni.pdf
    Prioritni-kusy-zvlast\...-Prioritni-kusy-zvlast.pdf
```

Přímé převedení data na text zachovává původní pojmenování složek podle nastavení Windows. Pro pevný název `21.09.2026` lze místo `& expedicniDen` použít `& Format$(expedicniDen, "dd.mm.yyyy")`; stejný způsob pak použij i pro navazující složku `Samostatné skladovky`.

Předchozí kopii `datum OBJEDNÁVKA` i následnou kopii `Samostatné skladovky` ponech beze změny; pro datum mohou rovněž použít zachycené `expedicniDen`. `SaveCopyAs` nepřepne otevřený master na novou kopii, proto je nutné předat cílovou složku výslovně. Makro netvoří tlačítka a existující složky ani PDF nemaže.

## Datum v hlavičce

Hlavička všech tří sestav používá datum expedičního dne: `21.09.2026 · Skladovky k vyskladnění`. Název složky masteru ani čas generování se zde nezobrazují. Datum se serveru předává jako `datasetDate`, nikoli jako lokální cesta.

Původní bezparametrická makra zůstávají funkční. Při spuštění z uložené denní kopie rozpoznají datum z názvu složky `dd.mm.rrrr`, `d. m. rrrr` nebo `datum OBJEDNÁVKA`; podporovaná je také jejich přímá podsložka (například `Samostatné skladovky`). Při spuštění z masteru bez datované složky použijí dnešek. Pro jiné pojmenování složek předávej datum novou funkcí výslovně.

Stávající tři tisková makra následně použijí právě vygenerovaná PDF z nové cílové složky, bez dalšího uploadu. Automatický tisk přes Adobe tato změna nijak neupravuje.
