from contextlib import contextmanager
from unittest.mock import MagicMock

import app


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
