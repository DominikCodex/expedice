# Samostatné tlačítko Vyskladnění k tisku

Modul `VyskladneniTisk.bas` je samostatný. Existující makra pro roztřídění a kompletaci se neupravují.

## Jednorázové přidání do Excelu

1. Otevři pracovní sešit s makry (`.xlsm` nebo `.xlsb`) a stiskni `Alt+F11`.
2. Přes `File > Import File` importuj `VyskladneniTisk.bas` jako nový modul.
3. V novém modulu nastav `WHPRINT_UPLOAD_TOKEN` na stejný upload token jako u stávajícího odesílání na server. Token patří pouze do lokálního sešitu, ne do Gitu.
4. Vrať se do Excelu a otevři list s tabulkou vyskladnění.
5. Přes `Alt+F8` jednou spusť `VlozitTlacitkoVyskladneniTisk`. V oblasti H2 vznikne samostatné tlačítko. Případně svému vlastnímu tlačítku přiřaď makro `VyskladneniNahratATisk`.
6. Ulož sešit ve formátu podporujícím makra. Původní `.xlsx` makra uchovat neumí.

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

Kliknutí na nové tlačítko odešle data a otevře v běžném prohlížeči právě tuto tiskovou sestavu. Datum sestavy je dnešní den podle počítače. Přihlášení v prohlížeči zůstává stejné jako v expediční aplikaci.

Sestava nabízí řazení podle produktu a varianty, původní pořadí Excelu nebo první cílový box. Tlačítko `Tisk A4 na šířku` otevře běžné tiskové okno s formátem A4 na šířku. Hlavička tabulky se opakuje na dalších stranách, řádky se nerozdělují mezi stránky a na papíře je místo pro ruční odškrtnutí.

Fotografie se dohledávají z nakonfigurovaného produktového feedu podle kódu varianty nebo produktu. Tiskové tlačítko čeká na načtení obrázků. Chybějící fotografie jsou viditelně označené.

Každý upload vytvoří vlastní dávku typu `warehouse_print` bez vazby na expediční den. Nemění ani nenahrazuje dávky roztřídění, kompletace nebo interaktivního vyskladnění, neovlivňuje report dne a nespouští jejich automatické kontroly. Tisk zahrnuje všechny původní kusy z Excelu.

## Technické rozhraní

- `POST /api/warehouse/upload-print` přijímá JSON a vyžaduje upload token nebo admin přihlášení.
- Odpověď obsahuje `printPath` a hlavičku `X-Warehouse-Print-Path` s odkazem na konkrétní sestavu.
- `warehouse-print.html?dataset=<id>` načte uloženou dávku a fotografie přes přihlášenou relaci prohlížeče.
- Česko-slovenské znaky odesílá VBA jako JSON Unicode escape sekvence, takže nezávisí na kódové stránce editoru VBA.
