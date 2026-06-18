# Expedice Print Agent

Lokální Windows pomocník pro tichý tisk štítků a běžných expedičních dokumentů z webové aplikace.

## Co řeší

Prohlížeč neumí bezpečně tisknout přímo na konkrétní tiskárnu bez dialogu. Print agent běží pouze lokálně na skladovém PC na `127.0.0.1:8787`, přijme PDF z webu a pošle ho na správnou tiskárnu.

## Režimy tisku

- `carrier_label` + `dpd` -> `Brother QL-1100`
- `carrier_label` + `packeta` -> `Brother QL-700`
- `default` -> výchozí tiskárna Windows, případně tiskárna `defaultDocument` v konfiguraci

## Instalace V1

Na skladovém PC spustit PowerShell:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\install.ps1
```

## Odinstalace / cista reinstalace

Odinstalace ukonci beziciho agenta, smaze autostart a odstrani instalacni slozku:

```powershell
.\uninstall.ps1
```

Ponechat konfiguraci tiskaren pro dalsi instalaci:

```powershell
.\uninstall.ps1 -KeepConfig
```

Cisty reinstall pro testovani:

```powershell
.\uninstall.ps1
.\install.ps1
```

V1 počítá s nainstalovaným Pythonem (`py -3`). Produkční balíček bude později přes `ExpedicePrintAgentSetup.exe`.

Instalace už řeší SumatraPDF:

- Pokud existuje `print-agent\bin\SumatraPDF.exe`, zkopíruje ji do instalace.
- Pokud tam není, stáhne oficiální portable ZIP `SumatraPDF 3.6.1 64-bit` ze SumatraPDF webu.
- Pokud stažení selže, agent se i tak nainstaluje a použije Windows tiskový fallback.

## Doporučený tisk PDF

Agent nejdříve hledá `SumatraPDF.exe`, protože umí stabilní tichý tisk:

```powershell
SumatraPDF.exe -print-to "Brother QL-1100" -silent label.pdf
```

Instalátor ji ukládá sem:

```text
%LOCALAPPDATA%\ExpedicePrintAgent\bin\SumatraPDF.exe
```

Pokud Sumatra není dostupná, agent použije Windows `ShellExecute print/printto`, podobně jako původní VBA.

## Konfigurace

Soubor:

```text
%APPDATA%\ExpedicePrintAgent\config.json
```

Výchozí hodnoty:

```json
{
  "port": 8787,
  "printers": {
    "dpdLabel": "Brother QL-1100",
    "packetaLabel": "Brother QL-700",
    "defaultDocument": ""
  },
  "sumatraPath": "",
  "keepPrintedFiles": false
}
```

Když je `defaultDocument` prázdné, běžné dokumenty jdou na výchozí tiskárnu Windows.

## API

Health check:

```http
GET http://127.0.0.1:8787/health
```

Seznam tiskáren:

```http
GET http://127.0.0.1:8787/printers
```

Tisk:

```http
POST http://127.0.0.1:8787/print
Content-Type: application/json

{
  "type": "carrier_label",
  "carrier": "dpd",
  "filename": "12345678901234.pdf",
  "contentBase64": "...",
  "copies": 1
}
```

## Produkční další krok

- Zabalit přes `build.ps1` do `.exe`.
- Přibalit SumatraPDF portable přímo do produkčního instalátoru, aby nebyl potřeba download při instalaci.
- Vytvořit Inno Setup instalátor.
- Přidat auto-update z Railway.
