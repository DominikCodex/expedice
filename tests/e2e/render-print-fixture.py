"""Generate the same standalone HTML returned to Excel, without production access."""
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import app

fixture = os.environ.get("WAREHOUSE_PRINT_FIXTURE")
rows = json.loads(Path(fixture).read_text(encoding="utf-8-sig")) if fixture else [
    {"productCode": "6002P", "variantCode": f"SKU-{i:03d}-ČERNÁ", "variant": "černá L/XL",
     "info": "Dámské kalhotky ľô", "quantity": "3", "sequence": "1x3, 2x14"}
    for i in range(45)
]
completion_header = [""] * 18
completion_header[0:2] = ["Objednávka", "Poznámka"]
completion_header[16:18] = ["Expediční číslo", "Kód pořadí expedice"]
completion_header[11], completion_header[14] = "Objednávka:", "Množství:"
box_pieces = {}
for row in app.normalize_warehouse_print_rows(rows):
    for item in row["allocations"]:
        box = item["destination"]
        box_pieces[box] = box_pieces.get(box, 0) + item["quantity"]
completion_rows = []
for box, pieces in sorted(box_pieces.items()):
    row = [""] * 18
    row[0:2] = ["00123", "TEST-NEZOBRAZOVAT-ľô</script><script>window.helperExecuted=true</script>"]
    row[11], row[14] = f"TEST-{box}", str(pieces)
    row[16:18] = [str(box), "0,8" if box == 3 else "1" if box < 8 else "3" if box < 18 else "7"]
    completion_rows.append(row)
with patch.object(app, "product_image_cache", return_value={"configured": True, "images": {}}), \
     patch.object(app, "db_conn", side_effect=AssertionError("No database allowed")):
    response = app.app.test_client().post("/api/warehouse/render-print", json={
        "rows": rows, "worksheetName": "Vyskladnění", "datasetDate": "2026-09-18", "datasetTime": "08:30",
        "workbookFolderName": "Neděle 20. 9. 2026 - ľô",
        "helperSheets": {
            "EXCEL": {"cells": [["Kód varianty", "Produkt"], ["SKU-ČERNÁ", "TEST-POMOCNY-PRODUKT"]]},
            "KOMPLETACE": {"cells": [completion_header, *completion_rows]},
        },
    })
assert response.status_code == 200, response.text
Path(sys.argv[1]).write_bytes(response.data)
