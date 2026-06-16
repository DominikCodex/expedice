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
- Odpis `-1`, navrácení `+1` a dvojklik na řádek pro rychlý odpis.
- Historie posledních odpisů včetně vrácení.
- Přepínač zobrazení nulových položek a obrázkových názvů.

## Poznámka k Excelu

Soubor `seed-data.js` je vygenerovaný z aktuálních ukázkových Excelů. Další krok bude udělat přímý import `.xlsx`, aby nebylo nutné seed generovat ručně.
