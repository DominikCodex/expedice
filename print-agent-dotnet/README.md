# Expedice Print Agent V2 (.NET)

Nova paralelni verze lokalniho tiskoveho agenta napsana v C#/.NET.

## Proc V2

V1 agent zustava k dispozici a funguje dal. V2 je pripravena kvuli lepsi duveryhodnosti pro Windows/antiviry, protoze nepouziva PyInstaller.

## Instalace

Stahnout:

```text
ExpedicePrintAgentV2Setup.exe
```

Dvojklik:

- zkopiruje se do `%LOCALAPPDATA%\ExpedicePrintAgentV2`,
- vytvori konfiguraci v `%APPDATA%\ExpedicePrintAgentV2\config.json`,
- prida autostart pres `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
- spusti server na `127.0.0.1:8787`.

## Odinstalace

Stahnout a spustit:

```text
ExpedicePrintAgentV2Uninstall.exe
```

## API kompatibilita

V2 zachovava stejne endpointy jako V1:

- `GET /health`
- `GET /printers`
- `POST /print`

Webova aplikace tak nemusi poznat, jestli bezi V1 nebo V2.

## Poznamka k V1

V1 a V2 nepoustet soucasne. Oba pouzivaji stejny port `8787`.
