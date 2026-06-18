# Expedice Print Agent

Lokální Windows pomocník pro tichý tisk štítků a běžných expedičních dokumentů z webové aplikace.

## Co řeší

Prohlížeč neumí bezpečně tisknout přímo na konkrétní tiskárnu bez dialogu. Print agent běží pouze lokálně na skladovém PC na `127.0.0.1:8787`, přijme PDF z webu a pošle ho na správnou tiskárnu.

## Doporučená instalace bez PowerShellu

Pro sklad je určený samostatný balíček:

```text
ExpedicePrintAgentSetup.exe
```

Stačí stáhnout z webu v `Nastavení -> Lokální tisk` a spustit dvojklikem. Instalátor:

- nainstaluje agenta do `%LOCALAPPDATA%\ExpedicePrintAgent`,
- přibalí `SumatraPDF.exe` pro stabilní tichý tisk,
- vytvoří autostart po spuštění Windows,
- rovnou agenta nastartuje,
- nepotřebuje administrátorská práva,
- nepotřebuje PowerShell,
- nepotřebuje Python na skladovém PC.

Produkční `.exe` balíčky se staví přes GitHub Actions a publikují se do GitHub Release:

```text
https://github.com/DominikCodex/expedice/releases/latest/download/ExpedicePrintAgentSetup.exe
https://github.com/DominikCodex/expedice/releases/latest/download/ExpedicePrintAgentUninstall.exe
```

Nestavět je na skladovém PC. Lokální build používá PyInstaller a antiviry mohou na kombinaci build skriptu, balení EXE a přibaleného PDF nástroje reagovat falešným poplachem.

## Odinstalace / čistá reinstalace bez PowerShellu

Použij:

```text
ExpedicePrintAgentUninstall.exe
```

Odinstalátor ukončí běžícího agenta, smaže autostart a odstraní instalační složku. Pro čisté testování stačí:

1. spustit `ExpedicePrintAgentUninstall.exe`,
2. znovu spustit `ExpedicePrintAgentSetup.exe`.

## Servisní PowerShell varianta

PowerShell skripty zůstávají jen jako záložní servisní cesta pro ruční diagnostiku:

```powershell
.\install.ps1
.\uninstall.ps1
```

Sklad by měl používat primárně `.exe` balíčky.

## Režimy tisku

- `carrier_label` + `dpd` -> `Brother QL-1100`
- `carrier_label` + `packeta` -> `Brother QL-700`
- `default` -> výchozí tiskárna Windows, případně tiskárna `defaultDocument` v konfiguraci

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

## Build balíčku

Primárně se build spouští v GitHub Actions (`Build print agent`). Ručně na vývojovém Windows PC jen když je potřeba:

```powershell
python .\print-agent\build_agent.py
```

Build vytvoří:

- `dist\ExpedicePrintAgent.exe`,
- `ExpedicePrintAgentSetup.exe`,
- `ExpedicePrintAgentUninstall.exe`.

Soubor `ExpedicePrintAgentSetup.exe` obsahuje agenta i SumatraPDF, takže instalace na skladovém PC už nic dalšího nestahuje.
