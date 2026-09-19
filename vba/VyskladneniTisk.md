# Samostatné tlačítko Vyskladnění k tisku

Modul `VyskladneniTisk.bas` je samostatný. Existující makra pro roztřídění a kompletaci se neupravují.

## Jednorázové přidání do Excelu

1. Otevři pracovní sešit s makry (`.xlsm` nebo `.xlsb`) a stiskni `Alt+F11`.
2. Přes `File > Import File` importuj `VyskladneniTisk.bas` jako nový modul.
3. Vrať se do Excelu a otevři libovolný list tohoto sešitu, kam chceš vložit tiskové tlačítko. Token ani přihlášení se nenastavují.
4. Přes `Alt+F8` jednou spusť `VlozitTlacitkoVyskladneniTisk`. V oblasti H2 vznikne samostatné tlačítko. Případně svému vlastnímu tlačítku přiřaď makro `VyskladneniNahratATisk`.
5. Ulož sešit ve formátu podporujícím makra. Původní `.xlsx` makra uchovat neumí.

### Aktualizace dříve přidaného tlačítka

Pro přidání pomocných listů `EXCEL` a `KOMPLETACE` přes `Alt+F11` otevři samostatný tiskový modul a nahraď jeho obsah aktuálním `VyskladneniTisk.bas`. Nevytvářej druhý modul se stejně pojmenovanými makry. Název `VyskladneniNahratATisk` zůstává stejný, takže přiřazení tlačítka není potřeba měnit. Ostatní moduly pro kompletaci a roztřídění ponech beze změny. Sešit ulož.

## Každodenní použití

Ve stejném sešitu musí být neprázdné pomocné listy pojmenované `EXCEL` a `KOMPLETACE`. Makro je čte automaticky, není potřeba na ně přepínat. Pokud některý chybí, nic neodešle a vypíše jeho název.

Makro lze spustit z kteréhokoli listu. Vyskladnění si najde podle hlaviček B1 (`variant`), D1 (`kam`) a E1 (`Celk`), bez ohledu na název listu. Prohledává pouze sešit, ve kterém je tiskové makro uložené; nepřepíná aktivní list a funguje i se skrytým listem vyskladnění. Listy `EXCEL` a `KOMPLETACE` jsou vždy jen pomocné. Pokud tiskovou tabulku nenajde nebo najde více odpovídajících listů, nic neodešle a vypíše chybu (u více listů jejich názvy).

Na nalezeném listu musí být od druhého řádku tabulka:

| Sloupec | Obsah |
| --- | --- |
| A | Skupina / kód produktu |
| B | Kód varianty |
| C | Popis varianty |
| D | Kolik a kam s tím, například `1x3, 2x14` |
| E | Celkový počet kusů |
| F | Název produktu |

Kliknutí na nové tlačítko odešle data a otevře v běžném prohlížeči právě tuto tiskovou sestavu, bez přihlášení a bez upload tokenu. Datum sestavy je dnešní den podle počítače. Hotové HTML se uloží do `%TEMP%\ExpediceVyskladneni` a otevře z disku. Data, styly a skript jsou součástí souboru; fotografie se načítají z jejich původních webových adres, a proto pro ně zůstává potřeba internet. Soubory v této dočasné složce lze později odstranit.

Sestava nabízí řazení podle produktu a varianty, původní pořadí Excelu nebo první cílový box. Přepínač `Na šířku / Na výšku` upraví náhled i orientaci papíru A4. Výchozí je na šířku. Tiskové tlačítko otevře běžné tiskové okno pro zvolenou orientaci. Hlavička tabulky se opakuje na dalších stranách a řádky se nerozdělují mezi stránky. Sloupec `Hotovo` byl odstraněn a jeho šířku využívá `Kolik a kam do boxů`; běžné jednociferné počty s dvoucifernými čísly boxů se vejdou nejméně po třech vedle sebe i na výšku. Nový vzhled získáš opětovným vygenerováním sestavy z Excelu, bez změny makra; starší místní HTML se samo neaktualizuje.

Fotografie se dohledávají z nakonfigurovaného produktového feedu podle kódu varianty nebo produktu. Tiskové tlačítko čeká na načtení obrázků. Chybějící fotografie jsou viditelně označené.

Přepínač `Běžné pořadí / Prioritní zásilky první` ponechává výchozí dosavadní řazení. Prioritní režim řadí celé řádky do čtyř skupin: běžné zboží s alespoň jedním červeným boxem, II. jakost s červeným boxem, ostatní běžné zboží a ostatní II. jakost. Všechny prioritní řádky jsou tak pohromadě na začátku. Uvnitř skupin platí vybrané řazení (produkt, Excel nebo box). Smíšený řádek se přesune celý, včetně neprioritních boxů; počty kusů se nemění. Přepínač funguje v obou orientacích i kompaktním režimu a nevyžaduje změnu makra.

Přepínač `Běžné / Kompaktní` funguje v obou orientacích. Kompaktní režim zmenší fotografie, mezery a podpůrné texty, aby se vešlo více řádků na stránku. Počty kusů a hodnoty variant zůstávají tučné, žádné položky ani údaje se neskrývají. Výchozí zůstává běžné zobrazení. Ani tato volba nevyžaduje změnu Excel makra.

Makro spouští webový prohlížeč podle nastavení odkazů HTTPS, nikoli aplikaci přiřazenou souborům `.html` (například PSPad). Pokud ho nelze dohledat, zkusí nainstalovaný Chrome, Edge nebo Firefox. Nastavení Windows se nemění. Při chybě otevření ukáže cestu k hotovému souboru. Již vytvořenou sestavu lze také otevřít v prohlížeči přes `Ctrl+O` ze složky `%TEMP%\ExpediceVyskladneni`.

Generování tiskové sestavy nevytváří žádnou databázovou dávku. Nemění ani nenahrazuje dávky roztřídění, kompletace nebo interaktivního vyskladnění, neovlivňuje report dne a nespouští jejich automatické kontroly. Tisk zahrnuje všechny původní kusy z Excelu.

## Pomocné listy pouze pro tisk

Oba listy se odešlou ve stejném požadavku jako vyskladnění. Přenášejí se hodnoty buněk od A1 po poslední použitý řádek a sloupec, včetně hlaviček a prázdných pozic uvnitř tabulky. Vzorce se neposílají, pouze jejich aktuální výsledky. Číselné buňky se přenášejí jako podkladové hodnoty bez formátování (datum jako sériové číslo Excelu); kódy s úvodními nulami musí být uložené jako text. Chyba vzorce přeruší odeslání a uvede list a buňku. Každý list má limit 10000 řádků a 128 sloupců, dohromady nejvýše 200000 buněk. Celý požadavek má stále limit 2 MB, kontrolovaný před odesláním i na serveru.

Server pomocné listy validuje a vloží do datové části výsledného HTML. Nezobrazují se v tabulce ani v tisku a nezapisují se do databáze. Toto je přenos dat pro samostatný tisk, nikoli import kompletace nebo roztřídění. Automatické párování produktů z listu `EXCEL` zatím není zapojené; vyžaduje ověřit jeho skutečnou strukturu.

Z listu `KOMPLETACE` tisk používá sloupec Q (číslo boxu) a R (kód pořadí expedice). U boxů s kódem `0,8` nebo `0.8` je celý text rozdělení kusů červený, například `1 ks → box 7`, v náhledu i při barevném tisku. Ostatní boxy zůstávají beze změny. Sestavy bez tohoto pomocného listu nemají červené zvýraznění. Pro změnu vzhledu stačí sestavu znovu vygenerovat poslední verzí makra, která již pomocné listy odesílá.

**Soukromí:** výsledný soubor HTML obsahuje i neveřejná data pomocných listů, včetně případných kontaktů zákazníků. Skrytí v tiskovém náhledu není šifrování. Soubor nesdílej veřejně; uložené sestavy zůstávají v `%TEMP%\ExpediceVyskladneni` až do odstranění. Vytištěný dokument ani PDF tyto pomocné tabulky neobsahují.

## Technické rozhraní

- `POST /api/warehouse/render-print` přijímá vlastní řádky v JSON a vrací hotové HTML bez autentizace. Limit je 2 MB a 1000 řádků; množství musí odpovídat součtu rozdělení do boxů.
- Volitelný objekt `helperSheets` obsahuje klíče `EXCEL` a `KOMPLETACE`, každý s obdélníkovým polem `cells` (řádky a sloupce, všechny hodnoty jako řetězce). Starší makro bez pomocných listů zůstává na serveru podporované.
- Z existujících dat používá pouze produktové fotografie k zaslaným kódům. Nelze jím načíst existující expediční dávku podle ID.
- VBA zapíše odpověď binárně přes `ADODB.Stream`, aby zachovalo UTF-8.
- Starší `POST /api/warehouse/upload-print` a `warehouse-print.html?dataset=<id>` zůstávají chráněné a podporované, nové samostatné tlačítko je nepoužívá.
- Česko-slovenské znaky odesílá VBA jako JSON Unicode escape sekvence, takže nezávisí na kódové stránce editoru VBA.

## Vývojářská kontrola otevření prohlížeče

`tests/vba/warehouse-print-browser.ps1` kompiluje skutečný VBA modul v nové instanci Excelu a prázdném neukládaném sešitu. Ověří čtení příkazu prohlížeče, nalezení prohlížeče a chybu při neexistujícím souboru. Volitelný parametr `-ReportPath` otevře již existující sestavu. Test nenahrává žádná data. Vyžaduje Excel a již povolený přístup k VBA projektu; nastavení zabezpečení test sám nemění.
