# Samostatné tlačítko Vyskladnění k tisku

Modul `VyskladneniTisk.bas` je samostatný. Existující makra pro roztřídění a kompletaci se neupravují.

## Jednorázové přidání do Excelu

1. Otevři pracovní sešit s makry (`.xlsm` nebo `.xlsb`) a stiskni `Alt+F11`.
2. Přes `File > Import File` importuj `VyskladneniTisk.bas` jako nový modul.
3. Vrať se do Excelu a otevři list s tabulkou vyskladnění. Token ani přihlášení se nenastavují.
4. Přes `Alt+F8` jednou spusť `VlozitTlacitkoVyskladneniTisk`. V oblasti H2 vznikne samostatné tlačítko. Případně svému vlastnímu tlačítku přiřaď makro `VyskladneniNahratATisk`.
5. Ulož sešit ve formátu podporujícím makra. Původní `.xlsx` makra uchovat neumí.

### Aktualizace dříve přidaného tlačítka

Pokud už tlačítko existuje a hlásí HTTP 401, přes `Alt+F11` otevři jeho samostatný modul a nahraď jeho obsah aktuálním `VyskladneniTisk.bas`. Nevytvářej druhý modul se stejně pojmenovanými makry. Název `VyskladneniNahratATisk` zůstává stejný, takže přiřazení tlačítka není potřeba měnit. Ostatní moduly pro kompletaci a roztřídění ponech beze změny. Sešit ulož.

## Každodenní použití

Na aktivním listu musí být od druhého řádku tabulka:

| Sloupec | Obsah |
| --- | --- |
| A | Skupina / kód produktu |
| B | Kód varianty |
| C | Popis varianty |
| D | Kolik a kam s tím, například `1x3, 2x14` |
| E | Celkový počet kusů |
| F | Název produktu |

Kliknutí na nové tlačítko odešle data a otevře v běžném prohlížeči právě tuto tiskovou sestavu, bez přihlášení a bez upload tokenu. Datum sestavy je dnešní den podle počítače. Hotové HTML se uloží do `%TEMP%\ExpediceVyskladneni` a otevře z disku. Data, styly a skript jsou součástí souboru; fotografie se načítají z jejich původních webových adres, a proto pro ně zůstává potřeba internet. Soubory v této dočasné složce lze později odstranit.

Sestava nabízí řazení podle produktu a varianty, původní pořadí Excelu nebo první cílový box. Tlačítko `Tisk A4 na šířku` otevře běžné tiskové okno s formátem A4 na šířku. Hlavička tabulky se opakuje na dalších stranách, řádky se nerozdělují mezi stránky a na papíře je místo pro ruční odškrtnutí.

Fotografie se dohledávají z nakonfigurovaného produktového feedu podle kódu varianty nebo produktu. Tiskové tlačítko čeká na načtení obrázků. Chybějící fotografie jsou viditelně označené.

Generování tiskové sestavy nevytváří žádnou databázovou dávku. Nemění ani nenahrazuje dávky roztřídění, kompletace nebo interaktivního vyskladnění, neovlivňuje report dne a nespouští jejich automatické kontroly. Tisk zahrnuje všechny původní kusy z Excelu.

## Technické rozhraní

- `POST /api/warehouse/render-print` přijímá vlastní řádky v JSON a vrací hotové HTML bez autentizace. Limit je 2 MB a 1000 řádků; množství musí odpovídat součtu rozdělení do boxů.
- Z existujících dat používá pouze produktové fotografie k zaslaným kódům. Nelze jím načíst existující expediční dávku podle ID.
- VBA zapíše odpověď binárně přes `ADODB.Stream`, aby zachovalo UTF-8.
- Starší `POST /api/warehouse/upload-print` a `warehouse-print.html?dataset=<id>` zůstávají chráněné a podporované, nové samostatné tlačítko je nepoužívá.
- Česko-slovenské znaky odesílá VBA jako JSON Unicode escape sekvence, takže nezávisí na kódové stránce editoru VBA.
