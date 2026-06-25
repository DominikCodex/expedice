# Handoff pro novy chat: Expedice Excel / online expedicni system

Datum handoffu: 25. 6. 2026
Repozitar: DominikCodex/expedice
Produkce: https://expedice-production.up.railway.app

## 1. Co je cilem projektu

Cilem je postupne nahradit rozsahly Excel/VBA system pro sklad, roztrideni zbozi, kompletaci objednavek a expedici online aplikaci bezici na Railway s PostgreSQL databazi.

Soucasny Excel stale zustava prechodne dulezity hlavne jako zdroj dat:

- list `EXCEL` pro roztrideni zbozi,
- list `KOMPLETACE` pro expedicni objednavky,
- ruzne pomocne listy a makra v master souboru,
- VBA upload skript posila data na server.

Online aplikace ma byt skladovy cockpit pro kolegyne:

- nacist expediční box cteckou,
- okamzite videt objednavku, platbu, dopravce, adresu, poznamku a polozky,
- tisknout stitky a kontrolni papiry,
- hlidat storna, nezaplacene objednavky, chyby adres a chyby roztrideni.

## 2. Dulezite soubory v projektu

Hlavni soubory:

- `app.py` - Flask backend, API, databazova logika, importy, dopravci, platby, adresy, auth.
- `index.html` - hlavni aplikace.
- `app.js` - vetsina frontend logiky, renderovani, workflow kompletace, roztřideni, tisk, filtry.
- `styles.css` - vzhled aplikace.
- `print-agent.html` - stranka pro instalaci lokalniho tiskoveho agenta.
- `vba/ExpediceUploadJedenSkript.bas` - jeden VBA skript pro upload roztrideni a kompletace.
- `print-agent/` - puvodni print agent / servisni soubory.
- `print-agent-v2/` nebo obdobna slozka - .NET/C# verze print agenta, pokud je v aktualnim repozitari pritomna.

Pozor:

- Upravuj hlavne tyto soubory, pokud neni jasne, ze je potreba neco jineho.
- Pri vizualnich zmenach je dobre overit v prohlizeci.
- Pri beznych rozumnych zmenach commitnout a pushnout.

## 3. Nasazeni a infrastruktura

Nasazeni bezi na Railway:

- Web/API: `expedice-production.up.railway.app`
- Databaze: PostgreSQL na Railway.
- Databaze byla presunuta tak, aby nebyla v USA proti EU sluzbe, protoze latence delala pomale prihlaseni a odepisovani.

Dulezite prostredove promenne:

- `DATABASE_URL` - Railway Postgres.
- `MAPY_API_KEY` - Mapy.com API.
- Upload tokeny zatim nejsou hlavni tema, historicky se domluvilo, ze data zatim nejsou citliva, ale endpointy zustaly kompatibilni s tokenem.

## 4. Uzivatele a pristupy

Je implementovane prihlaseni:

- admin: `d.najman@centrum.cz`,
- prvni historicke heslo bylo `1234`, po prvnim prihlaseni se melo vynutit zmeneni hesla,
- role: `admin`, `employee`.

Admin muze:

- spravovat nastaveni,
- spravovat uzivatele,
- mazat davky / expedicni dny,
- spoustet citlivejsi akce.

Zamestnanec ma videt hlavne pracovni cast:

- Roztřideni,
- Kompletace,
- instalace tisku,
- bez citlive administrace.

## 5. Expedicni dny a davky

Zavedl se koncept expedicnich dnu.

Princip:

- Jeden expedicni den reprezentuje konkretni datum, napr. `2026-06-24`.
- Den obsahuje aktivni davku `sorting` a aktivni davku `completion`.
- Opakovany upload stejneho typu pro stejny den nahrazuje predchozi aktivni davku.
- Stare davky se fyzicky nemazou, jen se oznaci jako `replaced`.
- Rucni smazani je soft-delete.

UI:

- Vlevo je seznam dostupnych expedicnich dnu.
- Nechce se dropdown, ale realny seznam dni.
- Den se da prepinat kliknutim.
- Admin ma tlacitko na smazani celeho expedicniho dne.

Backend API, ktere se v projektu pouziva nebo ma byt zachovano:

- `GET /api/expedition-days`
- `GET /api/expedition-days/<date>`
- `POST /api/datasets/upload`
- `GET /api/datasets`
- `GET /api/datasets/<id>`
- `DELETE /api/datasets/<id>`

## 6. Upload z Excelu / VBA

Dominik chce jeden VBA skript, ne sadu VBA modulu.

Dulezite:

- VBA uploaduje roztrideni i kompletaci.
- `datasetDate`, `datasetTime`, `expeditionDayDate`, `batchName`, `replaceMode` jsou soucasti uploadu.
- Upload automaticky pouziva dnesni datum.
- `batchName` je datum ve formatu typu `18.6.2026`.
- `datasetTime` slouzi pro audit a historii.

Aktualni dulezite pravidlo po oprave z 25. 6. 2026:

- Pro checklist polozek v Kompletaci se nema pouzivat `VYSKLADNI`.
- Polozky pro Kompletaci se paruji pres aktivni Roztřideni stejneho expedicniho dne podle cisla objednavky.
- Ve VBA se kvuli tomu nema pridavat novy upload `warehouseItems` z listu `VYSKLADNI`.
- Oproti ranu 25. 6. 2026 by VBA nemelo potrebovat zmenu jen kvuli tomuto checklistu.

Dominik v Excelu upravil rozsah sloupcu zhruba takto:

- `completion` minimalne 50 sloupcu,
- `sorting` minimalne 30 sloupcu.

## 7. Roztřideni

Roztřideni je nahrada puvodniho userformu pro rozrazovani dorazeneho zbozi.

Hlavni pozadavky:

- Nacist EAN / carovy kod cteckou.
- Zobrazovat EANy u radku.
- Rucni hledani podporuje kod, nazev, variantu i znacku.
- Odepisovani `-1` je hned za sloupcem `Zbyva`.
- `+1` je az na konci, oddelene, aby se nekliklo omylem.
- Kdyz se zbozi odepise do nuly, nema hned zmizet z obrazovky, i kdyz je zapnute skryvani nulovych polozek; zmizet muze az po refreshi / dalsim nacteni.
- Vice zamestnancu muze pracovat soucasne, proto odepisovani musi byt resene pres DB atomicky, ne jen lokalne.

Roztrideni je dulezite pro Kompletaci:

- U objednavek s kodem poradi `>= 2` musi byt zbozi roztridene z dodavatelskych baliku.
- U techto objednavek Kompletace kontroluje, ze vsechny polozky objednavky maji v Roztřideni `remaining = 0`.
- U objednavek s kodem poradi `< 2` jde o samostatne skladovky a neznamena to chybu, kdyz polozky nebyly odepisovane z roztřideni.

## 8. Kompletace - aktualni workflow

Kompletace je hlavni skladovy cockpit.

Aktualni UX:

- Samostatna URL: `/kompletace`
- Horni panel je primarni pracovni misto.
- Tabulka pod tim je sekundarni dohledavani a admin prehled.
- Zamestnanec nacita expedicni box cteckou.
- Kod boxu ma tvar napr. `X16S`.
- Z toho se vycte expedicni cislo `16`.

Po nacteni boxu:

- vybere se objednavka podle expedicniho cisla,
- zobrazi se zakaznik,
- adresa,
- objednavka,
- dopravce,
- platba,
- zeme,
- stav,
- polozky ke kontrole,
- pripadne poznamka,
- automaticky se ma tisknout stitek dopravce, pokud je pripraveny,
- pokud je objednavka nezaplacena, ma vyjet i nezaplacenka,
- pokud je storno, netisknout a jasne zobrazit STORNO.

Barevne rozhodovani:

- zelena = OK / zaplaceno / pripravene,
- cervena = error / chyba / nesedi polozky,
- cerna/seda = storno, neexpedovat,
- oranzova = pozor, nezaplaceno, neoverena adresa, chybi stitek,
- modra = DPD,
- zeleno-tyrkysova = Zasilkovna / Packeta,
- zluta = dobirka,
- seda = samostatna skladovka / neutral.

## 9. Poznamka u objednavky

Posledni dulezita zmena:

- Pokud ma objednavka poznamku, musi pri tisku vyskocit popup.
- Popup ma obsahovat text poznamky.
- Popup ma mit jen `OK`.
- Poznamka nema blokovat expedici.
- Smysl je donutit skladnika poznámku precist, protoze muze znamenat rucni fyzickou zmenu na objednavce.
- Po potvrzeni `OK` tisk/expedice normalne pokracuje.

Technicky:

- Frontend funkce je v `app.js` kolem workflow tisku.
- Funkce pro potvrzeni poznamky byla zmenena z `confirm` na `alert`, aby nesla expedice zastavit tlacitkem Storno.
- Automaticky tisk po skenu potvrzuje poznamku jednou.
- Rucni tisk stitku / nezaplacenky / errorky take upozorni na poznamku.

## 10. Polozky v Kompletaci a vazba na Roztřideni

Tohle je hodne dulezite, protoze se tu uz jednou odbocilo spatnym smerem.

Spravny stav:

- Kompletace nebere polozky z `VYSKLADNI`.
- Kompletace ziska `orderNumber`.
- Najde aktivni `sorting` davku stejneho expedicniho dne.
- V `dataset_rows` najde vsechny radky se stejnym cislem objednavky.
- Zobrazi polozky z Roztřideni.

Radek polozky ma zobrazovat hlavne:

- nazev,
- kod / variant code,
- barvu / velikost,
- mnozstvi.

U objednavky `>= 2`:

- pokud ma nektera polozka `remaining > 0`, neni roztřideni hotove,
- panel ma upozornit, ze zbyva X ks.

U objednavky `< 2`:

- jde o samostatnou skladovku,
- polozky se maji ukazat pro fyzickou kontrolu,
- `remaining > 0` nema byt chyba.

Kdyz polozky nejsou nalezeny:

- zobrazit jasne varovani `Polozky objednavky v Roztřideni nenalezeny`,
- nevyrabet falesnou polozku typu jen cislo objednavky.

## 11. Dobrovolna fyzicka kontrola polozek

Dominik chce, aby kolegyne nemusely povinne odklikavat kazdou polozku.

Princip:

- Nacteni objednavky je dostatecny signal, ze s ni pracovaly.
- Klikani na jednotlive polozky muze existovat jako dobrovolna kontrola.
- Pokud nekdo polozku odklikne, ma se to zaznamenat.
- Do budoucna je vhodne doplnit audit log postupu:
  - kdo nacetl box,
  - kdy ho nacetl,
  - co bylo zobrazeno,
  - zda byly polozky odkliknute,
  - zda byl tisk spusten,
  - zda byl stitek v cache,
  - zda byla poznamka potvrzena.

Pozor:

- Pokud se bude implementovat trvaly audit, nestaci jen lokalni frontend stav.
- Je potreba backend endpoint a DB tabulka pro workflow udalosti.

## 12. Platby a stav objednavky

Nepouziva se banka.

Platby se kontroluji z CSV exportu eshopu:

- `iveronika.cz`,
- `iveronika.sk`,
- `galantra.cz`.

Feed URL jsou ulozene v nastaveni aplikace.

Datumy ve feedu maji byt dynamicke:

- nestahovat vsechno,
- typicky poslednich cca 10 dni,
- server si ma doplnit `dateFrom` a `dateUntil`.

Aktualizace na pozadi:

- Server nema stahovat feedy donekonecna sam od sebe.
- Aktivuje se praci s konkretni davkou.
- Kdyz se s davkou pracuje, muze se aktualizovat cca 1x za 20 minut.
- Pokud zmena nastane behem expedice, ma se propsat do prave otevrene davky.

Logika plateb:

- Dobirka se nema oznacovat jako nezaplaceno; ma byt `Dobirka`.
- Kartou / prevodem se vyhodnocuje podle feedu a stavu objednavky.
- Pokud feed nezna objednavku nebo neni jasne, zobrazit `Platba nezjistena`.
- Pokud stav jasne rika cekani na platbu / pripominka platby, ma se to brat jako nezaplacene, ne nejasne.
- Slovenske nazvy plateb/stavu jsou dulezite.

Storno:

- Storno je klicove.
- Musi se hlidat vice stornovacich stavu z Shoptetu.
- Pro CZ i SK jsou nazvy jine.
- Storno ma byt cernosedy stav a jasne `neexpedovat`.

Objednavkove prefixy:

- `1700...` = iveronika.cz, CZK, Cesko.
- `2018...` = iveronika.sk, EUR, Slovensko.
- `42...` = galantra.cz, CZK, Cesko.

Dominik vyslovne chtel Galantru podle prvnich 2 cislic `42`, ne podle prvnich 4, protoze cisla objednavek jsou kratsi a porostou.

## 13. Adresy a Mapy.com

Adresy v Kompletaci jsou editovatelne.

Pouziva se Mapy.com API:

- `MAPY_API_KEY` je v Railway.
- V tabulce je sloupec overeni adresy.
- U radku ma byt tlacitko `Mapy`, ktere otevre nalezenou adresu na mapy.com.
- Hromadne overeni adres ma preskakovat jiz overene adresy.
- Pri opetovnem kliknuti se nemaji znovu posilat OK adresy na API.

Pravidla oprav:

- Pokud Mapy.com vrati presny navrh, adresa se muze prepsat podle navrhu a oznacit jako overena.
- Pokud chybi PSC, ale Mapy.com najde presnou shodu, doplnit PSC a oznacit jako OK.
- Pokud API najde jen nejednoznacny vysledek nebo vylozene jinou adresu, ma byt problem a resit se zakaznikem.
- Je dulezite nebrat kazdy vysledek Mapy.com jako pravdu; napriklad jen ulice bez cisla popisneho je chyba.

Logovani:

- Po hromadnem overeni ma byt citelne shrnuti, idealne ne browser alert.
- Ma existovat detailni log oprav adres.
- Log ma umoznit vratit zmenu.
- Zaznamenavat:
  - puvodni adresu,
  - navrh,
  - provedene zmeny,
  - duvod,
  - uzivatele,
  - cas,
  - moznost rollbacku.

## 14. Dopravci

Hlavni dopravci:

- Zasilkovna / Packeta,
- DPD,
- darkovy poukaz emailem bez dopravce.

Rozliseni dopravy:

- `DPD kuryr doprava na adresu`
- `Kurierom na adresu`
- `Osobni odber na pobocce Zasilkovna.cz`
- `Odberne miesto - Packeta.sk`
- `Darkovy poukaz emailem, v kosiku musi byt pouze poukazy!`
- `DPD na vydejni misto/box`

Aktualni priorita:

- Zasilkovna/Packeta je dulezitejsi pro API odesilani.
- DPD se zatim hodne pouziva pres Shoptet Baliky a v systemu se resi hlavne tisk existujicich stitku.
- DPD pickup ID zatim v Excelu chybi; Dominik ho chce od dalsi varky doplnit a pak se to muze zapracovat.

## 15. Zasilkovna / Packeta

Nastaveni ma podporovat vice klientu:

- iveronika.cz a galantra.cz maji ruzne API klice / hesla / klienty.
- iveronika.sk je samostatny shop.

Pozor:

- Driv byl problem ulozit API key klienta u Galantry.
- Nastaveni ma mit samostatne bloky pro kazdy shop.

Odeslani:

- Existuje tlacitko pro odeslani jedne zasilky.
- Existuje nebo bylo planovane tlacitko `Odeslat vse Zasilkovna` pro konkretni davku.
- Pred ostrym odeslanim hromadne musi byt pojistky:
  - neposlat radky s existujicim ID zasilky znovu,
  - dobirka musi mit spravnou castku a menu,
  - doruceni na adresu jen s overenou adresou,
  - darkove poukazy neposilat dopravci.

## 16. DPD

Byla hledana dokumentace DPD:

- Swagger: https://geoapi.dpd.cz/v2/swagger/

V nastaveni je sekce DPD.

Dominik chtel minimalizovat Railway promenne a dat co nejvice do nastaveni aplikace:

- base URL,
- API key,
- zakaznik DSW,
- zakaznik ID,
- shop-specific nastaveni.

Soucasna prakticka priorita:

- DPD balicky se zatim pravdepodobne dal vytvari pres Shoptet Baliky.
- V online systemu je dulezite hlavne tisknout existujici DPD stitky a pripravit cache.
- DPD odesilani pres API zatim brat opatrne a testovat dry-run / test endpointy.

## 17. Serverova cache stitku

Byl implementovan nebo pripravovan plan serverove cache stitku.

V1 rozhodnuti:

- PDF stitky ulozit do PostgreSQL.
- Tisk ze skladu pri skenu nema volat live API dopravce.
- Bezne workflow ma tisknout uz ulozene PDF ze serverove cache.
- Live volani dopravcu jen pri priprave cache nebo admin/test akci.

Tabulka / koncept:

- `label_cache`
- vazba na `dataset_id`
- vazba na `completion_row_id`
- `carrier`
- `label_number`
- PDF `BYTEA`
- stav `ready/error`
- chyba
- cas stazeni
- velikost PDF

UI:

- tlacitko `Pripravit DPD stitky` / drive `Pripravit stitky davky`,
- u radku stav:
  - `v cache`,
  - `chybi cache`,
  - `chyba cache`.

Pozor:

- Pokud se zobrazi `chybi cache`, znamena to, ze radek ma cislo stitku/zasilky, ale PDF jeste neni ulozene na serveru.
- Pri skenu boxu se nema volat API dopravce, jen cache.
- Pokud cache chybi, zobrazit varovani a sklad muze pokracovat bez cekani.

## 18. Tiskovy agent

Cil:

- Zamestnanci nemaji manualne otvirat PDF.
- Web posle PDF lokalnimu agentovi.
- Agent bezi jen na skladovem PC na `127.0.0.1:8787`.
- Z internetu neni dostupny.

Stranka:

- `print-agent.html`
- Odkaz `Instalace tisku` je nahore u uzivatele a maji ho videt i zamestnanci.

Verze:

- V1 puvodni agent / PowerShell varianta.
- V2 .NET/C# agent jako nova verze kvuli Avastu.
- V1 ponechat jako zalozni.

Instalace:

- Ma byt samostatny balicek, ne nutne PowerShell pro bezneho zamestnance.
- Soucasti ma byt SumatraPDF.
- Ma existovat instalator i odinstalator.
- V2 pouziva lokalni port 8787 stejne jako V1; nepoustet obe verze zaroven.

Tiskarny:

- DPD stitky typicky Brother QL-1100.
- Zasilkovna typicky Brother QL-700.
- Dokumenty jako nezaplacenka / errorka na vychozi Windows tiskarnu.

Admin test mode:

- V nastaveni je zatrzitko `TESTOVANI`.
- Kdyz je admin a testovani je zapnute, pred odeslanim na tiskarnu se ma ptat, jestli opravdu tisknout.
- Duvod: aby Dominik pri testovani netiskl zbytecne papiry.

## 19. Nezaplacenky a errorky

V master Excelu existuje tisk kontrolnich papiru s carovym kodem.

Online system ma navazat:

- `Nezaplacenka`
- `Error`
- `Nezaplaceno + error`

Tyto papiry slouzi k tomu, aby kolegyne mohly fyzicky oznacit balik a pozdeji rychle nacist / dohledat stav.

Pozadavky:

- Papir obsahuje carovy kod.
- Carovy kod nema byt obrovsky; posledni pozadavek byl zmensit zhruba na polovinu.
- Ma obsahovat zakaznika, objednavku, castku, dopravce, adresu, kod v expedici a polozky.
- Polozky mohou byt malym pismem.
- U errorky jasne cervene/oranzove oznaceni.

## 20. URL routovani

Zalozky maji mit samostatne URL:

- `/roztrideni`
- `/kompletace`
- `/nastaveni`
- `/print-agent.html`

Uzivatel se ma moct vratit primo na konkretni cast.

## 21. Nastaveni

Nastaveni ma obsahovat hlavne:

- Mapy.com API key,
- Zasilkovna / Packeta API URL a hesla,
- shop-specific klienti:
  - iveronika.cz,
  - iveronika.sk,
  - galantra.cz,
- DPD API nastaveni,
- feed URL pro platby/stavy,
- print agent test mode,
- uzivatele pro admina.

Pozor:

- Zamestnanci nemaji videt citlive nastaveni a spravu uzivatelu.
- Instalace tisku ale ma byt dostupna i zamestnancum.

## 22. Aktualni dulezite rozhodnuti pro samostatne skladovky

Dominik chce oddelit:

- `Samostatne skladovky` - kod poradi `1.9` a mene,
- standardni zasilky s roztridenim - kod poradi `2` a vice.

Proc:

- Samostatne skladovky jdou ze skladu hned nasledujici den po objednani.
- Standardni zasilky cekaji na zbozi od dodavatelu a projdou roztridenim.

V UI Kompletace:

- filtr `Typ prace`,
- jasne oznaceni samostatne skladovky,
- ale i samostatne skladovky musi mit fyzicky checklist polozek z Roztřideni / aktivnich dat, aby se predeslo chybe.

## 23. Co se musi delat opatrne

Nejrizikovejsi oblasti:

- Ostry odesilani do Zasilkovny/Packety.
- DPD API, dokud neni uplne overene.
- Tisk bez cache.
- Platebni stavy a storna.
- Automaticke opravy adres.
- Soubezna prace vice lidi v Roztřideni.
- Jakykoliv zasah do VBA, protoze Dominik nechce skladat vice modulu rucne.

Pred zmenou v techto castech je lepsi:

- kratce popsat plan,
- ujasnit dusledky,
- implementovat mensi krok,
- commitnout,
- pushnout.

## 24. Co zkontrolovat jako prvni v novem chatu

Novy chat by mel nejdrive udelat toto:

1. Precist tento handoff.
2. Precist `app.js`, pokud se resi frontend / workflow.
3. Precist `app.py`, pokud se resi API / databaze / dopravci / platby.
4. Precist `styles.css`, pokud se resi vzhled.
5. Precist `vba/ExpediceUploadJedenSkript.bas`, pokud se resi Excel upload.
6. U vizualnich zmen overit v prohlizeci, pokud je to relevantni.
7. Nedelat velke refaktory bez duvodu, protoze system je v zivem testovani.

## 25. Posledni sled zmen pred handoffem

Posledni veci, ktere se delaly:

- Opraveno parovani checklistu Kompletace s Roztřidenim podle cisla objednavky.
- Redesign horniho panelu Kompletace na skladovy cockpit.
- Storno ma byt cerne/sede.
- Poznamka objednavky pred tiskem:
  - musi vyskocit popup,
  - popup obsahuje poznamku,
  - ma jen OK,
  - neblokuje expedici,
  - slouzi jako upozorneni na mozne manualni zmeny.

## 26. Prakticka komunikace s Dominikem

Dominik preferuje:

- cesky,
- pratelsky, primo, bez zbytecne omacky,
- klidne osloveni Domco / Dominiku,
- rozumne zmeny rovnou commitnout a pushnout,
- po praci kratky audit a navrhy dalsich kroku,
- pri vizualnich zmenach overit v prohlizeci, pokud to dává smysl,
- nebat se byt trochu zovialni.

Duveruj jeho provozni intuici. Casto velmi presne vi, proc nejake male workflow rozhodnuti ve skladu v praxi rozhoduje o rychlosti cele expedice.

## 27. Dalsi vhodne kroky

Možné dalsi kroky:

- Dodelat trvaly audit workflow udalosti v Kompletaci.
- Udelat lepsi modal pro poznamky misto browser `alert`, aby byl citelnejsi a hezci.
- Dodelat detailni log overeni adres s rollbackem.
- Dodelat a otestovat DPD cache stitku.
- Overit Zasilkovna hromadne odeslani jen na testovacich datech.
- Zlepsit platebni feed logiku pro vsechny slovenske a ceske stavy.
- Dodelat jasny panel pro storna a nezaplacene objednavky.
- Dodelat dokumentaci print agenta pro skladove PC.

