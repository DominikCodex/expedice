from io import BytesIO

import pytest
from openpyxl import Workbook

import app


def workbook_bytes(rows, headers=None):
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Vyskladnění"
    worksheet.append(headers or [" ", "Kód varianty:", "Varianta:", "Kolik a kam s tím:", "Celk.:", None])
    for row in rows:
        worksheet.append(row)
    output = BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def test_parse_warehouse_workbook_preserves_czech_and_allocations():
    content = workbook_bytes(
        [
            [
                "6002P",
                "6002-HOLLAND-LXL-CERNA",
                "Velikost: L/XL, Barva: černá",
                "1x3, 2×14",
                3,
                "Dámské kalhotky s vyšším pasem",
            ],
            ["GBTWP", "GBTW-3109-SM-TELOVA", "tělová / S/M", "1x6", 1, "Bambusové boxerky"],
        ]
    )

    parsed = app.parse_warehouse_workbook(content)

    assert parsed["worksheetName"] == "Vyskladnění"
    assert parsed["pieces"] == 4
    assert parsed["destinations"] == [3, 6, 14]
    assert parsed["rows"][0]["variant"] == "Velikost: L/XL, Barva: černá"
    assert parsed["rows"][0]["allocations"] == [
        {"quantity": 1, "destination": 3},
        {"quantity": 2, "destination": 14},
    ]


def test_parse_warehouse_workbook_rejects_quantity_mismatch():
    content = workbook_bytes([["6002P", "SKU-1", "černá / L", "1x3, 1x4", 3, "Produkt"]])

    with pytest.raises(app.WarehouseWorkbookError, match="rozdělení dává 2 ks"):
        app.parse_warehouse_workbook(content)


def test_parse_warehouse_workbook_rejects_wrong_headers():
    content = workbook_bytes(
        [["6002P", "SKU-1", "černá / L", "1x3", 1, "Produkt"]],
        headers=["Produkt", "SKU", "Varianta", "Rozdělení", "Množství", "Název"],
    )

    with pytest.raises(app.WarehouseWorkbookError, match="očekávané sloupce"):
        app.parse_warehouse_workbook(content)
