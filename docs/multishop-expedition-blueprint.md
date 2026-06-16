# Multi-shop expedition blueprint

Tento dokument je predpriprava smeru, aby se aktualni Excel workflow dalo postupne nahradit online systemem na Railway/Postgres.

## Cile

- Jeden expedicni system pro iVeronika.cz, iVeronika.sk, Galantra.cz, Fidule.cz a dalsi budouci e-shopy.
- Excel zustane docasne jako upload/download most, ale nebude dlouhodobe hlavni databaze.
- Kazda davka ma datum, cas, typ, e-shop a stav.
- Kazdy radek muze mit vlastni `shop_code`, protoze jedna sloucena davka muze obsahovat vice e-shopu.
- Kouzla typu `KOMPLETACE` sloupec 18 se postupne nahradi citelnymi stavy.

## Zakladni entity

### shops

Konfigurace e-shopu. Novy e-shop ma byt konfigurace, ne prepis kodu.

- `code`: stabilni kod, napr. `iveronika_cz`, `fidule_cz`
- `name`: lidsky nazev
- `domain`: domena e-shopu
- `currency`: vychozi mena
- `country`: vychozi zeme
- `order_prefixes`: prefixy objednavek pro zpetnou kompatibilitu s Excelem
- `source_system`: napr. `shoptet`

### datasets

Uploadovana davka z Excelu nebo pozdeji z API.

- `dataset_kind`: `sorting` nebo `completion`
- `shop_code`: e-shop davky, pripadne `mixed`
- `dataset_date` a `dataset_time`: konkretni verze dat pro prepinani ve skladu
- `status`: `active` nebo `deleted`
- `raw_payload`: puvodni JSON pro audit a snazsi ladeni

### dataset_rows

Online obdoba listu `EXCEL`, tedy rozrazovani zbozi.

- kody produktu a varianty
- EAN doplneny pozdeji pres katalog
- mnozstvi/zbyva
- cislo objednavky
- poradove cislo
- `shop_code`

### completion_rows

Online obdoba listu `KOMPLETACE`.

- zakaznik
- doprava
- platba
- dobirka
- expedicni poradi
- stav stitku
- `shop_code`

### stock_sources

Jednotny seznam zdroju zbozi.

- `own_stock`
- `galantra_stock`
- `milpex`
- `hotex`
- `manual`
- `unknown`

### audit_events

Pripraveno pro pozdejsi audit.

- kdo
- kdy
- nad jakou davkou/objednavkou/radkem
- jaky payload zmeny

## Prvni podporovane API

- `GET /api/shops`
- `GET /api/stock-sources`
- `GET /api/expedition/overview`
- `GET /api/datasets?shop=fidule_cz`
- `GET /api/datasets?date=2026-06-17`

## Migracni princip

1. Excel uploaduje stejne jako dnes.
2. Pokud VBA neposle `shopCode`, backend ho zkusi odhadnout podle prefixu objednavky.
3. Pokud je v jedne davce vice e-shopu, davka dostane `shopCode = mixed`, ale jednotlive radky maji svuj vlastni `shopCode`.
4. Az budeme pripraveni, VBA zacne posilat `shopCode` explicitne.
5. Pozdeji Shoptet API nahradi Excel upload.

## Budouci cile

- `allocation` tabulka: rozhodnuti, odkud se ma polozka vzit.
- `pick_list` tabulka: online nahrada `VYSKLADNI`.
- `supplier_order_rows`: online nahrada objednavky Hotex/Milpex.
- frontend filtr podle e-shopu, data/casu a zdroje.
- kompletacni userform jako webova obrazovka.
