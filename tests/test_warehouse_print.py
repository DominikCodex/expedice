from contextlib import contextmanager
import json
import re
from unittest.mock import MagicMock

import app
import pytest


def print_row(quantity="3"):
    return {"productCode": "6002P", "variantCode": "SKU-ČERNÁ", "variant": "černá L/XL",
            "quantity": quantity, "sequence": "1x3, 2x14", "info": "Dámské kalhotky"}


def test_print_upload_is_separate_and_returns_exact_print_link(monkeypatch):
    monkeypatch.setenv("UPLOAD_TOKEN", "test-only-upload-token")
    monkeypatch.setattr(app, "ensure_schema", lambda: None)
    ensure_day = MagicMock()
    monkeypatch.setattr(app, "ensure_expedition_day", ensure_day)
    monkeypatch.setattr(app, "expedition_day_summary", lambda day: day)
    monkeypatch.setattr(app, "dataset_summary", lambda dataset: dataset)
    snapshot = MagicMock()
    checks = MagicMock()
    monkeypatch.setattr(app, "get_or_create_batch_snapshot", snapshot)
    monkeypatch.setattr(app, "enqueue_post_upload_checks", checks)
    cursor = MagicMock()
    cursor.fetchone.return_value = {"id": 71, "datasetKind": "warehouse_print"}
    connection = MagicMock()
    connection.cursor.return_value.__enter__.return_value = cursor

    @contextmanager
    def connection_context():
        yield connection

    monkeypatch.setattr(app, "db_conn", connection_context)
    response = app.app.test_client().post("/api/warehouse/upload-print", json={
        "datasetKind": "warehouse", "rows": [print_row()], "datasetDate": "2026-09-18",
    }, headers={"X-Upload-Token": "test-only-upload-token"})
    assert response.status_code == 200
    assert response.headers["X-Warehouse-Print-Path"] == "/warehouse-print.html?dataset=71"
    assert response.json["printPath"] == response.headers["X-Warehouse-Print-Path"]
    assert cursor.execute.call_args_list[0].args[1][1] == "warehouse_print"
    assert cursor.execute.call_args_list[0].args[1][0] is None
    assert response.json["expeditionDay"] is None
    ensure_day.assert_not_called()
    assert all("UPDATE datasets" not in call.args[0] for call in cursor.execute.call_args_list)
    inserted_row = cursor.execute.call_args_list[1].args[1]
    assert inserted_row[4] == "SKU-ČERNÁ"
    assert inserted_row[7] == 3
    snapshot.assert_not_called()
    checks.assert_not_called()


def test_print_upload_requires_token_or_admin(monkeypatch):
    monkeypatch.delenv("UPLOAD_TOKEN", raising=False)
    monkeypatch.setattr(app, "current_user", lambda: None)
    response = app.app.test_client().post("/api/warehouse/upload-print", json={"datasetKind": "warehouse", "rows": [print_row()]})
    assert response.status_code == 401


def test_invalid_print_quantity_never_reaches_database(monkeypatch):
    monkeypatch.setenv("UPLOAD_TOKEN", "test-only-upload-token")
    monkeypatch.setattr(app, "ensure_schema", lambda: None)
    connection = MagicMock()
    monkeypatch.setattr(app, "db_conn", connection)
    response = app.app.test_client().post("/api/warehouse/upload-print", json={"datasetKind": "warehouse", "rows": [print_row("4")]}, headers={"X-Upload-Token": "test-only-upload-token"})
    assert response.status_code == 400
    connection.assert_not_called()


def rendered_data(response):
    return json.loads(re.search(r'<script id="warehouse-print-data" type="application/json">(.*?)</script>', response.text, re.S).group(1))


def test_anonymous_render_is_self_contained_and_does_not_access_datasets(monkeypatch):
    monkeypatch.setenv("UPLOAD_TOKEN", "private-token")
    database = MagicMock(side_effect=AssertionError("Dataset access is forbidden"))
    monkeypatch.setattr(app, "db_conn", database)
    monkeypatch.setattr(app, "current_user", lambda: None)
    monkeypatch.setattr(app, "product_image_cache", lambda: {"configured": True, "images": {
        "SKU-ČERNÁ": "https://example.invalid/product.jpg",
        "OTHER": "https://example.invalid/private-other.jpg",
        "6002P": "javascript:alert(1)",
    }})
    row = print_row()
    row["info"] = '</script><img src=x onerror=alert(1)> České a slovenské: čřž ľô'
    response = app.app.test_client().post("/api/warehouse/render-print", json={
        "rows": [row], "worksheetName": "Vyskladnění", "datasetId": 123,
    })
    assert response.status_code == 200
    assert response.mimetype == "text/html"
    assert response.headers["Cache-Control"] == "no-store"
    data = rendered_data(response)
    assert data["rows"][0]["info"] == row["info"]
    assert data["dataset"]["worksheetName"] == "Vyskladnění"
    assert data["images"] == {"SKU-ČERNÁ": "https://example.invalid/product.jpg"}
    assert '<script defer src=' not in response.text
    assert '<link rel="stylesheet"' not in response.text
    assert '</script><img src=x' not in response.text
    assert 'size: A4 landscape' in response.text
    database.assert_not_called()


@pytest.mark.parametrize("payload", [None, {}, {"rows": []}, {"rows": [print_row("4")]}, {"rows": [print_row("9" * 400)]}, {"rows": [print_row()] * 1001}])
def test_anonymous_render_rejects_invalid_table_before_image_lookup(monkeypatch, payload):
    cache = MagicMock()
    monkeypatch.setattr(app, "product_image_cache", cache)
    response = app.app.test_client().post("/api/warehouse/render-print", data=json.dumps(payload), content_type="application/json")
    assert response.status_code == 400
    cache.assert_not_called()


def test_anonymous_render_limits_request_size(monkeypatch):
    cache = MagicMock()
    monkeypatch.setattr(app, "product_image_cache", cache)
    response = app.app.test_client().post("/api/warehouse/render-print", data=b" " * (2 * 1024 * 1024 + 1))
    assert response.status_code == 413
    cache.assert_not_called()


def test_anonymous_render_survives_image_service_failure(monkeypatch):
    monkeypatch.setattr(app, "product_image_cache", MagicMock(side_effect=RuntimeError("private-details")))
    response = app.app.test_client().post("/api/warehouse/render-print", json={"rows": [print_row()]})
    assert response.status_code == 200
    data = rendered_data(response)
    assert data["images"] == {}
    assert data["imageWarning"]
    assert "private-details" not in response.text
