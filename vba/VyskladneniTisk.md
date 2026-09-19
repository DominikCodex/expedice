# Samostatná makra Vyskladnění k tisku

Modul `VyskladneniTisk.bas` je samostatný. Existující makra pro roztřídění a kompletaci se neupravují.

## Jednorázové přidání do Excelu

1. Otevři pracovní sešit s makry (`.xlsm` nebo `.xlsb`) a stiskni `Alt+F11`.
2. Přes `File > Import File` importuj `VyskladneniTisk.bas` jako nový modul.
3. Vrať se do Excelu na libovolný list tohoto sešitu. Token ani přihlášení se nenastavují.
4. Pro ruční HTML náhled spusť přes `Alt+F8` makro `VyskladneniNahratATisk`, případně ho přiřaď vlastnímu tlačítku. Modul žádná tlačítka nevytváří ani nemění.
5. Ulož sešit ve formátu podporujícím makra. Původní `.xlsx` makra uchovat neumí.

### Aktualizace dříve přidaného tlačítka

Pro přidání pomocných listů `EXCEL` a `KOMPLETACE` přes `Alt+F11` otevři samostatný tiskový modul a nahraď jeho obsah aktuálním `VyskladneniTisk.bas`. Nevytvářej druhý modul se stejně pojmenovanými makry. Název `VyskladneniNahratATisk` zůstává stejný, takže přiřazení tlačítka není potřeba měnit. Ostatní moduly pro kompletaci a roztřídění ponech beze změny. Sešit ulož.

## Každodenní použití

### Dvě makra: vytvoření PDF a tisk přes Adobe

Původní `VyskladneniNahratATisk` zůstává pro ruční HTML náhled a tisk z prohlížeče. PDF workflow má nyní dvě oddělená makra, bez závislosti na Sumatře či tiskovém agentovi:

- `VyskladneniPdfVygenerovat`: odešle stejné listy, vygeneruje PDF na serveru, uloží jej a otevře v prohlížeči k náhledu. **Nic netiskne.** Server použije výchozí sestavu: produkt a varianta, A4 na výšku, kompaktní, prioritní kusy zvlášť na oddělených stránkách.
- `VyskladneniPdfVytisknoutAdobe`: použije PDF naposledy vytvořené tímto sešitem v aktuální relaci Excelu. Po restartu Excelu, resetu VBA nebo při chybějícím souboru nabídne výběr PDF. Nevybírá automaticky nejnovější soubor ve společné složce. Před předáním Adobe vyžádá potvrzení konkrétního souboru a výchozí tiskárny Windows.

1. Aktualizuj pouze obsah modulu `VyskladneniTisk.bas`, bez vytvoření duplicitního modulu.
2. Vlastním tlačítkům přiřaď `VyskladneniPdfVygenerovat` a `VyskladneniPdfVytisknoutAdobe`, nebo je spouštěj přes `Alt+F8`. Obě makra fungují z libovolného listu sešitu s makrem. Tlačítka se automaticky nevytvářejí ani neupravují.
3. Starší název `VyskladneniPdfATisk` zůstává kvůli existujícím přiřazením, ale nyní **jen generuje a otevírá PDF**. Modul `ExpediceTiskPresSumatra.bas` tento postup už nepoužívá.

Cesty nejsou vázané na konkrétního uživatele: PDF se ukládá do `VyskladneniPDF` vedle sešitu, včetně síťové složky. Sešit musí být uložený v místní nebo sdílené složce s právem zápisu, nikoli otevřený pouze přes webovou URL. Adobe se hledá podle registrace Acrobat/Reader a instalačních složek daného počítače. Výchozí tiskárna, ovladač a port se načtou z Windows až při požadavku na tisk. Nastavení tiskárny se nemění.

Adobe používáme příkazem `/t` s cestou PDF, názvem tiskárny, ovladačem a portem. Adobe jej popisuje, ale oficiálně negarantuje jeho podporu ve všech verzích: [Adobe SDK FAQ](https://opensource.adobe.com/dc-acrobat-sdk-docs/library/overview/apxDevFAQ.html#how-do-i-use-the-windows-command-line). Makro proto potvrzuje jen předání požadavku aplikaci, nikoli dokončený tisk. Adobe automaticky neukončujeme, nevypínáme jeho ochrany a nepřepínáme na jiný tiskový nástroj při chybě. Před opakováním zkontroluj frontu, aby nevznikly duplicitní kopie. Menší tisková úloha je možnost k ověření, nikoli záruka.

PDF zůstává uložené i po chybě otevření či tisku. Makro kontroluje typ a signaturu staženého souboru a před tiskem také existenci, příponu a velikost vybraného PDF (nejvýše 32 MB). Neúspěšný nový pokus o generování ruší zapamatovaný odkaz na předchozí várku. Nedostupné fotografie neblokují vytvoření PDF; jejich počet se ukáže po otevření náhledu. Fotografie se pro PDF zmenšují na nejvýše 400 pixelů na delší straně. Pro ruční opakování načtení fotek použij původní HTML náhled.

Server potřebuje Chromium z instalace Playwright; připravuje jej přiložený Dockerfile. Generátor spouští pouze vlastní tiskovou šablonu a dovoluje externě načítat pouze obrázky z HTTPS `cdn.myshoptet.com`. Ostatní zdroje z bezpečnostních důvodů přeskočí. Současně vytváří nejvýše jedno PDF na proces; při obsazení vrátí pokyn zkusit generování později.

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

Sestava nabízí řazení podle produktu a varianty, původní pořadí Excelu nebo první cílový box. Přepínač `Na šířku / Na výšku` upraví náhled i orientaci papíru A4. Výchozí nastavení je `Produkt a varianta`, `Na výšku`, `Kompaktní` a `Prioritní kusy zvlášť`. Tiskové tlačítko otevře běžné tiskové okno pro zvolenou orientaci. Hlavička tabulky se opakuje na dalších stranách a řádky se nerozdělují mezi stránky. Sloupec `Hotovo` byl odstraněn a jeho šířku využívá `Kolik a kam do boxů`; běžné jednociferné počty s dvoucifernými čísly boxů se vejdou nejméně po třech vedle sebe i na výšku. Nový vzhled získáš opětovným vygenerováním sestavy z Excelu, bez změny makra; starší místní HTML se samo neaktualizuje.

Fotografie se dohledávají z nakonfigurovaného produktového feedu podle kódu varianty nebo produktu. Tiskové tlačítko čeká na načtení obrázků. Chybějící fotografie jsou viditelně označené.

Při dočasném výpadku databáze s nastavením fotografií server použije poslední úspěšně načtený seznam z paměti. Pokud jej po startu ještě nemá, načtení nastavení zopakuje po 1, 2 a 4 sekundách. Když zdroj fotografií přesto nelze načíst, sestava se otevře s upozorněním a lze ji vytisknout i bez fotek. Tlačítko `Znovu načíst fotky` zkusí znovu získat odkazy ze serveru a načíst obrázky bez přihlášení i z místního HTML. Posílá pouze kódy produktů, nikoli pomocné listy ani zákaznické údaje. Neúspěšný pokus zachová dříve načtené odkazy a možnost tisku. Běžné `Načíst znovu` používá data daného HTML v paměti. Makro není potřeba měnit; pro nové tlačítko je nutné starší sestavu jednou vygenerovat z Excelu znovu.

Na začátku sestavy je jednorázový `Souhrn expedice z Excelu`: počet objednávek z KOMPLETACE (L), celkový počet kusů (O), počet skladových objednávek s kódem pod 2 (R) a skladové kusy z právě odeslané tabulky vyskladnění. Poslední hodnota zahrnuje také skladové kusy smíšených objednávek. Není to živý report databázového dne. Pod souhrnem jsou souvislé rozsahy boxů Q podle kódu R, s výchozími názvy způsobů expedice; kód 0,8 je červený. Mezery v číslování nebo změny kódu rozsah rozdělí. Osobní údaje ani technické kódy se nevypisují. Používají se výchozí názvy aplikace, nikoli úpravy z databázového Nastavení, aby tisk zůstal nezávislý na databázi.

Údaje o serverové kontrole adres a plateb nejsou součástí tohoto souhrnu, protože je odesílané listy neobsahují. Chybějící množství nebo neznámé kódy se neodhadují; nedostupný součet zobrazí pomlčku a upozornění. Duplicitní boxy se do rozsahů nezařadí a zobrazí se upozornění. U starého exportu bez rozpoznané KOMPLETACE se souhrn vynechá. Přepnutí priorit, orientace ani hustoty souhrn nepřepočítává z rozdělených tiskových řádků. Stačí sestavu znovu vygenerovat stávajícím makrem, které posílá pomocné listy.

Pátý údaj `Prioritní kusy` sčítá pouze kusy vyskladnění určené do červených boxů s kódem `0,8` v KOMPLETACI. Zahrnuje i II. jakost; ze smíšené varianty započítá jen prioritní část. Vychází z původního rozdělení kusů, takže přepínače řazení a priorit celkový údaj nemění. Opakovaný box v pomocném listu nezapočítá kusy dvakrát.

Každý souvislý produktový blok má rámeček ze všech stran; bloky s více variantami mají společný výrazný nadpis s názvem produktu. Název a úplný kód zůstávají i u jednotlivých variant, aby byly čitelné při pokračování na další straně. Dlouhé bloky se mohou rozdělit mezi stránky, jednotlivé položky nikoli; nadpis se drží u následujícího řádku. II. jakost má na každém řádku vlastní orámované označení. Rozdělení více než jednoho kusu do stejného boxu má silnější rámeček a podtržený počet. Červená zůstává pouze pro prioritní boxy; ostatní zvýraznění je čitelné i černobíle.

Pod nadpisem produktu s více variantami je vedle kódu a počtu variant také tučný součet `Celkem N ks`. Zahrnuje jen řádky daného vypsaného bloku. V režimu `Prioritní kusy zvlášť` se prioritní a ostatní kusy sčítají odděleně; II. jakost má vlastní součet. Celkový počet kusů celé sestavy se nemění.

Řazení `Produkt a varianta` uvnitř produktu používá velikost a potom barvu: například `S/M`, `M/L`, `L/XL`, `XL/XXL`, `XXL/3XL`. Číselné velikosti se řadí numericky ve vlastní skupině za písmennými, poté `UNI` a neznámé velikosti. Není prováděn odhad ekvivalence číselných a písmenných velikostí. Řazení podle Excelu či prvního boxu se tím nemění. Prioritní režim navíc pojmenovává bloky `PRIORITNÍ`, `PRIORITNÍ – II. JAKOST`, `OSTATNÍ` a `OSTATNÍ – II. JAKOST`; prázdné bloky se nevypisují. Bez prioritního režimu se při řazení podle produktu odděluje běžné zboží a II. jakost.

Volba `Běžné pořadí` ponechává původní řazení bez přednosti priorit. Volba `Prioritní zásilky první` řadí celé řádky do čtyř skupin: běžné zboží s alespoň jedním červeným boxem, II. jakost s červeným boxem, ostatní běžné zboží a ostatní II. jakost. Všechny prioritní řádky jsou tak pohromadě na začátku. Uvnitř skupin platí vybrané řazení (produkt, Excel nebo box). Smíšený řádek se přesune celý, včetně neprioritních boxů; počty kusů se nemění. Přepínač funguje v obou orientacích i kompaktním režimu a nevyžaduje změnu makra.

Třetí volba `Prioritní kusy zvlášť` rozdělí smíšenou variantu na dva tiskové řádky: nejprve pouze červené boxy s jejich součtem kusů, později ostatní boxy s jejich součtem. Například 2 kusy do prioritního boxu 7 a 3 kusy do boxu 20 se zobrazí jako řádky se 2 a 3 kusy, nikoli dvakrát s původními 5 kusy. Pořadí bloků je `PRIORITNÍ KUSY`, `PRIORITNÍ KUSY – II. JAKOST`, `OSTATNÍ KUSY`, `OSTATNÍ KUSY – II. JAKOST`. Při tisku začínají ostatní kusy na nové stránce za všemi prioritními kusy včetně prioritní II. jakosti. Samotná změna jakosti novou stránku nevynucuje. Prázdné bloky se nezobrazují; pokud jedna z obou skupin chybí, nepřidává se žádné nucené zalomení. V náhledu na obrazovce zůstává tabulka souvislá a ostatní režimy řazení se nemění. Řazení podle prvního boxu používá pouze boxy příslušné části. Celkový počet kusů zůstává původní; návrat do jiného režimu obnoví nerozdělené řádky. Bez prioritních boxů se žádný řádek nerozděluje. Stačí nově vygenerovat sestavu z Excelu, makro se nemění.

Přepínač `Běžné / Kompaktní` funguje v obou orientacích. Kompaktní režim zmenší fotografie, mezery a podpůrné texty, aby se vešlo více řádků na stránku. Počty kusů a hodnoty variant zůstávají tučné, žádné položky ani údaje se neskrývají. Výchozí je kompaktní zobrazení. Ani tato volba nevyžaduje změnu Excel makra.

Makro spouští webový prohlížeč podle nastavení odkazů HTTPS, nikoli aplikaci přiřazenou souborům `.html` (například PSPad). Pokud ho nelze dohledat, zkusí nainstalovaný Chrome, Edge nebo Firefox. Nastavení Windows se nemění. Při chybě otevření ukáže cestu k hotovému souboru. Již vytvořenou sestavu lze také otevřít v prohlížeči přes `Ctrl+O` ze složky `%TEMP%\ExpediceVyskladneni`.

Generování tiskové sestavy nevytváří žádnou databázovou dávku. Nemění ani nenahrazuje dávky roztřídění, kompletace nebo interaktivního vyskladnění, neovlivňuje report dne a nespouští jejich automatické kontroly. Tisk zahrnuje všechny původní kusy z Excelu.

## Pomocné listy pouze pro tisk

Oba listy se odešlou ve stejném požadavku jako vyskladnění. Přenášejí se hodnoty buněk od A1 po poslední použitý řádek a sloupec, včetně hlaviček a prázdných pozic uvnitř tabulky. Vzorce se neposílají, pouze jejich aktuální výsledky. Číselné buňky se přenášejí jako podkladové hodnoty bez formátování (datum jako sériové číslo Excelu); kódy s úvodními nulami musí být uložené jako text. Chyba vzorce přeruší odeslání a uvede list a buňku. Každý list má limit 10000 řádků a 128 sloupců, dohromady nejvýše 200000 buněk. Celý požadavek má limit 10 MB (10485760 bajtů), kontrolovaný před odesláním i na serveru. Pro využití vyššího limitu je potřeba aktualizovat modul `VyskladneniTisk.bas`; starší makro nadále odmítá požadavky nad 2 MB.

Server pomocné listy validuje a vloží do datové části výsledného HTML. Nezobrazují se v tabulce ani v tisku a nezapisují se do databáze. Toto je přenos dat pro samostatný tisk, nikoli import kompletace nebo roztřídění.

Pro seskupení produktů tisk páruje úplný kód varianty z vyskladnění se sloupcem `Označení varianty:` v listu `EXCEL` (v ověřeném master sešitu sloupec C). Značku čte z úvodního označení `//Gina//` ve sloupci `Doplňkové info:` (J); sloupce hledá podle hlaviček. Párování ignoruje velikost písmen a okolní mezery, ale zachovává úvodní nuly. Opakované řádky stejné varianty musí mít shodnou značku. Chybějící nebo rozporné údaje, neznámé hlavičky a sestavy bez pomocného listu používají obecné pravidlo, nikoli odhad značky podle názvu nebo číselného kódu.

Skupina pro řazení podle produktu a pro silnou oddělovací čáru se odvozuje z kódu varianty: Gina před první pomlčkou (`03019-MBH-XLXXL-UPE` → `03019`), výjimka `BOXERKY-BASIC` před třetí (`BOXERKY-BASIC-021-LXL-CERNA` → `BOXERKY-BASIC-021`), ostatní před druhou (`GBTW-3109-SM-CERNA` → `GBTW-3109`). Kratší kód se ponechá celý. Celé kódy zůstávají viditelné a používají se pro fotografie; řádky, kusy ani boxy se neslučují. Priority a jakost mají nadále přednost před seskupením. Řazení podle Excelu a prvního boxu se nemění, čára vždy označuje přechod mezi skupinami v aktuálním pořadí. Stačí nově vygenerovat sestavu makrem, které již odesílá pomocné listy; nová změna makra není potřeba.

Z listu `KOMPLETACE` tisk používá sloupec Q (číslo boxu) a R (kód pořadí expedice). U boxů s kódem `0,8` nebo `0.8` je celý text rozdělení kusů červený, například `1 ks → box 7`, v náhledu i při barevném tisku. Ostatní boxy zůstávají beze změny. Sestavy bez tohoto pomocného listu nemají červené zvýraznění. Pro změnu vzhledu stačí sestavu znovu vygenerovat poslední verzí makra, která již pomocné listy odesílá.

**Soukromí:** výsledný soubor HTML obsahuje i neveřejná data pomocných listů, včetně případných kontaktů zákazníků. Skrytí v tiskovém náhledu není šifrování. Soubor nesdílej veřejně; uložené sestavy zůstávají v `%TEMP%\ExpediceVyskladneni` až do odstranění. Vytištěný dokument ani PDF tyto pomocné tabulky neobsahují.

## Technické rozhraní

- `POST /api/warehouse/render-print` přijímá vlastní řádky v JSON a vrací hotové HTML bez autentizace. Limit je 10 MB a 1000 řádků; množství musí odpovídat součtu rozdělení do boxů.
- Volitelný objekt `helperSheets` obsahuje klíče `EXCEL` a `KOMPLETACE`, každý s obdélníkovým polem `cells` (řádky a sloupce, všechny hodnoty jako řetězce). Starší makro bez pomocných listů zůstává na serveru podporované.
- Z existujících dat používá pouze produktové fotografie k zaslaným kódům. Nelze jím načíst existující expediční dávku podle ID.
- `POST /api/warehouse/print-images` vrací pouze veřejné URL fotografií pro zaslané kódy (nejvýše 2000 kódů a 256 KiB). Jen tento čtecí endpoint povoluje CORS bez cookies pro sestavy otevřené z disku; ostatní chráněná API zůstávají beze změny.
- VBA zapíše odpověď binárně přes `ADODB.Stream`, aby zachovalo UTF-8.
- Starší `POST /api/warehouse/upload-print` a `warehouse-print.html?dataset=<id>` zůstávají chráněné a podporované, nové samostatné tlačítko je nepoužívá.
- Česko-slovenské znaky odesílá VBA jako JSON Unicode escape sekvence, takže nezávisí na kódové stránce editoru VBA.

## Vývojářská kontrola otevření prohlížeče

`tests/vba/warehouse-print-browser.ps1` kompiluje skutečný VBA modul v nové instanci Excelu a prázdném neukládaném sešitu. Ověří čtení příkazu prohlížeče, nalezení prohlížeče a chybu při neexistujícím souboru. Volitelný parametr `-ReportPath` otevře již existující sestavu. Test nenahrává žádná data. Vyžaduje Excel a již povolený přístup k VBA projektu; nastavení zabezpečení test sám nemění.
