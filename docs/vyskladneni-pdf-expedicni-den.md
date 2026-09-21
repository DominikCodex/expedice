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

## Tisk kolegyní na jiném počítači

Generování ukládá do `VyskladneniPDF\posledni-sestava.xml` trvalý seznam poslední sady. Obsahuje pouze relativní cesty, takže se může celý expediční den přenést na jiný počítač nebo do jiné složky Dropboxu. Sešit není potřeba po generování znovu ukládat: seznam leží vedle PDF a denní kopie může vzniknout před nimi.

Kolegyně otevře denní kopii a použije původní makra:

```vb
VyskladneniTiskBeznePoradi
VyskladneniTiskPrioritniZasilky
VyskladneniTiskPrioritniKusy
```

Makra načtou seznam z `VyskladneniPDF` vedle otevřeného sešitu. U kopie ve složce `Samostatné skladovky` použijí nadřazený den, pokud vlastní složka s PDF neexistuje. Nic negenerují, neuploadují ani automaticky nenabízejí výběr souboru. Tisk jde nadále přes Adobe na výchozí tiskárnu daného počítače.

Je nutné synchronizovat **celou složku dne včetně PDF a XML**, nejen XLSM. Při chybě synchronizace, chybějícím PDF nebo neúplném generování se zobrazí chyba; makro nepoužije místo chybějící varianty starší soubor. Seznam se na začátku generování vyprázdní, takže po selhání celé nové sady nelze nechtěně tisknout předchozí.

Starší PDF bez XML se dohledají podle nejnovějšího časového označení v názvech vygenerovaných souborů. Vybere se vždy jedna společná sada všech variant, nikoli nejnovější soubor v každé složce zvlášť. Pokud jsou dvě různé sady označené stejnou sekundou, makro požádá o ruční výběr. Poškozené nebo prázdné XML se nikdy neobchází tímto dohledáváním.

Nový modul musí být i v kopii, kterou používá kolegyně. Aktualizace masteru nezmění již dříve vytvořené XLSM kopie. U nové denní kopie vytvořené z aktualizovaného masteru není potřeba žádná další úprava tlačítek.
