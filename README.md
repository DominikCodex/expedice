# Rozřazování zboží

První MVP rozhraní nahrazuje rozřazovací UserForm z Excelu.

## Spuštění

Otevři `index.html` v prohlížeči.

Data se ukládají lokálně v prohlížeči. Pro přenos nebo zálohu použij tlačítka `Export` a `Import`.

## Aktuální funkce

- Seed dat z dodaných souborů `zboží k rozřazení.xlsx` a `eany.xlsx`.
- EAN vstup pro skener.
- Automatický odpis 1 ks u jednoznačné EAN shody.
- Výběr kandidátů u vícenásobné EAN shody.
- Ruční hledání podle objednávky, kódu, varianty, značky, názvu nebo obrázku.
- Odpis `-1` a navrácení `+1` přes explicitní tlačítka.
- Historie posledních odpisů včetně vrácení.
- Přepínač zobrazení nulových položek a obrázkových názvů.

## Poznámka k Excelu

Soubor `seed-data.js` je vygenerovaný z aktuálních ukázkových Excelů. Další krok bude udělat přímý import `.xlsx`, aby nebylo nutné seed generovat ručně.

## Railway API

Backend je ve `app.py` a Railway ho spouští přes `Procfile`.

Railway proměnné:

- `DATABASE_URL` - dodá Railway Postgres plugin
- `UPLOAD_TOKEN` - volitelný token pro upload a mazání dávek
- `DOWNLOAD_TOKEN` - volitelný token pro stahování dat

Pokud tokeny nejsou nastavené, API je otevřené bez autentizace.

Endpointy:

- `POST /api/datasets/upload` - upload nové dávky z Excelu
- `GET /api/datasets` - seznam aktivních dávek
- `GET /api/datasets?kind=sorting` - seznam dávek roztřídění
- `GET /api/datasets?kind=completion` - seznam dávek kompletace/expedice
- `GET /api/datasets?includeDeleted=1` - seznam včetně smazaných
- `GET /api/datasets/latest` - poslední aktivní dávka
- `GET /api/datasets/:id` - konkrétní dávka
- `GET /api/completion/datasets` - seznam dávek kompletace/expedice
- `GET /api/completion/latest` - poslední dávka kompletace/expedice
- `DELETE /api/datasets/:id` - měkké smazání dávky
- `POST /api/datasets/:id/restore` - obnovení dávky
- `GET /api/excel/datasets.csv` - seznam dávek pro Excel
- `GET /api/excel/dataset.csv?id=123` - konkrétní dávka pro Excel
- `GET /api/excel/completion.csv?id=123` - konkrétní dávka kompletace pro Excel

## VBA upload do Railway API

VBA modul je v `vba/UploadRoztrideniZbozi.bas`. Je pripraveny bez `Option Explicit` a bez `Attribute VB_Name`, aby sel snadneji vlozit do existujiciho makro sesitu.

Pro rucni testovani v jednom existujicim VBA modulu je nejjednodussi pouzit jeden soubor:

```text
vba/ExpediceUploadJedenSkript.bas
```

Obsahuje upload roztřídění i kompletace v jednom paste-in skriptu.

V horní části modulu můžeš nastavit:

- `UPLOAD_TOKEN`, pokud bude Railway proměnná `UPLOAD_TOKEN` aktivní
- `SHEET_NAME`, pokud se list nebude jmenovat `EXCEL`

Makro pro tlačítko:

```vb
UploadRoztrideniAktualniTabulky
```

Upload jde na:

```text
https://expedice-production.up.railway.app/api/datasets/upload
```

Upload vytvoří novou datovou dávku s dnešním datem a přesným časem, takže jeden den může mít více verzí.

## VBA upload KOMPLETACE

VBA modul pro expediční list je v `vba/UploadKompletace.bas`.

Makro pro tlačítko nebo konec expedičního UserForm workflow:

```vb
UploadKompletaceAktualniTabulky
```

Uploaduje list `KOMPLETACE` jako dávku typu `completion`, včetně zákaznických údajů, dopravy, platby, expedičního pořadí, Zásilkovny/DPD, stavu kompletace a příznaku vytištěného štítku.
