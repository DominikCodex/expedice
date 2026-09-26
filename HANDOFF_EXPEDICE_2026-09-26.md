# Handoff projektu Expedice pro jiné PC

Datum ověření: **26. 9. 2026**. Autor předání: Codex pro Dominika (Domču).

## 1. Začni tady

- Repozitář: https://github.com/DominikCodex/expedice.git
- Pracovní větev: `master`.
- Produkce: https://expedice-production.up.railway.app
- Poslední aplikační commit před tímto dokumentem: `6f8fe9c5396e037b822926bcb371b7f16cdb8cb2`.
- Tentýž commit byl 26. 9. ověřen přes `git ls-remote origin refs/heads/master`. Commit tohoto handoffu bude novější, bez změny aplikace.
- Poslední úkol: doplnit do hlaviček sestav explicitně Zásilkovnu také u skladových skupin iVeronika.cz a iVeronika.sk, nikoli jen Galantra.cz.
- **Tato změna je hotová a pushnutá.** Produkční `app.js` už obsahuje oba nové popisky, HTTP 200. `/api/health` vrátil `{"database":true,"ok":true}`.
- Původní zpráva z 24. 9., že změna ještě není na serveru, už není aktuální. Nové ověření kontrolovalo veřejný JS a zdraví serveru, nikoli nový produkční PDF výstup ani stav Railway deploymentu/API GitHub Actions.
- Kvůli popiskům nebo grafice sestav se nemění VBA. Je nutné znovu vygenerovat HTML/PDF; již stažené soubory se samy nezmění.

Tento dokument má přednost před historickými pokyny tam, kde popisuje novější chování. Pro širší části aplikace (platby, role, audit, dopravci, skenery) navazuje na `HANDOFF_EXPEDICE_2026-08-27.md`. Nejde o nový audit všech těchto integrací.

## 2. Co přenést a co Git neobsahuje

### Doporučený postup na druhém PC

1. Použít vlastní čistý klon repozitáře, nikoli současně pracovat na jedné složce `.git` synchronizované přes Dropbox ze dvou PC.
2. Stáhnout `master`, přečíst tento dokument a zkontrolovat vlastní lokální změny.
3. Pracovní Excel a denní složky přenést zvlášť přes zabezpečené úložiště/Dropbox.
4. Pro tisk přenést **celý expediční den**, nejen XLSM: všechny PDF podsložky i `posledni-sestava.xml`.
5. Přihlašovací údaje získat bezpečnou cestou. Nejsou součástí handoffu a nesmějí se přidávat do Gitu.

```powershell
git clone https://github.com/DominikCodex/expedice.git
cd expedice
git status --short
git branch --show-current
git log -8 --oneline
```

U již existujícího klonu nejprve zkontroluj změny a teprve potom:

```powershell
git fetch origin
git pull --ff-only origin master
```

Neprovádět `git reset --hard`, hromadné obnovování souborů ani automatické mazání konfliktů. Pokud je lokální větev rozdílná, nejprve pochopit její změny.

### Lokální stav původního PC, který NENÍ v posledním commitu

Původní kořen projektu:
`C:\Users\Dominik Collider\Dropbox\Dominik\Codex\Expedice Excel`

Ověřený `git status --short` před přidáním handoffu:

```text
 M vba/ExpediceTiskPresSumatra.bas
?? .codex_tmp_vba/
?? Master Soubor/
?? app (DESKTOP-FL5RAET's conflicted copy 2026-08-27).js
```

- `Master Soubor/` obsahuje `import NEW MAKRO.XLSM`. Jde o lokální pracovní sešit, ne o součást klonu. Jeho VBA projekt nebyl při tomto předání porovnán s aktuálními `.bas` moduly.
- `.codex_tmp_vba/` obsahuje `Module10.bas`; neověřený pomocný export, nepovažovat za aktuální distribuční modul.
- Konfliktní kopii `app ...js` ponechat stranou. Nemazat ani slučovat bez kontroly, automaticky ji nepovažovat za pravdivější než `app.js`.
- **Pozor na necommitnutý Sumatra modul:** v `ExpediceSafeFileName` je původní příkaz `value = Replace(value, CStr(invalidChars(index)), "-")` lokálně rozdělen na řádek `value =` a další řádek s `Replace(...)`, bez VBA pokračování `_`. To je syntakticky neplatná změna. Nebyla opravována ani commitována, protože nevznikla v aktuálním úkolu. Při dalším použití tohoto modulu vyřešit samostatně po potvrzení záměru.
- Nový skladový tisk přes Adobe používá `VyskladneniTisk.bas`, nikoli tento Sumatra modul. Chybný starší modul vložený do stejného VBA projektu ale může blokovat kompilaci celého projektu.

Žádné z těchto lokálních dat nepřidávat hromadným `git add .` do repozitáře. Změny nepřepisovat. Pokud je chce Dominik přenést, přenést je odděleně a zachovat původní soubory.

## 3. Aktuální architektura a důležité soubory

| Soubor / adresář | Odpovědnost |
| --- | --- |
| `app.py` | Flask backend, PostgreSQL, uživatelé, importy, API, dopravci, fotografie, sestavení tiskových dat |
| `app.js`, `index.html`, `styles.css` | Hlavní webové rozhraní expedice, kompletace, roztřídění a administrace |
| `warehouse-print.html` | Samostatná tisková stránka |
| `warehouse-print.js` | Řazení, priority, varianty, produktové skupiny, hlavička, fotografie a stránkování |
| `warehouse-print.css` | A4, orientace, kompaktní režim, rámečky, typografie a tisk |
| `warehouse_print_report.py` | Souhrn z pomocného listu KOMPLETACE, rozsahy boxů, prioritní kusy |
| `warehouse_pdf.py` | Serverové PDF přes Python Playwright/Chromium, omezené síťové zdroje, zmenšení fotografií |
| `expedition_integrity.py` | Výpočty konzistence a reportů databázové várky |
| `vba/VyskladneniTisk.bas` | Aktuální samostatný tiskový modul Excelu: HTML, tři PDF, výběr a tisk přes Adobe |
| `vba/ExpediceUploadJedenSkript.bas` | Aktuální společný upload EXCEL/KOMPLETACE do databázové expedice; v Excelu často `UPLOADRAILWAY` |
| `vba/UploadRoztrideniZbozi.bas`, `vba/UploadKompletace.bas` | Alternativní starší samostatné upload moduly; nepřidávat duplicitní veřejné funkce vedle společného modulu |
| `vba/ExpediceTiskPresSumatra.bas`, `vba/ExpediceTiskStitkuPresSumatra.bas` | Samostatné/starší tiskové cesty. Nezaměňovat s aktuálním skladovým PDF workflow |
| `docs/vyskladneni-pdf-expedicni-den.md` | Aktuální postup pro denní kopie, trvalý výběr PDF, datum, Adobe a upozornění na fotky |
| `vba/VyskladneniTisk.md` | Podrobný popis tiskových dat a vzhledu; některé starší odstavce jsou překonané, viz níže |
| `tests/test_warehouse_*.py` | Backend a PDF testy |
| `tests/e2e/warehouse-print.spec.js` | Prohlížečové testy všech důležitých tiskových režimů |
| `tests/vba/` | Izolované testy VBA přes nainstalovaný Excel |
| `print-agent-dotnet/` | Podporovaný agent V2 pro jiné tiskové workflow; skladová PDF z Excelu ho nepotřebují |
| `print-agent/` | Historický agent V1 |
| `Dockerfile`, `railway.json` | Aktuální produkční sestavení a spuštění |

### Nezaměňovat tři odlišné cesty

1. **Samostatná sestava z Excelu:** odeslání hodnot listů, vrácení HTML/PDF. Nevytváří ani nemění databázovou várku, neprovádí odpisy, nevyžaduje přihlášení. Fotografie mohou využít konfiguraci/cache serveru.
2. **Upload roztřídění a kompletace:** `POST /api/datasets/upload`, trvalé dávky, report dne a návazné kontroly. Používá jiný modul i oprávnění.
3. **Interaktivní webové vyskladnění:** upload XLSX do vybraného dne, databázové řádky a průběžné odpisy. To není totéž co samostatné tlačítko pro tisk.

Uživatel opakovaně požadoval tyto cesty neslučovat.

## 4. Veřejná makra, která používat

### Tiskový modul `vba/VyskladneniTisk.bas`

| Makro | Co dělá |
| --- | --- |
| `VyskladneniNahratATisk()` | Odešle data a otevře lokální HTML sestavu v prohlížeči pro ruční tisk |
| `VyskladneniPdfVygenerovat()` | Stáhne všechny tři PDF do `VyskladneniPDF` vedle sešitu; nic netiskne ani neotevírá |
| `VyskladneniPdfDoSlozky(cilovaSlozka, expedicniDen)` | Stejné tři PDF do explicitně předané existující složky dne, s explicitním datem |
| `VyskladneniPdfATisk()` | Kompatibilní starý název, nyní pouze zavolá generování všech tří PDF. Navzdory názvu netiskne |
| `VyskladneniTiskBeznePoradi()` | Tisk již uložené běžné sestavy přes Adobe na výchozí tiskárnu |
| `VyskladneniTiskPrioritniZasilky()` | Tisk uložené sestavy s prioritními zásilkami prvními |
| `VyskladneniTiskPrioritniKusy()` | Tisk uložené sestavy s prioritními kusy zvlášť |
| `VyskladneniPdfVytisknoutAdobe()` | Nabídne výběr konkrétního PDF, potvrzený soubor rovnou odešle k tisku |

Veřejné `VyskladneniDokoncitTiskAdobe` a `WhPrintAdobeCloseWindow` jsou technické zpětné volání monitoru/Windows API, nikoli nová tlačítka pro skladníky.

- Makra lze spouštět z libovolného listu **sešitu obsahujícího modul** (`ThisWorkbook`).
- Nová tlačítka se nikdy automaticky nevytvářejí. Dominik je vytváří a přiřazuje sám.
- Při aktualizaci nahrazovat obsah existujícího modulu, nepřidávat druhý modul se stejnými veřejnými funkcemi.
- Zachovat Windows 32/64bit větvení deklarací a české znaky. Výsledný sešit uložit jako XLSM/XLSB.
- Aktualizace `.bas` v repozitáři sama neaktualizuje modul uvnitř Excelu, natož dříve vytvořené kopie XLSM.

### Upload modul `vba/ExpediceUploadJedenSkript.bas`

- `UploadRoztrideniAktualniTabulky()` čte `EXCEL`.
- `UploadKompletaceAktualniTabulky()` čte `KOMPLETACE`.
- Chybějící list je chyba, nepoužívat místo něj náhodný aktivní list.
- Úspěch bez MsgBoxu, průběh ve stavovém řádku. MsgBox pouze při chybě.
- Probuzení serverless Railway: `/api/health`, nejvýše 5 pokusů, prodlevy 5/10/15/20 sekund, limit odpovědi 60 sekund.
- Upload: limit čekání na odpověď 180 sekund; navíc samostatné síťové limity.
- POST s daty **automaticky neopakovat**. Při ztrátě odpovědi už mohla dávka vzniknout. Nejprve zkontrolovat server, jinak hrozí duplicita.
- Při výměně modulu zachovat uživatelův `EXPEDICE_UPLOAD_TOKEN`; v repozitáři je prázdný. Získání oprávnění neobcházet odstraněním autentizace serveru.
- Toto probouzení bylo implementováno ve společném upload modulu; automaticky nepředpokládat totožnou retry logiku ve všech ostatních makrech.

## 5. Denní kopie, datum várky a přenos na sklad

Dominik ukládá kopie masteru do několika míst. Požadovaný cíl PDF je hlavní denní složka:

```text
ThisWorkbook.Path\Balíčky - Expedice\Expedice\<datum>
```

**Nikoli** předchozí složka `<datum> OBJEDNÁVKA`, **nikoli** `Samostatné skladovky`, **nikoli** cesta `finaldestination` končící na XLSM.

Zapojení do stávajícího makra, datum zachytit jednou:

```vb
Dim expedicniDen As Date
expedicniDen = Date

saveittodir = ThisWorkbook.Path & "\Balíčky - Expedice\Expedice\" & expedicniDen
MkDir saveittodir
finaldestination = saveittodir & "\import NEW MAKRO.XLSM"
ActiveWorkbook.SaveCopyAs finaldestination

Call VyskladneniPdfDoSlozky(saveittodir, expedicniDen)
```

Je to ukázka místa vložení do existujícího workflow, nikoli idempotentní náhrada celého archivačního makra. `MkDir` vyžaduje existující rodiče a selže, pokud cílová složka už existuje. `SaveCopyAs` nepřepne otevřený master na novou kopii; proto předáváme složku a datum výslovně. Dominikův původní kód používá `ActiveWorkbook`; při další úpravě nejprve ověřit, že aktivní sešit je skutečně zamýšlený master.

Zápis `& expedicniDen` závisí na nastavení Windows. Pro jednotný název lze po dohodě používat `Format$(expedicniDen, "dd.mm.yyyy")` ve všech navazujících cestách současně.

Výsledná struktura:

```text
26.09.2026/
  import NEW MAKRO.XLSM
  VyskladneniPDF/
    posledni-sestava.xml
    Bezne-poradi/
      Vyskladneni-<cas>-<id>-Bezne-poradi.pdf
    Prioritni-zasilky-prvni/
      Vyskladneni-<cas>-<id>-Prioritni-zasilky-prvni.pdf
    Prioritni-kusy-zvlast/
      Vyskladneni-<cas>-<id>-Prioritni-kusy-zvlast.pdf
  Samostatné skladovky/
    import NEW MAKRO.XLSM
```

- Všechny tři PDF jedné sady sdílejí čas/ID a každý soubor obsahuje typ sestavy v názvu.
- Generování probíhá postupně, tři požadavky se stejnými daty a různou prioritou. Není to jeden upload a tři lokální převody.
- Nové generování nepřepisuje staré PDF, ale na začátku zneplatní předchozí výběr sady.
- `posledni-sestava.xml` uchovává relativní cesty. Není závislé na přihlášeném Windows uživateli, restartu Excelu ani cestě původního PC.
- Kolegyně otevře denní kopii a zavolá jedno ze tří tiskových maker. Není třeba opakovaný upload/generování.
- Kopie v `Samostatné skladovky` hledá PDF v rodičovském dni, pokud nemá vlastní PDF složku.
- Synchronizovat PDF i XML jako lokálně dostupné soubory. Samotné XLSM nestačí.
- Chybějící varianta poslední sady se nenahrazuje starším PDF. Prázdné/poškozené XML je chyba, ne důvod tajně tisknout starou sadu.
- Jen pokud XML vůbec chybí, funguje zpětná kompatibilita podle společného časového označení starých názvů. Dvě různé sady ve stejné sekundě vyžadují ruční výběr.

## 6. Aktuální požadovaný vzhled a obchodní pravidla sestav

### Hlavička a souhrn

- Vpravo nahoře datum expedičního dne z `datasetDate`, formát `dd.mm.yyyy`, červeně, tučně, 32 px (asi 2,3násobek původního textu). Pod datem celkový počet kusů.
- Vlevo `Vyskladnění zboží`, `Sestava: <typ>` a `Skladovky k vyskladnění`.
- Nezobrazovat technický název `VYSKLADNI`, čas ani původní údaj `166 variant · 104 boxů`.
- Starší požadavek „název složky masteru“ byl nahrazen skutečným datem expedičního dne. Chybějící datum UI nenahrazuje dneškem. Makro bez explicitního data umí rozpoznat datum z denní složky; z nedatovaného masteru použije dnešek.
- Souhrn: objednávky, kusy celkem, skladové objednávky, skladové kusy a prioritní kusy.
- Souhrn samostatného tisku vychází z přiloženého Excelu, ne z živého databázového reportu dne.
- Skladové kusy jsou součtem kusů odeslaných k vyskladnění, včetně skladových kusů smíšených objednávek. Nesmí se omezit jen na objednávky s kódem pod 2.
- Prioritní kusy jsou jen kusy přidělené červeným boxům, nikoli celé smíšené varianty nebo počty objednávek.
- Pod souhrnem souvislé rozsahy boxů podle expedičního kódu. Mezery/změna kódu rozsah rozdělují.

Aktuální názvy skupin v `app.py` a výchozí názvy v `app.js`:

| Kód R | Název |
| --- | --- |
| `0.8` | Komplet ze skladu Galantra.cz přes Zásilkovnu |
| `1` | Komplet ze skladu iVeronika.cz přes Zásilkovnu |
| `1.5` | Komplet ze skladu iVeronika.sk přes Zásilkovnu |
| `1.8` | Komplet ze skladu Galantra.cz přes DPD |
| `1.9` | Komplet ze skladu DPD mimo Galantra.cz |
| `2` | Zásilkovna pouze Hotex |
| `3` | Zásilkovna Milpex |
| `4` | Zásilkovna Milpex + Hotex kombinace |
| `5` | Zatím nepoužíváme |
| `6` | iVeronika.sk Zásilkovna |
| `7` | DPD Milpex nebo Hotex |
| `8` | ERRORKA Galantra.cz |

Příklad poslední opravy: 1–5 Galantra.cz přes Zásilkovnu, 6–10 iVeronika.cz přes Zásilkovnu, 11–15 iVeronika.sk přes Zásilkovnu. **Doplnění dopravce nemění priority:** červený zůstává kód `0.8`, ne všechny zásilky Zásilkovny. Samostatný tisk používá výchozí mapu, nikoli přejmenování uložená v databázovém Nastavení. Hlavní aplikace může mít vlastní administrátorské popisky, které poslední commit nemigroval ani nepřepisoval.

### Tři režimy

- `normal` / Běžné pořadí: bez přednosti priorit; při produktovém řazení běžné zboží, poté II. jakost na konci všech produktů.
- `first` / Prioritní zásilky první: celé variantní řádky s alespoň jedním prioritním boxem dopředu; nejdřív běžná jakost, pak prioritní II. jakost, potom ostatní běžná a ostatní II. jakost. Smíšený řádek se nedělí.
- `split` / Prioritní kusy zvlášť: smíšenou variantu rozdělit na prioritní a ostatní alokace se samostatnými součty. Prioritní II. jakost patří k prioritní části. Ostatní kusy začínají při tisku na nové stránce až za celou prioritní částí. Nevytvářet prázdné stránky pro prázdné skupiny.

Výchozí zobrazení: **Produkt a varianta, A4 na výšku, Kompaktní, Prioritní kusy zvlášť**. Přepínače pro jiné režimy a A4 na šířku zůstávají. V tisku viditelné `Strana X z Y`.

### Produkty, varianty a fotografie

- Produkt a jeho varianty vizuálně spojit rámečkem včetně levé/pravé hrany. Vícevariantní produkt má výrazný nadpis, počet variant a součet pouze právě vypsaného bloku.
- Skupina: Gina před první pomlčkou; `BOXERKY-BASIC` má výjimku před třetí pomlčkou (např. `BOXERKY-BASIC-021`); ostatní před druhou pomlčkou.
- Ginu určovat spárováním celého variantního kódu s pomocným listem EXCEL, ne hádáním z názvu nebo tvaru čísla.
- Variantní kód tučným Arialem, název v jednotlivém řádku netučný. Fotografie mezi sloupci produkt/kód a varianta.
- Varianta: nejprve velikost, pak čárka a barva. Nezobrazovat popisky `Velikost:`/`Barva:`. Lomítka uvnitř velikostí (`L/XL`) zachovat.
- Štítek `II. JAKOST` vedle kódu, ne ve vlastním horním řádku.
- Skrýt pouze přesně požadovanou frázi `Výhodné balení 5 kusů -` (včetně obsluhy mezer/NBSP), ne obecné vícepacky.
- Sloupec `Hotovo` odstraněn; více místa pro boxy, obvykle tři boxy vedle sebe. Více kusů do jednoho boxu má silnější rámeček a podtržení počtu.
- Barva celého `N ks → box X` je červená při R = `0,8` / `0.8`.
- Pár chybějících fotek není chyba. PDF se mají vytvořit i neúplná; VBA upozorní až při **více než 50 %** chybějících fotografických polí. Přesně polovina neupozorňuje.
- Poměr vychází ze skutečně vykreslených řádků i při `split`, podle `X-Warehouse-Missing-Images` a `X-Warehouse-Image-Rows`. Bez druhé hlavičky se poměr nehádá.
- HTML nabízí `Znovu načíst fotky`; zachovat načtené fotky i při neúspěšném opakování. Tento pokus neposílá zákaznické listy, pouze kódy.

## 7. Datový kontrakt a bezpečnost

Tiskový list, obvykle VYSKLADNI, se hledá podle hlaviček B1/D1/E1, ne podle aktivního listu. Více odpovídajících listů je chyba. Pomocné listy EXCEL a KOMPLETACE se nepovažují za tiskový list.

| Sloupec tiskového listu | Obsah |
| --- | --- |
| A | Kód/skupina produktu |
| B | Kód varianty |
| C | Varianta |
| D | Rozpis `1x3, 2x14` = 1 kus do boxu 3 a 2 do boxu 14 |
| E | Celkem kusů, musí souhlasit s rozpisem |
| F | Název produktu |

- `EXCEL`: hlavičky `Označení varianty:` a `Doplňkové info:` (v dříve ověřeném masteru C/J); značka v úvodním `//Gina//`. Rozporné/chybějící údaje vedou na obecné pravidlo.
- `KOMPLETACE`: L objednávka, O množství, Q box/expediční číslo, R kód pořadí. Respektovat hlavičky i pozice používané konkrétním parserem.
- Pomocné listy: obdélníkové `helperSheets.<list>.cells`, hodnoty jako řetězce. Posílat hodnoty, ne vzorce; chyba buňky má přerušit upload s uvedením místa.
- Zachovat úvodní nuly SKU/EAN/PSČ. V Excelu mají být identifikátory s nulami text, jinak je po převodu z čísla nelze spolehlivě obnovit.
- Limity samostatného tisku: 10 MB JSON, 1000 hlavních řádků; pomocný list nejvýše 10000 řádků/128 sloupců, celkem 200000 buněk.
- `POST /api/warehouse/render-print`: anonymní HTML ze zaslaných dat.
- `POST /api/warehouse/render-pdf?priority=normal|first|split`: anonymní PDF, bez parametru `split`; `X-Warehouse-Priority` potvrzuje režim.
- `POST /api/warehouse/print-images`: omezený čtecí endpoint pro odkazy fotek, podporuje CORS pro místní HTML, nepřenášet na ostatní API jeho volnější pravidla.
- `POST /api/warehouse/upload-print` a náhled podle dataset ID zůstávají jinou chráněnou cestou.
- Neodstraňovat autentizaci u ostatních endpointů kvůli potřebě anonymního samostatného tisku.
- Lokální HTML obsahuje i pomocná data včetně možných osobních údajů. To, že nejsou vidět v tabulce, neznamená, že nejsou v souboru. Nesdílet veřejně; `%TEMP%\ExpediceVyskladneni` se samo po tisku nemaže.
- PDF/tištěná sestava pomocné zákaznické tabulky neobsahují.
- PDF renderer přijímá pouze vlastní serverovou šablonu, ne libovolné HTML uživatele. Externí fotky dovoluje jen přes HTTPS z `cdn.myshoptet.com`, bez přesměrování mimo povolený zdroj.
- Fotky PDF se zmenšují do 400 × 400 px, JPEG kvalita 85. Výstup musí mít PDF signaturu, limit 32 MB. Neobcházet bezpečnostní omezení pro řešení chybějící fotografie.

## 8. Adobe, tiskárna a odlišnost od Sumatra/agentu

- Generování a tisk jsou dvě oddělené akce. Na skladu se tisknou již stažené soubory.
- Výchozí tiskárna se zjišťuje z Windows na počítači kolegyně. Nepřenášet napevno cestu k Adobe, jméno uživatele, tiskárnu ani port z Dominikova PC.
- Adobe se spouští přes `/n /s /h /t` do vlastní minimalizované instance. Sleduje se konkrétní nová úloha a PID/čas vzniku procesu.
- Po dokončení/předání konkrétní úlohy makro pošle běžný požadavek na zavření vlastní instance. Žádný plošný `taskkill Acrobat.exe`, zavírání cizích PDF nebo násilné ukončení.
- Kontrola přes `Application.OnTime` každé dvě sekundy. Sešit a Excel nechat otevřené, předchozí sledovaný tisk z tohoto sešitu musí doběhnout.
- Offline/chyba/pauza tiskárny zavření blokuje. Neidentifikovaná úloha se nepovažuje za hotovou; po 15 minutách upozornění. Neúspěšné zavření aplikace má vlastní limit 30 sekund.
- Zmizelá pozorovaná úloha může znamenat i zrušení. Není to důkaz fyzického vytištění listů.
- Ověřit reálně na cílovém Adobe/ovladači. Příkazové chování Adobe se může mezi verzemi lišit.
- Dřívější problém: PDF kolem 2 MB mohlo mít ve frontě stovky MB až cca 1 GB. Velikost PDF není velikost vykreslené tiskové úlohy, proto přechod na Adobe nebyl zárukou konkrétní úspory. Nepřidávat neověřený „zázračný“ přepínač Sumatra/Adobe.
- Při chybě zkontrolovat frontu před dalším tiskem, nevyvolávat automaticky druhou kopii.
- Excelový tisk skladových PDF nevyžaduje Print Agent V2. Ten ponechat pro jiné existující části systému.

## 9. Vývoj na čistém PC

Používané prostředí: Windows/PowerShell, Git, Node 22 pro CI, Python 3.11 pro CI, PostgreSQL 16. Produkční Docker používá Python 3.12. Pro VBA testy desktopový Excel; pro ruční tisk Adobe a skutečný ovladač tiskárny.

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
npm ci
npx playwright install chromium
.\.venv\Scripts\python.exe -m playwright install chromium
```

Node a Python Playwright mají v projektu odlišné verze (JS `^1.61.1`, Python `1.61.0`); instalace prohlížeče pro jednu knihovnu automaticky nezaručuje správnou binárku pro druhou. Nepřenášet `node_modules`/`.venv` mezi PC, obnovit je z manifestů.

Pro plnou webovou aplikaci připrav lokální PostgreSQL, nikoli produkční DB. Příklad s vlastním heslem:

```powershell
docker run --name expedice-postgres -e POSTGRES_DB=expedice_dev -e POSTGRES_USER=expedice -e POSTGRES_PASSWORD=VLASTNI_LOKALNI_HESLO -p 5432:5432 -d postgres:16
$env:DATABASE_URL = 'postgresql://expedice:VLASTNI_LOKALNI_HESLO@127.0.0.1:5432/expedice_dev'
$env:INITIAL_ADMIN_USERNAME = 'lokalni-admin'
$env:INITIAL_ADMIN_PASSWORD = 'VLASTNI_LOKALNI_ADMIN_HESLO'
$env:PORT = '8000'
.\.venv\Scripts\python.exe app.py
```

Otevři `http://127.0.0.1:8000`, zdraví kontroluj na `/api/health`. Pokud je port obsazený, zvol jiný. Bootstrap admina není nástroj pro přepis hesla existujícího účtu. `.env` je ignorovaný Gitem, ale samotná existence souboru nezaručuje jeho načtení; uvedené PowerShell proměnné platí v daném procesu/terminálu.

Jména důležitých nastavení bez tajných hodnot: `DATABASE_URL`, `INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_PASSWORD`, `UPLOAD_TOKEN`, `DOWNLOAD_TOKEN`, `PRODUCT_FEED_URL`, `MAPY_API_KEY`, platební feedy, přístupy Packeta/DPD. Přesný stav produkční konfigurace nebyl do handoffu exportován. Nikdy nekopírovat produkční hesla/tokeny do dokumentu, screenshotu nebo testovacího fixture.

## 10. Testy a skutečně ověřený stav

### Znovu spuštěno 26. 9. 2026

| Kontrola | Výsledek |
| --- | --- |
| `python -m pytest -q` | **105 passed, 6 skipped** |
| `npx playwright test tests/e2e/warehouse-print.spec.js` | **18 passed** |
| `git ls-remote origin refs/heads/master` | `6f8fe9c5396e037b822926bcb371b7f16cdb8cb2` před handoffem |
| Veřejný produkční `app.js` | HTTP 200, oba nové popisky „přes Zásilkovnu“ přítomné |
| Produkční `/api/health` | `ok=true`, `database=true` |

Šest přeskočených testů jsou opt-in testy skutečného PDF rendereru (`RUN_PDF_BROWSER_TESTS` nebylo nastaveno na `1`). Přeskočení samo nedokazuje, že Chromium není nainstalované. Celá E2E sada hlavní aplikace, nové testy v živém Excelu, skutečný tisk a GitHub Actions status nebyly v tomto předání znovu ověřeny. Testy používají testovací data, nebyl spuštěn produkční upload zákaznické várky ani fyzický tisk.

### Příkazy pro navázání

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npx playwright test tests/e2e/warehouse-print.spec.js
git diff --check
```

Pro reálný PDF renderer po instalaci Python Playwright Chromium:

```powershell
$env:RUN_PDF_BROWSER_TESTS = '1'
.\.venv\Scripts\python.exe -m pytest tests/test_warehouse_pdf.py -q
Remove-Item Env:RUN_PDF_BROWSER_TESTS
```

Případná `WAREHOUSE_PDF_CHROMIUM` dovoluje explicitní cestu k prohlížeči. Není nutné ji v běžné instalaci nastavovat.

Celá frontendová sada: `npm run test:e2e`. Playwright config používá lokální statický server na portu 8123 a API mocky; nevyžaduje kvůli každému tiskovému testu živou databázi. Report `playwright-report/`, výstupy `test-results/`, obojí ignorováno Gitem. Netestovat mutující scénáře proti produkci pomocí `EXPEDICE_TEST_URL`.

VBA testy, až bude k dispozici Excel a už povolený přístup k VBA projektu:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/vba/upload-railway.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests/vba/warehouse-adobe.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests/vba/warehouse-adobe-close.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests/vba/warehouse-print-browser.ps1
```

První tři používají nahrazené síťové/tiskové operace v izolovaném sešitu, nic skutečně neposílají ani netisknou. Browser test s volitelným `-ReportPath` může otevřít zvolený náhled. Před spuštěním přečíst skript a jeho parametry, nepovolovat globálně slabší zabezpečení Excelu bez uživatele.

## 11. Nasazení a poslední commity

Railway podle `railway.json` používá **Dockerfile**, nikoli jen historický Procfile. Docker instaluje Python Playwright i Chromium se systémovými závislostmi a spouští:

```text
gunicorn --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 4 --timeout 180 app:app
```

PDF generování je omezené na jeden souběžný render na proces. Nekopírovat slepě starý víceprocesový start ani měnit limity bez zátěžového ověření. Konfigurace Railway serverless je podle uživatele aktivní; aktuální nastavení dashboardu se při předání neměnilo ani neověřovalo.

| Commit | Změna |
| --- | --- |
| `6f8fe9c` | Zásilkovna explicitně i v názvech iVeronika.cz a iVeronika.sk; test příkladu rozsahů |
| `ea544f0` | Velké červené datum expedičního dne vpravo nahoře |
| `c556669` | Opravy CI Python prostředí a podmínky volitelného podepisování .NET agentu |
| `41393c2` | Upozornění na fotografie jen při chybějící většině |
| `1915067` | Zavření vlastní Adobe instance po sledované úloze |
| `696947d` | Minimalizovaný start Adobe bez aktivace domovské stránky |
| `c6cc68c` | Trvalý relativní výběr PDF pro kolegyni na jiném PC |
| `fbc681c` | PDF k denní kopii sešitu a datum expedičního dne |
| `b23543a` | Tichý upload Railway a probouzení serverless |
| `4707e61` | Historický mezikrok hlavičky s názvem složky, později zpřesněn na datum |
| `f22911a` | Dialogy jen pro chyby/neúplné sestavy, později zmírněno pro několik fotek |
| `b0ce9a6` | Tučné Arial kódy a netučné názvy v řádcích |

`.github/workflows/test.yml` testuje backend s PostgreSQL a frontend s Node/Chromium. `.github/workflows/print-agent-dotnet.yml` se spouští při relevantních změnách agentu/workflow nebo ručně; nepřítomnost nového agent buildu po pouhé změně hlavičky není chyba. Nové green CI nebo Railway deployment se nesmí odvozovat pouze z úspěšného `git push`.

## 12. Zastaralé pokyny, které neopakovat

- `README.md` stále obsahuje části původního MVP, aktivního listu, výchozího tisku na šířku, Procfile a obecné tvrzení o otevřeném API bez tokenů. Pro aktuální chování ověřovat kód a tento dokument, nezakládat bezpečnostní rozhodnutí jen na README.
- `vba/VyskladneniTisk.md` má vedle platného podrobného popisu i starší odstavce: výběr PDF pouze v paměti, nutnost po restartu znovu generovat, Adobe se nezavírá, hlavička z názvu složky a upozornění na každou fotku. Tyto odstavce jsou překonané.
- Aktuální je trvalé `posledni-sestava.xml`, bezpečné zavírání vlastní Adobe instance, datum vpravo a práh chybějících fotek nad 50 %. Podrobnosti v `docs/vyskladneni-pdf-expedicni-den.md` a implementaci.
- Výtisk nesmí začít už při generování podkladů u Dominika. Tisk spouští kolegyně samostatně.
- Cesty nikdy napevno na `C:\Users\Dominik...` v produkčních makrech. Cesty v tomto dokumentu jsou pouze identifikace původních lokálních souborů.

## 13. Vedlejší úkol: smaragdové varianty v Excelu

Dokončeno nezávisle na aplikaci, **není součástí Gitu**:

- Zdroj `C:\Users\Dominik Collider\Downloads\Sešit1.xlsx`: dámský komplet `152-Holland-Merino-Damske`.
- Zdroj `C:\Users\Dominik Collider\Downloads\Sešit2.xlsx`: pánský komplet `150-Holland-Merino-Panske`.
- Přidány smaragdové M/L/XL/XXL, SKU končí `-smaragdova`, barva `smaragdová`, popis `smaragdová / <velikost>`.
- Nová barva vždy **hned pod černou stejné velikosti**, ne souhrnně na konci souboru. Každý výstup má 16 řádků, původních 12 záznamů obsahově zachováno, ceny zachované.
- Fotoodkazy nových řádků jsou prázdné, Dominik si je doplní. Původní fotoodkazy zůstaly.
- Výstupy se jmenují `Sesit1-smaragdova.xlsx` a `Sesit2-smaragdova.xlsx`. Původní soubory v Downloads nebyly přepsány.
- Umístění výstupů na původním PC:
  `C:\Users\Dominik Collider\.codex\visualizations\2026\07\02\019f20b8-0926-7cd1-bd7e-0e3a12ecc336\outputs\emerald-20260924\`
- Na druhém PC se po klonování neobjeví. V případě pokračování je přenést samostatně, nepřidávat produktové soubory automaticky do veřejného repozitáře.

## 14. Co ještě zbývá a jak pokračovat bezpečně

1. **Přenos:** ověřit lokální dostupnost pracovního XLSM, správné verze obou VBA modulů a celé denní PDF/XML sady na druhém PC.
2. **Lokální změna Sumatra:** rozhodnout s uživatelem o neplatném rozdělení příkazu; v rámci předání nedotčeno. Pokud působí VBA Compile error, kontrolovat celý projekt, nejen nové makro.
3. **Reálný skladový tisk:** ověřit jedno PDF a následné zavření Adobe na skutečné tiskárně kolegyně, s jejím souhlasem. Mock test není důkaz fyzického tisku.
4. **Dokumentace:** užitečný samostatný další úkol je sjednotit zastaralé odstavce README a `vba/VyskladneniTisk.md` s aktuálním chováním. Tento handoff rozpory označuje, nepřepisuje historické návody hromadně.
5. **CI a integrace:** při větší změně spustit celou E2E sadu, opt-in PDF testy a zkontrolovat GitHub Actions/Railway. Přístupové údaje a aktuální konfiguraci ověřit na daném PC, nehádat je.

Před každou změnou číst `git status`, relevantní kód a existující testy. Zachovat české/slovenské znaky, přesné počty kusů a vazby boxů. Rozumné dokončené změny uživatel schválil commitovat a pushovat; do commitu přidávat jen konkrétní soubory vlastního úkolu. Vizuální úpravy ověřovat v prohlížeči. Po dokončení provést audit rozdílu a uvést skutečně provedené testy i jejich omezení.

### Krátké zadání pro dalšího asistenta

> Pracuji na projektu DominikCodex/expedice, větev master. Nejdřív přečti HANDOFF_EXPEDICE_2026-09-26.md a zkontroluj git status/log. Poslední aplikační změna 6f8fe9c doplnila Zásilkovnu do skladových skupin iVeronika.cz/sk a 26. 9. byly nové názvy ověřeny na produkci. Tiskové makro je vba/VyskladneniTisk.bas, společný databázový upload vba/ExpediceUploadJedenSkript.bas. Generování tří PDF, tisk přes Adobe a databázový upload jsou oddělené funkce. Zachovej relativní cesty a posledni-sestava.xml pro druhé PC, nevytvářej tlačítka, úspěch bez MsgBoxu. Starší dokumentace obsahuje překonané odstavce. Nedotýkej se cizích lokálních změn, zejména necommitnuté chyby v Sumatra modulu, bez vyjasnění. Navazuj podle mého dalšího zadání, nevytvářej automaticky nové úkoly ani nespouštěj skutečný tisk.
