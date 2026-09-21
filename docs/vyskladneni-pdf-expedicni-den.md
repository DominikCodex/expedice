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

## Okno Adobe při tisku

Všechna čtyři tisková makra (tři varianty i ruční výběr PDF) spouštějí Adobe s `/n /s /h /t` do vlastní minimalizované instance. Po dokončení konkrétní úlohy ve frontě Windows makro této instanci pošle běžný požadavek na zavření aplikace. Nejde už pouze o minimalizaci. Názvy tiskových maker zůstávají stejné, tlačítka není nutné měnit. Ruční HTML náhled v prohlížeči se nemění.

Makro sleduje identifikátor a čas vzniku nového procesu. Jinou, dříve otevřenou instanci Adobe nezavírá. Nepoužívá násilné ukončení procesu. Pokud Adobe místo nové instance předá tisk již otevřené aplikaci, tu makro ponechá otevřenou. Adobe příkazové přepínače popisuje v [SDK FAQ](https://opensource.adobe.com/dc-acrobat-sdk-docs/library/overview/apxDevFAQ.html), ale negarantuje jejich podporu napříč verzemi.

Během sledování ponechte tento sešit a Excel otevřený; kontrola probíhá na pozadí každé dvě sekundy přes `Application.OnTime`. Excel lze dál používat. Předchozí tisk z tohoto sešitu musí skončit, než se spustí další. Nejde o agenta ani o další instalaci. Po zavření sešitu nelze dokončení sledování garantovat; naplánované volání Excelu může požádat o opětovné otevření sešitu.

Uzavření je povoleno jen pro novou úlohu s názvem tištěného PDF na správné tiskárně. Starší a cizí úlohy se ignorují. Za dokončení se bere stav „vytištěno / předáno tiskárně“ nebo zmizení již pozorované úlohy z fronty. To není potvrzení fyzicky vytištěných listů (úloha mohla být také zrušena). Chyba, pauza, offline tiskárna nebo stále probíhající tisk zavření blokují.

Pokud konkrétní úlohu nelze identifikovat, například je příliš rychlá na zachycení nebo ovladač změní její název, makro Adobe nezavře naslepo. Po 15 minutách oznámí neověřené dokončení. Při nedostupné frontě oznámí chybu; pokud chybí už vstupní přehled fronty, tisk ani nespustí. Pokud aplikace nereaguje na zavření do 30 sekund, oznámí problém a ponechá ji uživateli. Úspěšné dokončení je bez hlášky, automatický opakovaný tisk se neprovádí.

Kontroly bez fyzického tisku: `tests/vba/warehouse-adobe.ps1` (původní generování a výběr PDF) a `tests/vba/warehouse-adobe-close.ps1` (sledování úloh, vlastnictví oken, chyby, časové limity). Oba používají izolovaný Excel s nahrazenými síťovými a tiskovými operacemi. Chování konkrétního Adobe a ovladače je nutné ověřit běžným tiskem na cílovém počítači.
