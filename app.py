import csv
import io
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg2
from psycopg2.extras import Json, RealDictCursor
from flask import Flask, Response, jsonify, request, send_from_directory


APP_DIR = os.path.dirname(os.path.abspath(__file__))
PRAGUE_TZ = ZoneInfo("Europe/Prague")

app = Flask(__name__, static_folder=None)


def database_url():
    return os.environ.get("DATABASE_URL", "")


def db_conn():
    url = database_url()
    if not url:
        raise RuntimeError("DATABASE_URL is not configured")
    return psycopg2.connect(url)


def ensure_schema():
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS datasets (
                    id BIGSERIAL PRIMARY KEY,
                    dataset_date DATE NOT NULL,
                    dataset_time TIME NOT NULL,
                    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    uploaded_at_local TEXT,
                    label TEXT NOT NULL,
                    source TEXT,
                    workbook_name TEXT,
                    worksheet_name TEXT,
                    source_filename TEXT,
                    rows_count INTEGER NOT NULL DEFAULT 0,
                    headers JSONB NOT NULL DEFAULT '[]'::jsonb,
                    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    status TEXT NOT NULL DEFAULT 'active',
                    deleted_at TIMESTAMPTZ,
                    deleted_by TEXT,
                    delete_reason TEXT
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS dataset_rows (
                    id BIGSERIAL PRIMARY KEY,
                    dataset_id BIGINT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
                    row_number INTEGER,
                    product_code TEXT,
                    variant_code TEXT,
                    variant TEXT,
                    quantity_text TEXT,
                    remaining INTEGER NOT NULL DEFAULT 0,
                    order_number TEXT,
                    weight TEXT,
                    sequence TEXT,
                    info TEXT,
                    initial_quantity_text TEXT,
                    paircode TEXT,
                    history TEXT,
                    cells JSONB NOT NULL DEFAULT '[]'::jsonb,
                    raw_row JSONB NOT NULL DEFAULT '{}'::jsonb
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_datasets_uploaded_at
                ON datasets (uploaded_at DESC)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_dataset_rows_dataset_id
                ON dataset_rows (dataset_id)
                """
            )


def require_upload_token():
    expected = os.environ.get("UPLOAD_TOKEN", "")
    if not expected:
        return jsonify({"error": "UPLOAD_TOKEN is not configured"}), 500

    provided = request.headers.get("X-Upload-Token") or request.args.get("token")
    if provided != expected:
        return jsonify({"error": "Unauthorized"}), 401

    return None


def require_download_token_if_configured():
    expected = os.environ.get("DOWNLOAD_TOKEN", "")
    if not expected:
        return None

    provided = request.headers.get("X-Download-Token") or request.args.get("token")
    if provided != expected:
        return jsonify({"error": "Unauthorized"}), 401

    return None


def local_now():
    return datetime.now(PRAGUE_TZ)


def clean_text(value):
    if value is None:
        return ""
    return str(value)


def int_from_text(value):
    text = clean_text(value).strip().replace(",", ".")
    if not text:
        return 0
    try:
        return int(float(text))
    except ValueError:
        return 0


def payload_date_time(payload):
    now = local_now()
    dataset_date = clean_text(payload.get("datasetDate")) or now.strftime("%Y-%m-%d")
    dataset_time = clean_text(payload.get("datasetTime")) or now.strftime("%H:%M:%S")
    label = clean_text(payload.get("label")) or f"{dataset_date} {dataset_time}"
    return dataset_date, dataset_time, label


def dataset_summary(row):
    return {
        "id": row["id"],
        "datasetDate": row["dataset_date"].isoformat(),
        "datasetTime": str(row["dataset_time"]),
        "uploadedAt": row["uploaded_at"].isoformat(),
        "uploadedAtLocal": row["uploaded_at_local"],
        "label": row["label"],
        "source": row["source"],
        "workbookName": row["workbook_name"],
        "worksheetName": row["worksheet_name"],
        "sourceFilename": row["source_filename"],
        "rowsCount": row["rows_count"],
        "status": row["status"],
        "deletedAt": row["deleted_at"].isoformat() if row["deleted_at"] else None,
    }


def row_to_api(row):
    return {
        "id": row["id"],
        "rowNumber": row["row_number"],
        "productCode": row["product_code"],
        "variantCode": row["variant_code"],
        "variant": row["variant"],
        "quantity": row["quantity_text"],
        "remaining": row["remaining"],
        "orderNumber": row["order_number"],
        "weight": row["weight"],
        "sequence": row["sequence"],
        "info": row["info"],
        "initialQuantity": row["initial_quantity_text"],
        "paircode": row["paircode"],
        "history": row["history"],
        "cells": row["cells"],
        "raw": row["raw_row"],
    }


@app.route("/")
def index():
    return send_from_directory(APP_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    if path.startswith("api/"):
        return jsonify({"error": "Not found"}), 404
    return send_from_directory(APP_DIR, path)


@app.route("/api/health")
def health():
    try:
        ensure_schema()
        db_ok = True
    except Exception as exc:
        return jsonify({"ok": False, "database": False, "error": str(exc)}), 500

    return jsonify({"ok": True, "database": db_ok})


@app.route("/api/datasets/upload", methods=["POST"])
def upload_dataset():
    auth_error = require_upload_token()
    if auth_error:
        return auth_error

    ensure_schema()
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Expected JSON object"}), 400

    rows = payload.get("rows")
    if not isinstance(rows, list):
        return jsonify({"error": "Expected rows array"}), 400

    dataset_date, dataset_time, label = payload_date_time(payload)
    headers = payload.get("headers") if isinstance(payload.get("headers"), list) else []

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO datasets (
                    dataset_date, dataset_time, uploaded_at_local, label, source,
                    workbook_name, worksheet_name, source_filename, rows_count,
                    headers, raw_payload
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    dataset_date,
                    dataset_time,
                    clean_text(payload.get("uploadedAtLocal")),
                    label,
                    clean_text(payload.get("source")),
                    clean_text(payload.get("workbookName")),
                    clean_text(payload.get("worksheetName")),
                    clean_text(payload.get("sourceFilename")),
                    len(rows),
                    Json(headers),
                    Json(payload),
                ),
            )
            dataset = cur.fetchone()

            for item in rows:
                if not isinstance(item, dict):
                    continue
                quantity = clean_text(item.get("quantity"))
                cur.execute(
                    """
                    INSERT INTO dataset_rows (
                        dataset_id, row_number, product_code, variant_code, variant,
                        quantity_text, remaining, order_number, weight, sequence, info,
                        initial_quantity_text, paircode, history, cells, raw_row
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        dataset["id"],
                        item.get("rowNumber"),
                        clean_text(item.get("productCode")),
                        clean_text(item.get("variantCode")),
                        clean_text(item.get("variant")),
                        quantity,
                        int_from_text(quantity),
                        clean_text(item.get("orderNumber")),
                        clean_text(item.get("weight")),
                        clean_text(item.get("sequence")),
                        clean_text(item.get("info")),
                        clean_text(item.get("initialQuantity")),
                        clean_text(item.get("paircode")),
                        clean_text(item.get("history")),
                        Json(item.get("cells") if isinstance(item.get("cells"), list) else []),
                        Json(item),
                    ),
                )

    return jsonify({"ok": True, "dataset": dataset_summary(dataset), "rows": len(rows)})


@app.route("/api/datasets")
def list_datasets():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    include_deleted = request.args.get("includeDeleted") == "1"
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if include_deleted:
                cur.execute("SELECT * FROM datasets ORDER BY uploaded_at DESC, id DESC")
            else:
                cur.execute(
                    "SELECT * FROM datasets WHERE status = 'active' ORDER BY uploaded_at DESC, id DESC"
                )
            datasets = [dataset_summary(row) for row in cur.fetchall()]
    return jsonify({"datasets": datasets})


@app.route("/api/datasets/latest")
def latest_dataset():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id FROM datasets WHERE status = 'active' ORDER BY uploaded_at DESC, id DESC LIMIT 1"
            )
            row = cur.fetchone()
    if not row:
        return jsonify({"error": "No active dataset found"}), 404
    return get_dataset(row["id"])


@app.route("/api/datasets/<int:dataset_id>")
def get_dataset(dataset_id):
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM datasets WHERE id = %s", (dataset_id,))
            dataset = cur.fetchone()
            if not dataset:
                return jsonify({"error": "Dataset not found"}), 404
            cur.execute(
                "SELECT * FROM dataset_rows WHERE dataset_id = %s ORDER BY row_number NULLS LAST, id",
                (dataset_id,),
            )
            rows = [row_to_api(row) for row in cur.fetchall()]

    return jsonify({"dataset": dataset_summary(dataset), "rows": rows})


@app.route("/api/datasets/<int:dataset_id>", methods=["DELETE"])
def delete_dataset(dataset_id):
    auth_error = require_upload_token()
    if auth_error:
        return auth_error

    ensure_schema()
    data = request.get_json(silent=True) or {}
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE datasets
                SET status = 'deleted',
                    deleted_at = NOW(),
                    deleted_by = %s,
                    delete_reason = %s
                WHERE id = %s AND status <> 'deleted'
                RETURNING *
                """,
                (
                    clean_text(data.get("deletedBy")) or "vba-or-admin",
                    clean_text(data.get("reason")),
                    dataset_id,
                ),
            )
            dataset = cur.fetchone()
    if not dataset:
        return jsonify({"error": "Dataset not found or already deleted"}), 404
    return jsonify({"ok": True, "dataset": dataset_summary(dataset)})


@app.route("/api/datasets/<int:dataset_id>/restore", methods=["POST"])
def restore_dataset(dataset_id):
    auth_error = require_upload_token()
    if auth_error:
        return auth_error

    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE datasets
                SET status = 'active',
                    deleted_at = NULL,
                    deleted_by = NULL,
                    delete_reason = NULL
                WHERE id = %s
                RETURNING *
                """,
                (dataset_id,),
            )
            dataset = cur.fetchone()
    if not dataset:
        return jsonify({"error": "Dataset not found"}), 404
    return jsonify({"ok": True, "dataset": dataset_summary(dataset)})


@app.route("/api/excel/datasets.csv")
def datasets_csv():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    include_deleted = request.args.get("includeDeleted") == "1"
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if include_deleted:
                cur.execute("SELECT * FROM datasets ORDER BY uploaded_at DESC, id DESC")
            else:
                cur.execute(
                    "SELECT * FROM datasets WHERE status = 'active' ORDER BY uploaded_at DESC, id DESC"
                )
            rows = cur.fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "label", "dataset_date", "dataset_time", "uploaded_at", "rows_count", "status"])
    for row in rows:
        writer.writerow(
            [
                row["id"],
                row["label"],
                row["dataset_date"].isoformat(),
                str(row["dataset_time"]),
                row["uploaded_at"].isoformat(),
                row["rows_count"],
                row["status"],
            ]
        )

    return csv_response(output.getvalue(), "datasets.csv")


@app.route("/api/excel/dataset.csv")
def dataset_csv():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    dataset_id = request.args.get("id")

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if dataset_id:
                cur.execute("SELECT * FROM datasets WHERE id = %s", (dataset_id,))
            else:
                cur.execute(
                    "SELECT * FROM datasets WHERE status = 'active' ORDER BY uploaded_at DESC, id DESC LIMIT 1"
                )
            dataset = cur.fetchone()
            if not dataset:
                return jsonify({"error": "Dataset not found"}), 404

            cur.execute(
                "SELECT * FROM dataset_rows WHERE dataset_id = %s ORDER BY row_number NULLS LAST, id",
                (dataset["id"],),
            )
            rows = cur.fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "rowNumber",
            "productCode",
            "variantCode",
            "variant",
            "quantity",
            "remaining",
            "orderNumber",
            "weight",
            "sequence",
            "info",
            "initialQuantity",
            "paircode",
            "history",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row["row_number"],
                row["product_code"],
                row["variant_code"],
                row["variant"],
                row["quantity_text"],
                row["remaining"],
                row["order_number"],
                row["weight"],
                row["sequence"],
                row["info"],
                row["initial_quantity_text"],
                row["paircode"],
                row["history"],
            ]
        )

    filename = f"dataset-{dataset['id']}.csv"
    return csv_response(output.getvalue(), filename)


def csv_response(text, filename):
    data = "\ufeff" + text
    return Response(
        data,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
