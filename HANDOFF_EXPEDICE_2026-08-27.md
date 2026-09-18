# Handoff projektu Expedice

Aktualizováno: 27. 8. 2026  
Repozitář: `https://github.com/DominikCodex/expedice.git`  
Produkce: `https://expedice-production.up.railway.app`  
Větev: `master`  
Aplikační commit před vytvořením tohoto dokumentu: `42b66cb73df9fb0f3612009f740568584d36c8eb`

## 1. Účel dokumentu

Tento soubor je aktuální předávací dokument pro pokračování na jiném počítači. Popisuje skutečný stav webové aplikace Expedice, její důležitá obchodní pravidla, lokální spuštění, testy, nasazení, tiskového agenta a oblasti, které je potřeba při dalších změnách hlídat.

Starší `HANDOFF_EXPEDICE_2026-06-25.md` a `README.md` už nepopisují celý současný systém. `README.md` je převážně historický popis původního MVP a nesmí se používat jako jediný zdroj pravdy.

## 2. Rychlé pokračování na druhém PC

### 2.1 Stažení a kontrola repozitáře

```powershell
git clone https://github.com/DominikCodex/expedice.git
cd expedice
git status
git branch --show-current
git pull --ff-only origin master
git log -5 --oneline
```

Očekávaná pracovní větev je `master`. Dominik schválil rozumné změny průběžně commitovat a pushovat přímo do tohoto repozitáře.

Před zahájením práce vždy ověřit:

```powershell
git status --short
git rev-parse HEAD
git rev-parse origin/master
```

Nikdy nevracet ani nemaž lokální změny, které nevytvořil aktuální agent. V původním pracovním adresáři byly při vytvoření tohoto handoffu dvě nesouvisející nesledované složky:

- `.codex_tmp_vba/`
- `Master Soubor/`

Nejsou součástí webové aplikace ani tohoto commitu. Na jiném PC se přes Git neobjeví.

### 2.2 Požadované prostředí

- Python 3.11
- Node.js 22
- PostgreSQL 16
- Chromium pro Playwright
- Git
- Volitelně .NET 8 SDK pouze pro vývoj Print Agentu V2

Instalace Pythonu a frontendových testů:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
npm ci
npx playwright install chromium
```

### 2.3 Lokální databáze

Aplikace vyžaduje PostgreSQL přes `DATABASE_URL`. Nepoužívá SQLite.

Příklad lokální databáze přes Docker:

```powershell
docker run --name expedice-postgres `
  -e POSTGRES_DB=expedice_dev `
  -e POSTGRES_USER=expedice `
  -e POSTGRES_PASSWORD=ZVOLENE_LOKALNI_HESLO `
  -p 5432:5432 `
  -d postgres:16

$env:DATABASE_URL="postgresql://expedice:ZVOLENE_LOKALNI_HESLO@127.0.0.1:5432/expedice_dev"
$env:INITIAL_ADMIN_USERNAME="lokalni-admin"
$env:INITIAL_ADMIN_PASSWORD="ZVOLENE_LOKALNI_ADMIN_HESLO"
python app.py
```

Aplikace poběží standardně na `http://127.0.0.1:8000`. `PORT` lze změnit proměnnou prostředí.

Hesla, API klíče ani produkční `DATABASE_URL` nikdy nezapisovat do tohoto souboru, zdrojových kódů, testů ani Git historie. Bootstrap admina se používá jen při založení první lokální databáze. Neaktualizuje heslo již existujícího uživatele.

### 2.4 První kontrola po spuštění

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

Potom v prohlížeči otevřít `http://127.0.0.1:8000`, přihlásit se lokálním účtem, vytvořit testovací den a nepoužívat produkční objednávky pro mutační testy.

## 3. Stručná architektura

Projekt je zatím záměrně jednoduchá monolitická aplikace:

- `app.py` - Flask backend, databázové schéma, autentizace, importy, dopravci, platby, adresy, audit a API.
- `app.js` - celý frontendový stav a chování pracovních obrazovek.
- `index.html` - společná HTML kostra aplikace.
- `styles.css` - vzhled, responzivita, hustota kompletace a admin editor.
- `expedition_integrity.py` - čisté výpočty neměnného reportu várky a integrity dat.
- `print-agent-dotnet/` - podporovaný lokální Print Agent V2 pro Windows.
- `print-agent/` - starší Python/PyInstaller agent V1, dále jej nerozvíjet.
- `tests/` - backendové pytest testy a Playwright E2E/visual testy.
- `vba/` - samostatné pomocné VBA moduly pro Excel.
- `docs/multishop-expedition-blueprint.md` - širší návrh multishop expedice.
- `.github/workflows/` - testy a build/release obou tiskových agentů.

Produkční proces je definovaný v `Procfile`:

```text
web: gunicorn app:app
```

Databázové změny nejsou řízené externím migračním frameworkem. `ensure_schema()` v `app.py` používá idempotentní `CREATE TABLE IF NOT EXISTS` a `ALTER ... IF NOT EXISTS`. Každá další změna schématu musí zachovat tento styl, být opakovatelná a nesmí mazat existující produkční data.

### Vyskladnění ze skladu

Upřesnění 18. 9. 2026: hlavní požadavek uživatele je samostatné tlačítko v Excelu pro tiskovou sestavu A4 na šířku. Nový modul `vba/VyskladneniTisk.bas` se instaluje samostatně podle `vba/VyskladneniTisk.md`; žádné existující makro se neslučuje ani nemění. Vlastní endpoint `/api/warehouse/upload-print` ukládá dávky `warehouse_print` bez nahrazování starších dávek. Vrací odkaz na `warehouse-print.html?dataset=<id>`. Stránka používá původní množství, produktové fotografie, volitelné řazení, opakovanou tiskovou hlavičku a ruční odškrtávací políčka. Serverové testy jsou v `tests/test_warehouse_print.py`, browser/PDF kontroly v `tests/e2e/warehouse-print.spec.js`.

Záložka `Vyskladnění` používá stávající tabulky `datasets` a `dataset_rows` s `dataset_kind = warehouse`; nevznikla další databázová tabulka. Administrátor může k vybranému expedičnímu dni nahrát `.xlsx` přes `POST /api/warehouse/upload-xlsx`. Aktivní starší skladová dávka téhož dne se měkce nahradí novou. Běžní přihlášení uživatelé mohou přes `PATCH /api/warehouse/rows/<id>` odepisovat, vracet nebo dokončit řádek. Hodnota `remaining` je uložena na serveru a změny jsou auditované.

Podporovaný Excel má na prvním viditelném listu ve sloupcích B-E hlavičky `Kód varianty:`, `Varianta:`, `Kolik a kam s tím:` a `Celk.:`. Rozdělení do boxů používá zápis `množství x číslo boxu`, například `1x3, 2x14`. Import odmítne neznámý formát i nesoulad mezi rozepsaným a celkovým množstvím. Fotografie se dohledávají stávajícím produktovým feedem podle SKU; chybějící fotografie mají textový placeholder.

Backendový parser pokrývá `tests/test_warehouse_workbook.py`, pracovní obrazovku a podporovaná rozlišení `tests/e2e/warehouse.spec.js`.

## 4. Datový model

Hlavní tabulky:

- `users`, `user_sessions`, `login_rate_limits`
- `shops`, `stock_sources`
- `expedition_days`
- `datasets`, `dataset_rows`
- `completion_rows`
- `completion_shipments`
- `expedition_batch_snapshots`
- `operation_jobs`
- `pickup_points`, `pickup_catalog_syncs`
- `payment_feed_syncs`
- `label_cache`
- `address_validation_logs`
- `audit_events`
- `app_settings`

Expediční dny i datasety se mažou měkce, tedy přes stav v databázi. Přesun do koše nemá fyzicky mazat jejich historii.

## 5. Role a přihlášení

Backend používá role:

- `admin`
- `employee`

V uživatelském rozhraní se `employee` zobrazuje jako `uživatel`.

Session cookie se jmenuje `expedice_session`, platnost session je 12 hodin. Povinná změna hesla po vytvoření nebo resetu byla zrušena. Heslo přidělené administrátorem zůstává platné.

Základní ochrana proti brute force útoku je aktivní. Výchozí limity:

- 5 chybných pokusů pro kombinaci uživatel + IP,
- 25 chybných pokusů pro jednu IP,
- okno 15 minut,
- blokace 15 minut,
- úklid starých záznamů po 24 hodinách.

Konfigurační proměnné:

- `LOGIN_USER_IP_MAX_ATTEMPTS`
- `LOGIN_IP_MAX_ATTEMPTS`
- `LOGIN_FAILURE_WINDOW_SECONDS`
- `LOGIN_LOCK_SECONDS`
- `LOGIN_RATE_LIMIT_RETENTION_SECONDS`

## 6. Výběr expedičního dne

- Bez výslovného výběru dne se nesmí zobrazit roztřídění, kompletace ani starý report dne.
- Uživatel vidí neutrální výzvu k výběru dne.
- Běžný uživatel má po kliknutí na den desetihodinový lokální zámek daného data.
- Zámek se ukládá v `localStorage` pod klíčem `expedition-employee-day-lock-v1` a je vázaný na uživatele.
- Tlačítko `Vybrat jiné datum várky` zámek zruší a vyčistí pracovní stav.
- Administrátor desetihodinový zámek nepoužívá.
- Zámek je lokální pro konkrétní prohlížeč. Na jiném PC se nepřenese, což je očekávané chování.

Administrátor může u aktivních dnů zaškrtnout více položek a přes `Smazat den` je hromadně přesunout do koše. Běžný uživatel checkboxy, koš ani mazání nevidí.

## 7. Zásadní obchodní pravidla

### 7.1 EAN a odpisy

- Jeden načtený EAN znamená vždy právě jeden kus.
- EAN je bezpečný, pokud vede k jedné normalizované variantě/SKU.
- Více otevřených objednávek stejné varianty není nejednoznačnost.
- Při opakovaném skenu se vždy odečte jeden kus z prvního dostupného expedičního čísla.
- Množství nesmí klesnout pod nulu.
- Skutečná nejednoznačnost nastává až tehdy, když jeden EAN vede k více odlišným normalizovaným variantám.

### 7.2 Množství v kompletaci

- Hodnota `ks` u položky vpravo patří konkrétní položce/variantě, ne celé objednávce ani celému roztřídění.
- Jedna varianta může mít v objednávce například `2 ks`; toto množství musí zůstat zachované v jednom řádku.
- Celkový počet kusů objednávky je samostatný souhrn vlevo.

### 7.3 Stav objednávky

- Zelená - `OK`.
- Červená - `Error`.
- Žlutá - `Nezaplaceno`.
- Šedá - `Storno`.
- Oranžová - datová nesrovnalost nebo něco k ručnímu prověření.

Odklikání jednotlivých produktů v kompletaci je pouze fyzická pomůcka, není podmínkou stavu `OK - PŘIPRAVENO`. `Uložit OK` je dobrovolné označení skladníka a nesmí blokovat tisk ani pokračování na další box. Pokud se uloží OK přes aktivní problém, událost se zaznamená do auditu.

Neuhrazená platba sama o sobě není problém k administrativnímu vyřešení. Objednávka se zpracuje standardně a při expedici se vytiskne nezaplacenka.

Pokud už existuje číslo zásilky nebo štítek, chybějící výdejní místo se nepovažuje za problém. Rozhodující jsou data již odeslaná do dopravce/Shoptetu a obsah štítku.

### 7.4 Expediční číslo a box

- Expediční číslo je editovatelné a změna se aplikuje po přibližně 0,5 sekundy bez Enteru.
- Fokus v poli expedičního čísla se nesmí svévolně vracet do boxového skeneru.
- Pokud je do pole expedičního čísla omylem načten box ve formátu `XčísloS`, aplikace box rozpozná a zpracuje.
- Patvar typu `22X19S` se má interpretovat jako box/expediční číslo `19`, ne `22`.

### 7.5 Kódy pořadí

Výchozí významy:

| Kód | Význam |
|---|---|
| `0.8` | Komplet ze skladu Galantra.cz přes Zásilkovnu |
| `1` | Komplet ze skladu iVeronika.cz |
| `1.5` | Komplet ze skladu iVeronika.sk |
| `1.8` | Komplet ze skladu Galantra.cz přes DPD |
| `1.9` | Komplet ze skladu DPD mimo Galantra.cz |
| `2` | Zásilkovna pouze Hotex |
| `3` | Zásilkovna Milpex |
| `4` | Zásilkovna Milpex + Hotex kombinace |
| `5` | Zatím nepoužíváme |
| `6` | iVeronika.sk Zásilkovna |
| `7` | DPD Milpex nebo Hotex |
| `8` | ERRORKA Galantra.cz |

Názvy jsou editovatelné administrátorem v Nastavení. Technické číselné kódy se v reportu běžným uživatelům skrývají, administrátor je vidí.

Hranice `2` neznamená, že objednávka už nemůže obsahovat skladový kus. Objednávky s kódem `2` a vyšším mohou kombinovat sklad a roztřídění. Počet `Skladovky (kusů)` se proto počítá z původních položek, ne jen podle kódu objednávky.

## 8. Report vybrané várky a integrita

Report dne používá serverový neměnný snímek v `expedition_batch_snapshots`, navázaný na konkrétní aktivní dvojici dávek kompletace a roztřídění.

Snímek obsahuje původní:

- počet objednávek,
- počet všech kusů,
- počet skladových objednávek,
- počet skladových kusů,
- chybné adresy,
- platby k řešení,
- souvislé rozsahy expedičních čísel podle kódů pořadí.

Tyto hodnoty se po dalších odpisech z roztřídění nesmí měnit. Nový upload vytvoří nový snímek pro novou dvojici datasetů.

API:

- `GET /api/expedition-days/<id>/report`
- `GET /api/expedition-days/<id>/integrity`

Kontrola integrity hledá zejména:

- rozdíl součtu kusů objednávky a položek,
- chybějící nebo duplicitní expediční čísla,
- záporné hodnoty a `remaining > initial`,
- chybějící vazbu kompletace/roztřídění,
- rozdíl konkrétní varianty,
- neznámý expediční kód,
- skutečně nejednoznačný EAN.

Závažnosti jsou `error`, `warning` a `info`. Tlačítko `Prověřit` v reportu spouští tuto kontrolu konzistence celé várky. Neověřuje adresu jedné konkrétní objednávky.

## 9. Automatické kontroly po uploadu

Po uploadu nové dávky `completion` server data nejprve uloží a vrátí odpověď. Potom spustí databázově evidovanou úlohu `post_upload_checks` na pozadí:

1. kontrola a párování plateb,
2. ověření adres doručovaných na adresu přes Mapy.com.

Upload `sorting` tuto úlohu nespouští. Opakovaný upload stejného dne označí starší nedokončenou úlohu jako `superseded` a kontroluje pouze aktuální dataset.

API:

- `GET /api/expedition-days/<id>/checks/latest`
- `POST /api/expedition-days/<id>/checks/retry` pouze admin

V Nastavení jsou globální přepínače:

- `Kontrolovat platby po nahrání`
- `Ověřovat adresy po nahrání`

Oba jsou výchozí zapnuté. Pokud služba není nastavená, fáze se označí jako přeskočená, ne jako chyba celé dávky.

Platby používají společný zámek, aby se stejný feed nestahoval souběžně vícekrát. Chyba jednoho e-shopu nezastaví ostatní.

Mapy.com:

- ověřují pouze doručení na adresu,
- přeskočí výdejní místa, boxy a e-mailové poukazy,
- ruční override má vždy přednost,
- stejné adresy v jedné dávce se dotazují jen jednou,
- běží maximálně čtyři dotazy souběžně,
- dočasná chyba se opakuje nejvýše dvakrát.

Úloha běží ve vlákně webového procesu. Je zapsaná v databázi, ale deploy nebo restart procesu může přerušit její provádění. V takovém případě použít admin tlačítko pro zopakování kontroly.

## 10. Kontrola adres a Mapy.com

Automaticky lze použít pouze bezpečný výsledek:

- unikátní kandidát,
- shodné číslo domu,
- shodné PSČ,
- shodné město,
- shodná země,
- rozdíl ulice nejvýše jeden znak po normalizaci.

Typický jednopísmenný překlep, například `Zákuští` proti `Záluští`, může být za těchto podmínek automaticky opraven. Větší změna nebo rozdíl čísla domu zůstává návrhem.

V editoru se u návrhu zobrazuje oranžový blok s akcemi:

- `Použít a uložit: <navržená adresa>` - propíše návrh do polí a uloží override,
- `Otevřít v Mapy.com` - otevře návrh v mapě pro ruční kontrolu.

Uložení používá existující verzi řádku (`editVersion`). Pokud mezitím řádek změnil někdo jiný, server vrátí konflikt a nesmí se tiše přepsat novější data.

Poslední související commity:

- `32e0dc1` - bezpečné jednopísmenné opravy,
- `a68bc86` - akce pro použití návrhu jedním kliknutím,
- `42b66cb` - podpora starších odpovědí Mapy, které obsahují jen `items`.

Po nasazení nebo při podezření na starý frontend použít `Ctrl+F5`. Při dalším pokračování je vhodné jako první ručně ověřit jednu reálnou nejednoznačnou adresu v produkci a potvrdit, že jsou obě tlačítka vidět a zápis funguje.

Osobní a adresní inputy mají `autocomplete="off"`, aby Chrome nenabízel uložení zákazníkovy adresy do osobního profilu uživatele.

## 11. Admin workflow pro úpravu expedice

Původní široká tabulka byla nahrazena kompaktní frontou objednávek s modal editorem.

Fronta umí filtrovat například:

- k řešení,
- adresy,
- dopravu,
- výdejní místa,
- náhradní zásilky,
- připravené.

Neuhrazené objednávky se do problémů k řešení nezahrnují jen proto, že nejsou zaplacené.

Editor umožňuje upravit pouze expediční override:

- zákazníka a kontakt,
- adresu a zemi,
- dopravce a službu,
- výdejní místo,
- hmotnost, dobírku a měnu,
- poznámku dopravci.

Zdrojový import, produkty, expediční číslo a technické kódy zůstávají ke čtení. Změny se nikdy neposílají zpět do Shoptetu.

Override je vázaný na expediční den, e-shop a objednávku. Přežije opakovaný upload stejného dne, ale nepřenáší se automaticky do jiného dne.

Explicitní služby:

- Zásilkovna/Packeta výdejní místo,
- Packeta doručení na adresu,
- DPD kurýr na adresu,
- DPD výdejní místo nebo box,
- e-mailový poukaz,
- ruční doprava.

Uživatel i admin mohou data opravit. Skutečnou novou nebo náhradní zásilku může vytvořit jen admin. Neověřenou adresu lze po potvrzení uložit, ale nelze z ní vytvořit zásilku.

Hlavní API editoru:

- `PATCH /api/completion/rows/<id>/expedition-details`
- `GET /api/completion/rows/<id>/shipments`
- `POST /api/completion/rows/<id>/shipments`
- `GET /api/pickup-points`
- `GET /api/pickup-points/<carrier>/<id>`
- `POST /api/pickup-points/refresh` pouze admin

Rychlé akce v seznamu zahrnují podle dostupných dat:

- `Upravit`,
- `Mapy`,
- `Ověřit`,
- `E-shop`,
- `Tisk štítku`,
- `PDF`.

`Ověřit` u adresní objednávky provede kontrolu dané adresy přes Mapy.com. `Prověřit` v levém reportu dne je jiná akce a kontroluje integritu celé dávky.

## 12. Zásilky, štítky a dopravci

Jeden řádek může mít historii více zásilek:

- aktivní,
- nepoužívat / čeká na náhradu,
- nahrazená,
- chybná.

Při změně dopravy u již vytvořené zásilky je nutné výrazné potvrzení. Původní zásilka se v Expedici označí `Nepoužívat`, ale automaticky se neruší u dopravce. Její štítek se nesmí tisknout z běžného workflow.

Štítky se ukládají do serverové PostgreSQL cache `label_cache`. Běžný opakovaný tisk má používat cache, ne volat dopravce znovu. Stav `CHYBÍ CACHE` znamená, že aplikace zná číslo zásilky, ale nemá lokálně uložené PDF štítku.

Výchozí cílové tiskárny:

- DPD štítky - `Brother QL-1100`
- Packeta štítky - `Brother QL-700`
- běžné dokumenty - výchozí Windows tiskárna nebo explicitní nastavení agenta

Při testech živých dopravců používat dry-run/testovací režim. Odeslání na ostré API může založit skutečnou zásilku.

## 13. Print Agent V2

Podporovaná verze je `print-agent-dotnet/`, C#/.NET 8. V1 v `print-agent/` zůstává jako archiv. V1 a V2 nikdy nespouštět současně, obě používají port `8787`.

V2:

- naslouchá pouze na `127.0.0.1:8787`,
- používá SumatraPDF pro tichý tisk PDF,
- kontroluje povolený `Origin`,
- chrání `/print`, `/printers` a `/jobs`,
- ověřuje PDF, počet kopií, velikost a povolenou tiskárnu,
- vede lokální historii tiskových úloh.

Endpointy:

- `GET /health`
- `GET /printers`
- `GET /jobs?limit=20`
- `POST /print`

Instalátor z GitHub Release:

```text
ExpedicePrintAgentV2Setup.exe
```

Instalace vytvoří:

- program v `%LOCALAPPDATA%\ExpedicePrintAgentV2`,
- konfiguraci v `%APPDATA%\ExpedicePrintAgentV2\config.json`,
- autostart v `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
- SumatraPDF v podadresáři `bin`.

Kontrola:

```text
http://127.0.0.1:8787/health
```

Očekávaná verze obsahuje `2.0.0-dotnet` a `sumatraAvailable: true`.

Výchozí seznam povolených originů obsahuje produkční Expedici a lokální Flask adresy na portu 5000. Pokud se lokální aplikace spouští na portu 8000 a má z prohlížeče volat agenta, je potřeba do `AllowedOrigins` v `config.json` přidat například `http://127.0.0.1:8000`.

GitHub workflow `print-agent-dotnet.yml` sestavuje self-contained `win-x64` single-file EXE a přibaluje SumatraPDF 3.6.1. Podepsání je připravené přes secrets `WINDOWS_SIGNING_CERT_BASE64` a `WINDOWS_SIGNING_CERT_PASSWORD`, ale bez certifikátu může Windows nebo antivirus stále zobrazit reputační/heuristické varování.

Na novém PC se Print Agent instaluje samostatně. Git pull ani přihlášení do webu jej nepřenese.

## 14. Nastavení a tajné hodnoty

Globální nastavení jsou v `app_settings`. Administrátor je mění přes obrazovku Nastavení. Tajné hodnoty se při GET nevracejí; frontend dostává pouze příznak, že jsou uložené. Prázdné pole při uložení zachovává existující tajnou hodnotu.

Hlavní skupiny:

- vzhled a font,
- hustota kompletace: `auto`, `comfortable`, `warehouse`, `ultra`,
- automatické kontroly po uploadu,
- názvy kódů pořadí,
- Mapy.com,
- produktový feed,
- platební CSV feedy,
- Packeta klienti,
- DPD klienti a odesílatel,
- testovací režim tisku.

Nejdůležitější proměnné prostředí a fallbacky:

### Základ

- `DATABASE_URL`
- `PORT`
- `DB_POOL_MIN`, `DB_POOL_MAX`
- `INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_PASSWORD`
- `UPLOAD_TOKEN`, `DOWNLOAD_TOKEN`
- `AUDIT_RETENTION_DAYS` - výchozí 90
- `APP_UI_FONT`
- `PRINT_AGENT_TESTING_MODE`

### Produktový feed

- `PRODUCT_FEED_URL`
- `PRODUCT_FEED_ENCODING`
- `PRODUCT_FEED_DELIMITER`
- `PRODUCT_FEED_DOWNLOAD_TIMEOUT_SECONDS` - výchozí 600, rozsah 30 až 900
- `PRODUCT_FEED_MAX_DOWNLOAD_MB` - výchozí 512, rozsah 50 až 1024

### Platební feedy

- `PAYMENT_FEED_SYNC_DISABLED`
- `PAYMENT_FEED_ACTIVE_SYNC_SECONDS`
- `PAYMENT_FEED_LOOKBACK_DAYS`
- `PAYMENT_FEED_ENCODING` - výchozí `windows-1250`
- `PAYMENT_FEED_DELIMITER` - výchozí `;`
- `PAYMENT_FEED_URL_IVERONIKA_CZ`
- `PAYMENT_FEED_URL_IVERONIKA_SK`
- `PAYMENT_FEED_URL_GALANTRA_CZ`

### Mapy.com

- `MAPY_API_KEY`, případně starší `MAPY_API_TOKEN`
- `MAPY_GEOCODE_URL`
- `MAPY_API_KEY_PARAM`
- `MAPY_API_LANG`
- `MAPY_API_LIMIT`
- `MAPY_API_TYPE`
- `MAPY_API_TIMEOUT`

### Packeta a DPD

Existují obecné i klientské proměnné pro API URL, klíče/hesla/tokeny, customer ID a režim. Přesné názvy je bezpečnější před změnou vyhledat přímo v `app.py`:

```powershell
rg -n "PACKETA_|DPD_" app.py
```

Nikdy nekopírovat hodnoty z produkce do handoffu nebo issue.

## 15. Audit a bezpečné vrácení

Audit zaznamenává mimo jiné:

- odpis a vrácení kusu,
- změnu stavu kompletace,
- OK přes aktivní varování,
- změnu adresy a expedičního override,
- tisk a přetisk,
- smazání/obnovení dne,
- administrátorské změny nastavení.

Admin má záložku `Audit` s filtry podle období, dne, uživatele, objednávky, EAN a typu operace.

Vrácení je admin-only a je dovoleno jen bez novější kolidující změny. Vždy vznikne kompenzační transakce a nový auditní záznam; původní historie se nepřepisuje ani nemaže.

Výchozí retence je 90 dní.

## 16. UI a responzivita

Kompletace je fluidní skladový cockpit:

- sken boxu a expediční číslo mají prioritu nahoře,
- pravý panel položek má prioritu na prostor,
- dlouhé texty nesmí rozšiřovat stránku,
- stránka nesmí mít horizontální scroll,
- při nedostatku výšky scrolluje pouze seznam položek,
- obrázky produktů zůstávají, ale škálují se podle hustoty,
- text `Klik = zkontrolovat` byl odstraněn.

Hustota je globální admin nastavení:

- automaticky,
- pohodlné,
- skladové,
- ultra kompaktní.

Frontend používá CSS proměnné, `clamp()`, fluidní gridy, `min-width: 0`, line-clamp a container queries. Při dalších úpravách nevracet pevné minimální šířky, které znovu způsobí horizontální přetečení.

Vizuální testovací rozměry:

- 1280 x 720
- 1366 x 768
- 1500 x 800
- 1600 x 900
- zoom 125 %

## 17. Progress indikátory

- Pokud je známý skutečný počet kroků, zobrazovat `hotovo / celkem` a reálné procento.
- Pokud aplikace čeká na jedinou odpověď serveru, nesmí ukazovat falešná procenta. Zobrazí fázi `Čekám na server` a uplynulý čas.
- Popup se má zobrazit až přibližně po 300 ms, aby krátké operace neblikaly.
- Produktový feed a automatické kontroly používají serverové `operation_jobs` a polling.

`Čekám na server` znamená, že prohlížeč požadavek odeslal, ale server zatím neposlal odpověď. Bez dílčích dat nelze poctivě vypočítat zbývající procenta.

## 18. Testy

### 18.1 Rychlá kontrola syntaxe a diffu

```powershell
python -m py_compile app.py expedition_integrity.py
node --check app.js
git diff --check
```

### 18.2 Backend

```powershell
$env:DATABASE_URL="postgresql://.../expedice_test"
python -m pytest -q
```

Backendové testy jsou v:

- `tests/test_bulk_day_delete.py`
- `tests/test_expedition_editor.py`
- `tests/test_integrity.py`
- `tests/test_post_upload_checks.py`
- `tests/test_warehouse_workbook.py`

### 18.3 Playwright

```powershell
npm run test:e2e
```

Hlavní scénáře:

- `tests/e2e/address-suggestion-actions.spec.js`
- `tests/e2e/bulk-day-delete.spec.js`
- `tests/e2e/completion-quick-actions.spec.js`
- `tests/e2e/post-upload-checks.spec.js`
- `tests/e2e/warehouse.spec.js`
- `tests/e2e/visual.spec.js`

Playwright používá lokální mock server na portu `8123` a Chromium. Nemá měnit produkční data. Přihlašovací údaje nesmí být pevně zapsané v testech.

Ověřený stav:

- backend: poslední plný běh před tímto handoffem měl 30 úspěšných testů; 27. 8. 2026 jej nešlo zopakovat, protože dostupný Codex Python runtime neobsahoval pytest,
- Playwright: 27. 8. 2026 prošlo 23 z 23 testů na commitu `42b66cb`,
- `node --check app.js`: 27. 8. 2026 prošel,
- `git diff --check`: 27. 8. 2026 prošel.

Při prvním Playwright běhu jednou nedorazila mockovaná odpověď ověření výdejního místa. Samostatné opakování i celý následný běh prošly. Pokud by se to opakovalo, prověřit izolaci mocků při dvou workerech.

Po změně prostředí backendový baseline znovu ověřit.

GitHub Actions workflow `.github/workflows/test.yml` používá Python 3.11, Node 22 a PostgreSQL 16 a spouští backend i frontend testy při pushi do `master` a v pull requestech.

## 19. Nasazení a produkční smoke test

Railway je navázaný na `master`. Běžný postup:

```powershell
git status --short
git diff --check
python -m pytest -q
npm run test:e2e
git add <pouze související soubory>
git commit -m "Stručný popis změny"
git push origin master
```

Po pushi:

1. zkontrolovat GitHub Actions,
2. počkat na Railway deploy,
3. ověřit `GET /api/health`,
4. udělat pouze bezpečný read-only smoke test,
5. u změn UI použít `Ctrl+F5` a zkontrolovat relevantní rozlišení.

Produkční test nikdy nemá bez výslovného důvodu:

- odepisovat kusy,
- zakládat zásilky,
- mazat dny,
- měnit nastavení,
- tisknout štítky,
- spouštět dopravní API.

## 20. Poslední důležité commity

```text
42b66cb Support legacy Mapy address suggestions
a68bc86 Add one-click address suggestion actions
32e0dc1 Accept safe one-letter address corrections
d88ff76 Add admin bulk day deletion
217b11f Treat unpaid orders as ready for dispatch
cc9ce59 Ignore pickup issues for existing shipments
dc0bfa7 Restore completion quick actions
37b0067 Show checks action for existing batches
40124c6 Add automatic post-upload checks
2571feb Fix completion edit button hit area
4021216 Redesign completion admin workflow
93b8a40 Add expedition override and shipment workflow APIs
17eea70 Cover employee day selection states
d4faba8 Clear stale batch report after reconnect
a37d566 Clean stabilization test artifacts
d408ff9 Add measurable progress and visual regression suite
4063bf6 Harden print agent V2 diagnostics
bdc9ca9 Add batch diagnostics and audit console
52d1823 Add reversible 90 day audit trail
65fc298 Add immutable batch integrity reports
fd5c45f Add stabilization test foundation
```

## 21. Aktuální rizika a otevřené kontroly

1. `README.md` je zastaralý. Tento handoff je aktuálnější, ale dlouhodobě je vhodné README přepsat na současnou Flask/PostgreSQL aplikaci.
2. `app.py`, `app.js` a `styles.css` jsou velmi velké. Při urgentních provozních změnách dělat malé cílené úpravy. Větší modularizaci provádět po částech s regresními testy.
3. Úlohy na pozadí jsou evidované v DB, ale vykonává je vlákno webového procesu. Restart/deploy je může přerušit. Uživatelské retry je proto důležitá pojistka.
4. Produkční secrets a data nejsou v Gitu. Na jiném PC je potřeba samostatný přístup do Railway/GitHubu a lokální testovací DB.
5. Print Agent je instalace konkrétního Windows PC. Na novém stroji je potřeba V2 znovu nainstalovat a ověřit tiskárny, SumatraPDF a `AllowedOrigins`.
6. Bez podepsaného release certifikátu může antivirus heuristicky varovat i u legitimního agenta. Nepovolovat obecně PowerShell nebo neznámé procesy; výjimku dělat jen pro ověřenou V2 binárku z vlastního release.
7. Nejnovější workflow návrhu Mapy.com je vhodné potvrdit na jedné skutečné problematické adrese po tvrdém reloadu. Kontrolovat, že použití návrhu uloží audit a že konflikt verze chrání novější změnu.
8. Při změnách výpočtů reportu vždy testovat smíšené objednávky s expedičním kódem `>= 2`, protože mohou obsahovat skladové kusy.
9. Při změnách plateb vždy zachovat pravidlo, že nezaplacená objednávka není administrativní error, ale musí správně spustit nezaplacenku při expedici.
10. Při změnách výdejních míst vždy zachovat výjimku pro již existující číslo zásilky/štítek.

## 22. Doporučený první úkol na druhém PC

1. Pullnout aktuální `master` a ověřit, že obsahuje tento handoff.
2. Rozběhnout lokální PostgreSQL, Flask a testy.
3. Spustit celý pytest a Playwright baseline.
4. Otevřít produkci jen read-only a ověřit aktuální frontend přes `Ctrl+F5`.
5. Zkontrolovat poslední rozpracovanou oblast: Mapy.com návrh adresy v editoru, tlačítko pro použití a uložení a tlačítko pro otevření mapy.
6. Teprve potom navázat další funkční změnou.

## 23. Kontrolní seznam před každým pushnutím

- [ ] Změna respektuje české a slovenské znaky.
- [ ] Nebyla přidána tajná hodnota ani reálné heslo.
- [ ] Nebyly stage-nuty nesouvisející lokální soubory.
- [ ] Databázová změna je idempotentní a nedestruktivní.
- [ ] `node --check app.js` prošel.
- [ ] Python syntax a relevantní pytest testy prošly.
- [ ] `git diff --check` prošel.
- [ ] Relevantní UI bylo ověřené v prohlížeči/Playwrightu.
- [ ] U logistických změn byly ověřené okrajové případy množství, EAN, platby a existující zásilky.
- [ ] Commit je úzce zaměřený a pushnutý do `origin/master`.
