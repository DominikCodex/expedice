"""Pure helpers for expedition batch snapshots and integrity checks."""

from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
import re
import unicodedata


KNOWN_ORDER_CODES = {"0.8", "1", "1.5", "1.8", "1.9", "2", "3", "4", "5", "6", "7", "8"}


def text(value):
    return "" if value is None else str(value).strip()


def integer(value, default=0):
    match = re.search(r"-?\d+(?:[.,]\d+)?", text(value))
    if not match:
        return default
    try:
        return int(Decimal(match.group(0).replace(",", ".")))
    except (InvalidOperation, ValueError):
        return default


def normalized(value):
    value = unicodedata.normalize("NFKD", text(value))
    return "".join(char for char in value if not unicodedata.combining(char)).casefold()


def normalized_code(value):
    return re.sub(r"[^a-z0-9]", "", normalized(value))


def order_code(value):
    raw = text(value).replace(",", ".")
    try:
        number = Decimal(raw)
    except InvalidOperation:
        return raw
    normalized_number = format(number.normalize(), "f")
    return normalized_number.rstrip("0").rstrip(".") if "." in normalized_number else normalized_number


def completion_quantity(row):
    return max(0, integer(row.get("quantity") or row.get("quantity_text"), 0))


def sorting_initial(row):
    return max(
        0,
        integer(
            row.get("initialQuantity")
            or row.get("initial_quantity_text")
            or row.get("quantity")
            or row.get("quantity_text"),
            0,
        ),
    )


def sorting_remaining(row):
    return integer(row.get("remaining"), 0)


def flow_kind(row):
    code = order_code(row.get("expeditionOrderCode") or row.get("expedition_order_code"))
    try:
        value = Decimal(code)
    except InvalidOperation:
        return "unknown"
    if value < 2:
        return "stock"
    if value <= 7:
        return "sorting"
    if value == 8:
        return "error"
    return "unknown"


def address_has_error(row):
    status = normalized(row.get("addressValidationStatus") or row.get("address_validation_status"))
    return any(marker in status for marker in ("error", "chyba", "invalid", "nenalezen"))


def payment_needs_attention(row):
    status = normalized(row.get("paidStatus") or row.get("paid_status"))
    completion_status = normalized(row.get("completionStatus") or row.get("completion_status"))
    return any(marker in status or marker in completion_status for marker in ("nezaplac", "unpaid", "error"))


def code_ranges(rows):
    items = []
    for row in rows:
        number = integer(row.get("expeditionNumber") or row.get("expedition_number"), 0)
        if number > 0:
            items.append((number, order_code(row.get("expeditionOrderCode") or row.get("expedition_order_code"))))
    items.sort()
    ranges = []
    for number, code in items:
        if ranges and ranges[-1]["code"] == code and ranges[-1]["end"] + 1 == number:
            ranges[-1]["end"] = number
            ranges[-1]["count"] += 1
        else:
            ranges.append({"start": number, "end": number, "code": code, "count": 1})
    return ranges


def build_batch_snapshot(completion_rows, sorting_rows):
    completion_rows = list(completion_rows or [])
    sorting_rows = list(sorting_rows or [])
    sorting_by_order = defaultdict(int)
    for row in sorting_rows:
        sorting_by_order[text(row.get("orderNumber") or row.get("order_number"))] += sorting_initial(row)

    stock_orders = 0
    stock_pieces = 0
    for row in completion_rows:
        quantity = completion_quantity(row)
        kind = flow_kind(row)
        if kind == "stock":
            stock_orders += 1
            stock_pieces += quantity
        elif kind == "sorting":
            order = text(row.get("orderNumber") or row.get("order_number"))
            stock_pieces += max(0, quantity - sorting_by_order.get(order, 0))

    orders = {text(row.get("orderNumber") or row.get("order_number")) for row in completion_rows}
    orders.discard("")
    return {
        "orders": len(orders),
        "pieces": sum(completion_quantity(row) for row in completion_rows),
        "stockOrders": stock_orders,
        "stockPieces": stock_pieces,
        "addressErrors": sum(1 for row in completion_rows if address_has_error(row)),
        "paymentWarnings": sum(1 for row in completion_rows if payment_needs_attention(row)),
        "codeRanges": code_ranges(completion_rows),
        "completionRows": len(completion_rows),
        "sortingRows": len(sorting_rows),
        "sortingInitialPieces": sum(sorting_initial(row) for row in sorting_rows),
    }


def _issue(severity, code, message, **context):
    return {"severity": severity, "code": code, "message": message, "context": context}


def _ean_entries(ean_map):
    for ean, raw_entries in (ean_map or {}).items():
        entries = raw_entries if isinstance(raw_entries, list) else [raw_entries]
        variants = set()
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            variant = normalized_code(entry.get("variantCode") or entry.get("code") or entry.get("sku"))
            if variant:
                variants.add(variant)
        if len(variants) > 1:
            yield text(ean), sorted(variants)


def assess_integrity(completion_rows, sorting_rows, ean_map=None):
    completion_rows = list(completion_rows or [])
    sorting_rows = list(sorting_rows or [])
    issues = []

    expedition_numbers = []
    completion_orders = set()
    for row in completion_rows:
        order = text(row.get("orderNumber") or row.get("order_number"))
        if order:
            completion_orders.add(order)
        number = integer(row.get("expeditionNumber") or row.get("expedition_number"), 0)
        if number <= 0:
            issues.append(_issue("error", "missing_expedition_number", "Objednávce chybí expediční číslo.", orderNumber=order))
        else:
            expedition_numbers.append(number)
        code = order_code(row.get("expeditionOrderCode") or row.get("expedition_order_code"))
        if code not in KNOWN_ORDER_CODES:
            issues.append(_issue("warning", "unknown_order_code", "Objednávka používá neznámý kód pořadí.", orderNumber=order, orderCode=code))

    for number, count in Counter(expedition_numbers).items():
        if count > 1:
            issues.append(_issue("error", "duplicate_expedition_number", "Expediční číslo je v dávce použito vícekrát.", expeditionNumber=number, count=count))

    sorting_orders = defaultdict(list)
    for row in sorting_rows:
        order = text(row.get("orderNumber") or row.get("order_number"))
        sorting_orders[order].append(row)
        initial = sorting_initial(row)
        remaining = sorting_remaining(row)
        if remaining < 0 or remaining > initial:
            issues.append(
                _issue(
                    "error",
                    "invalid_remaining",
                    "Zbývající množství je mimo povolený rozsah.",
                    orderNumber=order,
                    variantCode=text(row.get("variantCode") or row.get("variant_code")),
                    initial=initial,
                    remaining=remaining,
                )
            )
        if order and order not in completion_orders:
            issues.append(_issue("warning", "sorting_order_missing", "Řádek roztřídění nemá odpovídající objednávku v kompletaci.", orderNumber=order))

    for row in completion_rows:
        if flow_kind(row) != "sorting":
            continue
        order = text(row.get("orderNumber") or row.get("order_number"))
        if order and not sorting_orders.get(order):
            issues.append(_issue("error", "missing_sorting_rows", "Objednávka určená k roztřídění nemá žádné řádky v aktivní dávce.", orderNumber=order))

    for ean, variants in _ean_entries(ean_map):
        issues.append(_issue("error", "ambiguous_ean", "EAN odkazuje na více rozdílných variant.", ean=ean, variants=variants))

    counts = Counter(issue["severity"] for issue in issues)
    return {
        "ok": counts["error"] == 0,
        "summary": {"errors": counts["error"], "warnings": counts["warning"], "info": counts["info"]},
        "issues": issues,
    }


def completion_variant_quantities(row):
    raw = row.get("raw") or row.get("raw_row") or {}
    quantities = defaultdict(int)
    array_keys = ("items", "products", "productItems", "product_items", "orderProducts", "order_items", "goods", "zbozi", "zboží")
    if isinstance(raw, dict):
        for key in array_keys:
            values = raw.get(key)
            if not isinstance(values, list):
                continue
            for item in values:
                if not isinstance(item, dict):
                    continue
                code = item.get("variantCode") or item.get("productCode") or item.get("sku") or item.get("code") or item.get("kod") or item.get("kód")
                quantity = item.get("quantity") or item.get("quantityText") or item.get("mnozstvi") or item.get("množství") or item.get("pocet") or item.get("počet") or item.get("ks")
                key_code = normalized_code(code)
                if key_code:
                    quantities[key_code] += max(1, integer(quantity, 1))
            if quantities:
                return dict(quantities)

    values = []
    if isinstance(raw, dict):
        values.extend(value for value in raw.values() if isinstance(value, str))
    values.extend(value for value in (row.get("cells") or []) if isinstance(value, str))
    pattern = re.compile(r"^([A-Z0-9][A-Z0-9-]{2,})\s+.+?\s+(\d+)\s*(?:x|ks)\s+.+$", re.IGNORECASE)
    for value in values:
        for line in re.split(r"\r?\n| {3,}|\t+", value):
            match = pattern.match(line.strip().removeprefix("ERROR:").strip())
            if match:
                quantities[normalized_code(match.group(1))] += max(1, integer(match.group(2), 1))
    return dict(quantities)


def compare_order_variants(completion_row, sorting_rows):
    expected = completion_variant_quantities(completion_row or {})
    actual = defaultdict(lambda: {"initial": 0, "remaining": 0, "label": ""})
    for row in sorting_rows or []:
        label = text(row.get("variantCode") or row.get("variant_code") or row.get("productCode") or row.get("product_code"))
        key = normalized_code(label)
        if not key:
            continue
        actual[key]["label"] = label
        actual[key]["initial"] += sorting_initial(row)
        actual[key]["remaining"] += max(0, sorting_remaining(row))

    keys = sorted(set(expected) | set(actual))
    comparisons = []
    for key in keys:
        expected_quantity = expected.get(key)
        actual_quantity = actual[key]["initial"] if key in actual else 0
        comparisons.append(
            {
                "variantKey": key,
                "variantCode": actual[key]["label"] if key in actual else key.upper(),
                "expected": expected_quantity,
                "sortingInitial": actual_quantity,
                "sortingRemaining": actual[key]["remaining"] if key in actual else 0,
                "matches": expected_quantity is None or expected_quantity == actual_quantity,
            }
        )
    return {
        "hasExpectedVariants": bool(expected),
        "matches": all(item["matches"] for item in comparisons),
        "items": comparisons,
    }
