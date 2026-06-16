# Expediční rozhraní (MVP)

Toto je lokální jednoduché webové rozhraní, které nahrazuje tabulkový proces pro:

- příjem dorazivšího zboží,
- rozřazování do zón skladu,
- vytvoření a odeslání expedic.

## Jak spustit

1. Otevři složku `Expedice Excel`.
2. Spusť jednoduše:
   - dvojklikem na `index.html`, nebo
   - lokálním serverem:  
     `python -m http.server` a v prohlížeči otevři `http://localhost:8000`.
3. První spuštění je prázdný, data se ukládají do `localStorage` (prohlížeč).

## Co umí

- Přidávání příjmu položek (dodavatel, dodací list, sku, název, množství, očekávané místo).
- Rozřazení položek do zón A–E.
- Vytvoření expedice z rozřazených položek.
- Označení expedice jako odeslaná.
- Export celého stavu do JSON a opětovný import.

## Poznámky

- Toto je MVP pro rychlé nahrazení Excelu.
- Pro spolupráci více lidí je vhodné doplnit backend a autentifikaci.
