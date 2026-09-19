"""Summary of caller-supplied Excel data for the standalone picking printout."""

from collections import Counter
from decimal import Decimal, InvalidOperation
import unicodedata
import re


def _text(value):
    return str(value or "").strip()


def _header(value):
    return "".join(c for c in unicodedata.normalize("NFKD", _text(value)).lower() if c.isalnum())


def _number(value):
    if not re.fullmatch(r"\d{1,9}(?:[.,]\d{1,6})?", _text(value)):
        return None
    try:
        result = Decimal(_text(value).replace(",", "."))
        return result if result.is_finite() and result >= 0 else None
    except InvalidOperation:
        return None


def build_print_report(rows, helpers, labels):
    cells = helpers.get("KOMPLETACE", {}).get("cells", [])
    if not cells or len(cells[0]) < 18:
        return None
    expected = {11: "objednavka", 14: "mnozstvi", 16: "expedicnicislo", 17: "kodporadiexpedice"}
    if any(_header(cells[0][column]) != name for column, name in expected.items()):
        return None
    orders = [row for row in cells[1:] if _text(row[11])]
    if not orders:
        return None
    quantities = [_number(row[14]) for row in orders]
    codes = [_number(row[17]) for row in orders]
    boxes = [_number(row[16]) for row in orders]
    valid_box = lambda box: box is not None and box > 0 and box == int(box)
    duplicates = {box for box, count in Counter(boxes).items() if valid_box(box) and count > 1}
    missing_boxes = sum(not valid_box(box) for box in boxes)
    warnings = []
    if missing_boxes:
        warnings.append(f"Bez platného čísla boxu: {missing_boxes} objednávek.")
    if duplicates:
        warnings.append("Duplicitní čísla boxů; nejednoznačné boxy nejsou v rozpisu.")
    valid_quantities = all(q is not None and q == int(q) for q in quantities)
    if not valid_quantities:
        warnings.append("Celkový počet kusů nelze určit: chybí platné množství v KOMPLETACI.")
    known_codes = all(code is not None and str(code.normalize()) in labels for code in codes)
    if not known_codes:
        warnings.append("Některé objednávky mají neurčený způsob expedice.")
    ranges = []
    for box, code in sorted(((int(box), code) for box, code in zip(boxes, codes)
                             if valid_box(box) and box not in duplicates), key=lambda item: item[0]):
        code_text = format(code.normalize(), "f") if code is not None else ""
        if ranges and ranges[-1]["code"] == code_text and ranges[-1]["end"] + 1 == box:
            ranges[-1]["end"] = box
        else:
            ranges.append({"start": box, "end": box, "code": code_text,
                           "label": labels.get(code_text, "Neurčený způsob expedice"),
                           "priority": code == Decimal("0.8")})
    # The picking sheet contains stock pieces, including pieces in mixed orders.
    # Never infer this total from the expedition code or mutable sorting quantities.
    return {
        "orders": len(orders),
        "pieces": int(sum(quantities)) if valid_quantities else None,
        "stockOrders": sum(code < 2 for code in codes) if known_codes else None,
        "stockPieces": sum(int(row["initialQuantity"]) for row in rows),
        "ranges": ranges,
        "warnings": warnings,
    }
