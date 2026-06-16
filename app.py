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

DEFAULT_SHOPS = [
    {
        "code": "iveronika_cz",
        "name": "iVeronika.cz",
        "domain": "iveronika.cz",
        "currency": "CZK",
        "country": "CZ",
        "order_prefixes": ["170"],
        "source_system": "shoptet",
    },
    {
        "code": "iveronika_sk",
        "name": "iVeronika.sk",
        "domain": "iveronika.sk",
        "currency": "EUR",
        "country": "SK",
        "order_prefixes": ["2018"],
        "source_system": "shoptet",
    },
    {
        "code": "galantra_cz",
        "name": "Galantra.cz",
        "domain": "galantra.cz",
        "currency": "CZK",
        "country": "CZ",
        "order_prefixes": ["4200"],
        "source_system": "shoptet",
    },
    {
        "code": "fidule_cz",
        "name": "Fidule.cz",
        "domain": "fidule.cz",
        "currency": "CZK",
        "country": "CZ",
        "order_prefixes": [],
        "source_system": "shoptet",
    },
    {
        "code": "mixed",
        "name": "Vice e-shopu",
        "domain": "",
        "currency": "",
        "country": "",
        "order_prefixes": [],
        "source_system": "mixed",
    },
    {
        "code": "unknown",
        "name": "Neurceny e-shop",
        "domain": "",
        "currency": "",
        "country": "",
        "order_prefixes": [],
        "source_system": "unknown",
    },
]

DEFAULT_STOCK_SOURCES = [
    ("own_stock", "Nas sklad", "warehouse"),
    ("galantra_stock", "Galantra sklad", "warehouse"),
    ("milpex", "Milpex", "supplier"),
    ("hotex", "Hotex", "supplier"),
    ("manual", "Rucni kontrola", "manual"),
    ("unknown", "Neurceny zdroj", "unknown"),
]

SHOP_BY_CODE = {shop["code"]: shop for shop in DEFAULT_SHOPS}
PREFIX_TO_SHOP = {
    prefix: shop["code"]
    for shop in DEFAULT_SHOPS
    for prefix in shop["order_prefixes"]
}


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
                CREATE TABLE IF NOT EXISTS shops (
                    code TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    domain TEXT,
                    currency TEXT,
                    country TEXT,
                    order_prefixes JSONB NOT NULL DEFAULT '[]'::jsonb,
                    source_system TEXT NOT NULL DEFAULT 'shoptet',
                    active BOOLEAN NOT NULL DEFAULT TRUE,
                    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS stock_sources (
                    code TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    active BOOLEAN NOT NULL DEFAULT TRUE,
                    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            seed_core_config(cur)
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS datasets (
                    id BIGSERIAL PRIMARY KEY,
                    dataset_kind TEXT NOT NULL DEFAULT 'sorting',
                    shop_code TEXT,
                    shop_name TEXT,
                    source_system TEXT,
                    external_batch_id TEXT,
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
                ALTER TABLE datasets
                ADD COLUMN IF NOT EXISTS dataset_kind TEXT NOT NULL DEFAULT 'sorting'
                """
            )
            cur.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS shop_code TEXT")
            cur.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS shop_name TEXT")
            cur.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS source_system TEXT")
            cur.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS external_batch_id TEXT")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS dataset_rows (
                    id BIGSERIAL PRIMARY KEY,
                    dataset_id BIGINT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
                    shop_code TEXT,
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
            cur.execute("ALTER TABLE dataset_rows ADD COLUMN IF NOT EXISTS shop_code TEXT")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS completion_rows (
                    id BIGSERIAL PRIMARY KEY,
                    dataset_id BIGINT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
                    shop_code TEXT,
                    row_number INTEGER,
                    first_name TEXT,
                    last_name TEXT,
                    note TEXT,
                    street_with_number TEXT,
                    city TEXT,
                    zip_code TEXT,
                    phone TEXT,
                    email TEXT,
                    weight TEXT,
                    cod_amount TEXT,
                    payment_method TEXT,
                    order_number TEXT,
                    shipping_method TEXT,
                    amount TEXT,
                    quantity_text TEXT,
                    paid_status TEXT,
                    expedition_number TEXT,
                    expedition_order_code TEXT,
                    packeta_id TEXT,
                    completion_status TEXT,
                    order_id TEXT,
                    street TEXT,
                    house_number TEXT,
                    dpd_flag TEXT,
                    packeta_status TEXT,
                    packeta_shipment_id TEXT,
                    order_date TEXT,
                    twisto_paid TEXT,
                    dpd_order_and_pieces TEXT,
                    canceled_order_backup TEXT,
                    label_printed TEXT,
                    cells JSONB NOT NULL DEFAULT '[]'::jsonb,
                    raw_row JSONB NOT NULL DEFAULT '{}'::jsonb
                )
                """
            )
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS shop_code TEXT")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS audit_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    dataset_id BIGINT REFERENCES datasets(id) ON DELETE SET NULL,
                    shop_code TEXT,
                    order_number TEXT,
                    row_ref TEXT,
                    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    actor TEXT
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
                CREATE INDEX IF NOT EXISTS idx_datasets_kind_date_shop
                ON datasets (dataset_kind, dataset_date DESC, shop_code)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_dataset_rows_shop
                ON dataset_rows (shop_code)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_completion_rows_shop
                ON completion_rows (shop_code)
                """
            )


def seed_core_config(cur):
    for shop in DEFAULT_SHOPS:
        cur.execute(
            """
            INSERT INTO shops (
                code, name, domain, currency, country, order_prefixes,
                source_system, active, settings
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, '{}'::jsonb)
            ON CONFLICT (code) DO UPDATE SET
                name = EXCLUDED.name,
                domain = EXCLUDED.domain,
                currency = EXCLUDED.currency,
                country = EXCLUDED.country,
                order_prefixes = EXCLUDED.order_prefixes,
                source_system = EXCLUDED.source_system,
                active = TRUE
            """,
            (
                shop["code"],
                shop["name"],
                shop["domain"],
                shop["currency"],
                shop["country"],
                Json(shop["order_prefixes"]),
                shop["source_system"],
            ),
        )

    for code, name, source_type in DEFAULT_STOCK_SOURCES:
        cur.execute(
            """
            INSERT INTO stock_sources (code, name, source_type, active, settings)
            VALUES (%s, %s, %s, TRUE, '{}'::jsonb)
            ON CONFLICT (code) DO UPDATE SET
                name = EXCLUDED.name,
                source_type = EXCLUDED.source_type,
                active = TRUE
            """,
            (code, name, source_type),
        )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_dataset_rows_dataset_id
                ON dataset_rows (dataset_id)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_completion_rows_dataset_id
                ON completion_rows (dataset_id)
                """
            )


def require_upload_token():
    expected = os.environ.get("UPLOAD_TOKEN", "")
    if not expected:
        return None

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


def normalize_shop_code(value):
    return clean_text(value).strip().lower().replace("-", "_").replace(" ", "_")


def shop_name_from_code(shop_code):
    return SHOP_BY_CODE.get(shop_code, {}).get("name", shop_code or "")


def infer_shop_code_from_order(order_number):
    text = clean_text(order_number).strip()
    if not text:
        return ""

    for prefix, shop_code in PREFIX_TO_SHOP.items():
        if text.startswith(prefix):
            return shop_code

    return ""


def infer_row_shop_code(item, fallback=""):
    explicit = normalize_shop_code(item.get("shopCode") or item.get("shop_code") or item.get("shop"))
    if explicit:
        return explicit

    inferred = infer_shop_code_from_order(item.get("orderNumber"))
    return inferred or fallback


def infer_dataset_shop_code(payload, rows):
    explicit = normalize_shop_code(payload.get("shopCode") or payload.get("shop_code") or payload.get("shop"))
    if explicit:
        return explicit

    found = set()
    for item in rows:
        if not isinstance(item, dict):
            continue
        shop_code = infer_row_shop_code(item)
        if shop_code:
            found.add(shop_code)

    if len(found) == 1:
        return next(iter(found))
    if len(found) > 1:
        return "mixed"
    return "unknown"


def payload_date_time(payload):
    now = local_now()
    dataset_date = clean_text(payload.get("datasetDate")) or now.strftime("%Y-%m-%d")
    dataset_time = clean_text(payload.get("datasetTime")) or now.strftime("%H:%M:%S")
    label = clean_text(payload.get("label")) or f"{dataset_date} {dataset_time}"
    return dataset_date, dataset_time, label


def dataset_summary(row):
    return {
        "id": row["id"],
        "datasetKind": row["dataset_kind"],
        "shopCode": row.get("shop_code"),
        "shopName": row.get("shop_name"),
        "sourceSystem": row.get("source_system"),
        "externalBatchId": row.get("external_batch_id"),
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
        "shopCode": row.get("shop_code"),
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


def completion_row_to_api(row):
    return {
        "id": row["id"],
        "shopCode": row.get("shop_code"),
        "rowNumber": row["row_number"],
        "firstName": row["first_name"],
        "lastName": row["last_name"],
        "note": row["note"],
        "streetWithNumber": row["street_with_number"],
        "city": row["city"],
        "zipCode": row["zip_code"],
        "phone": row["phone"],
        "email": row["email"],
        "weight": row["weight"],
        "codAmount": row["cod_amount"],
        "paymentMethod": row["payment_method"],
        "orderNumber": row["order_number"],
        "shippingMethod": row["shipping_method"],
        "amount": row["amount"],
        "quantity": row["quantity_text"],
        "paidStatus": row["paid_status"],
        "expeditionNumber": row["expedition_number"],
        "expeditionOrderCode": row["expedition_order_code"],
        "packetaId": row["packeta_id"],
        "completionStatus": row["completion_status"],
        "orderId": row["order_id"],
        "street": row["street"],
        "houseNumber": row["house_number"],
        "dpdFlag": row["dpd_flag"],
        "packetaStatus": row["packeta_status"],
        "packetaShipmentId": row["packeta_shipment_id"],
        "orderDate": row["order_date"],
        "twistoPaid": row["twisto_paid"],
        "dpdOrderAndPieces": row["dpd_order_and_pieces"],
        "canceledOrderBackup": row["canceled_order_backup"],
        "labelPrinted": row["label_printed"],
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


@app.route("/api/shops")
def list_shops():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT code, name, domain, currency, country, order_prefixes,
                       source_system, active, settings
                FROM shops
                ORDER BY
                    CASE code
                        WHEN 'mixed' THEN 998
                        WHEN 'unknown' THEN 999
                        ELSE 1
                    END,
                    name
                """
            )
            shops = [
                {
                    "code": row["code"],
                    "name": row["name"],
                    "domain": row["domain"],
                    "currency": row["currency"],
                    "country": row["country"],
                    "orderPrefixes": row["order_prefixes"],
                    "sourceSystem": row["source_system"],
                    "active": row["active"],
                    "settings": row["settings"],
                }
                for row in cur.fetchall()
            ]
    return jsonify({"shops": shops})


@app.route("/api/stock-sources")
def list_stock_sources():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT code, name, source_type, active, settings
                FROM stock_sources
                ORDER BY source_type, name
                """
            )
            sources = [
                {
                    "code": row["code"],
                    "name": row["name"],
                    "sourceType": row["source_type"],
                    "active": row["active"],
                    "settings": row["settings"],
                }
                for row in cur.fetchall()
            ]
    return jsonify({"stockSources": sources})


@app.route("/api/expedition/overview")
def expedition_overview():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    include_deleted = request.args.get("includeDeleted") == "1"
    filters = []
    params = []
    if not include_deleted:
        filters.append("status = 'active'")
    if request.args.get("date"):
        filters.append("dataset_date = %s")
        params.append(request.args.get("date"))
    where = f"WHERE {' AND '.join(filters)}" if filters else ""

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT
                    dataset_date,
                    dataset_time,
                    dataset_kind,
                    COALESCE(shop_code, 'unknown') AS shop_code,
                    COALESCE(shop_name, '') AS shop_name,
                    COUNT(*) AS batches,
                    SUM(rows_count) AS rows_count,
                    MAX(uploaded_at) AS latest_upload
                FROM datasets
                {where}
                GROUP BY dataset_date, dataset_time, dataset_kind, shop_code, shop_name
                ORDER BY dataset_date DESC, dataset_time DESC, dataset_kind, shop_code
                """,
                params,
            )
            overview = [
                {
                    "datasetDate": row["dataset_date"].isoformat(),
                    "datasetTime": str(row["dataset_time"]),
                    "datasetKind": row["dataset_kind"],
                    "shopCode": row["shop_code"],
                    "shopName": row["shop_name"] or shop_name_from_code(row["shop_code"]),
                    "batches": row["batches"],
                    "rowsCount": row["rows_count"],
                    "latestUpload": row["latest_upload"].isoformat() if row["latest_upload"] else None,
                }
                for row in cur.fetchall()
            ]
    return jsonify({"overview": overview})


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
    dataset_kind = clean_text(payload.get("datasetKind")) or "sorting"
    if dataset_kind not in ("sorting", "completion"):
        return jsonify({"error": "datasetKind must be sorting or completion"}), 400
    shop_code = infer_dataset_shop_code(payload, rows)
    shop_name = clean_text(payload.get("shopName")) or shop_name_from_code(shop_code)
    source_system = clean_text(payload.get("sourceSystem")) or "excel"
    external_batch_id = clean_text(payload.get("externalBatchId"))

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO datasets (
                    dataset_kind, shop_code, shop_name, source_system, external_batch_id,
                    dataset_date, dataset_time, uploaded_at_local, label, source,
                    workbook_name, worksheet_name, source_filename, rows_count,
                    headers, raw_payload
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    dataset_kind,
                    shop_code,
                    shop_name,
                    source_system,
                    external_batch_id,
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
                row_shop_code = infer_row_shop_code(item, shop_code if shop_code != "mixed" else "")
                if dataset_kind == "completion":
                    insert_completion_row(cur, dataset["id"], item, row_shop_code)
                    continue
                quantity = clean_text(item.get("quantity"))
                cur.execute(
                    """
                    INSERT INTO dataset_rows (
                        dataset_id, shop_code, row_number, product_code, variant_code, variant,
                        quantity_text, remaining, order_number, weight, sequence, info,
                        initial_quantity_text, paircode, history, cells, raw_row
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        dataset["id"],
                        row_shop_code,
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


def insert_completion_row(cur, dataset_id, item, shop_code=""):
    cur.execute(
        """
        INSERT INTO completion_rows (
            dataset_id, shop_code, row_number, first_name, last_name, note, street_with_number,
            city, zip_code, phone, email, weight, cod_amount, payment_method,
            order_number, shipping_method, amount, quantity_text, paid_status,
            expedition_number, expedition_order_code, packeta_id, completion_status,
            order_id, street, house_number, dpd_flag, packeta_status,
            packeta_shipment_id, order_date, twisto_paid, dpd_order_and_pieces,
            canceled_order_backup, label_printed, cells, raw_row
        )
        VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        """,
        (
            dataset_id,
            shop_code,
            item.get("rowNumber"),
            clean_text(item.get("firstName")),
            clean_text(item.get("lastName")),
            clean_text(item.get("note")),
            clean_text(item.get("streetWithNumber")),
            clean_text(item.get("city")),
            clean_text(item.get("zipCode")),
            clean_text(item.get("phone")),
            clean_text(item.get("email")),
            clean_text(item.get("weight")),
            clean_text(item.get("codAmount")),
            clean_text(item.get("paymentMethod")),
            clean_text(item.get("orderNumber")),
            clean_text(item.get("shippingMethod")),
            clean_text(item.get("amount")),
            clean_text(item.get("quantity")),
            clean_text(item.get("paidStatus")),
            clean_text(item.get("expeditionNumber")),
            clean_text(item.get("expeditionOrderCode")),
            clean_text(item.get("packetaId")),
            clean_text(item.get("completionStatus")),
            clean_text(item.get("orderId")),
            clean_text(item.get("street")),
            clean_text(item.get("houseNumber")),
            clean_text(item.get("dpdFlag")),
            clean_text(item.get("packetaStatus")),
            clean_text(item.get("packetaShipmentId")),
            clean_text(item.get("orderDate")),
            clean_text(item.get("twistoPaid")),
            clean_text(item.get("dpdOrderAndPieces")),
            clean_text(item.get("canceledOrderBackup")),
            clean_text(item.get("labelPrinted")),
            Json(item.get("cells") if isinstance(item.get("cells"), list) else []),
            Json(item),
        ),
    )


@app.route("/api/datasets")
def list_datasets():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    include_deleted = request.args.get("includeDeleted") == "1"
    dataset_kind = request.args.get("kind")
    datasets = fetch_datasets(include_deleted, dataset_kind, request.args.get("shop"), request.args.get("date"))
    return jsonify({"datasets": datasets})


def fetch_datasets(include_deleted=False, dataset_kind=None, shop_code=None, dataset_date=None):
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            filters = []
            params = []
            if not include_deleted:
                filters.append("status = 'active'")
            if dataset_kind:
                filters.append("dataset_kind = %s")
                params.append(dataset_kind)
            if shop_code:
                filters.append("shop_code = %s")
                params.append(normalize_shop_code(shop_code))
            if dataset_date:
                filters.append("dataset_date = %s")
                params.append(dataset_date)

            where = f"WHERE {' AND '.join(filters)}" if filters else ""
            cur.execute(
                f"SELECT * FROM datasets {where} ORDER BY uploaded_at DESC, id DESC",
                params,
            )
            return [dataset_summary(row) for row in cur.fetchall()]


@app.route("/api/completion/datasets")
def list_completion_datasets():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    include_deleted = request.args.get("includeDeleted") == "1"
    return jsonify({"datasets": fetch_datasets(include_deleted, "completion", request.args.get("shop"), request.args.get("date"))})


@app.route("/api/completion/latest")
def latest_completion_dataset():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id FROM datasets
                WHERE status = 'active' AND dataset_kind = 'completion'
                ORDER BY uploaded_at DESC, id DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()
    if not row:
        return jsonify({"error": "No active completion dataset found"}), 404
    return get_dataset(row["id"])


@app.route("/api/completion/<int:dataset_id>")
def get_completion_dataset(dataset_id):
    return get_dataset(dataset_id)


@app.route("/api/sorting/datasets")
def list_sorting_datasets():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    include_deleted = request.args.get("includeDeleted") == "1"
    return jsonify({"datasets": fetch_datasets(include_deleted, "sorting", request.args.get("shop"), request.args.get("date"))})


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
            if dataset["dataset_kind"] == "completion":
                cur.execute(
                    "SELECT * FROM completion_rows WHERE dataset_id = %s ORDER BY row_number NULLS LAST, id",
                    (dataset_id,),
                )
                rows = [completion_row_to_api(row) for row in cur.fetchall()]
            else:
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
    dataset_kind = request.args.get("kind")
    shop_code = request.args.get("shop")
    dataset_date = request.args.get("date")
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            filters = []
            params = []
            if not include_deleted:
                filters.append("status = 'active'")
            if dataset_kind:
                filters.append("dataset_kind = %s")
                params.append(dataset_kind)
            if shop_code:
                filters.append("shop_code = %s")
                params.append(normalize_shop_code(shop_code))
            if dataset_date:
                filters.append("dataset_date = %s")
                params.append(dataset_date)
            where = f"WHERE {' AND '.join(filters)}" if filters else ""
            cur.execute(f"SELECT * FROM datasets {where} ORDER BY uploaded_at DESC, id DESC", params)
            rows = cur.fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "id",
            "kind",
            "shop_code",
            "shop_name",
            "source_system",
            "label",
            "dataset_date",
            "dataset_time",
            "uploaded_at",
            "rows_count",
            "status",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row["id"],
                row["dataset_kind"],
                row["shop_code"],
                row["shop_name"],
                row["source_system"],
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

            if dataset["dataset_kind"] == "completion":
                return completion_dataset_csv_response(cur, dataset)

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
            "shopCode",
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
                row["shop_code"],
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


@app.route("/api/excel/completion.csv")
def completion_csv():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    dataset_id = request.args.get("id")
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if dataset_id:
                cur.execute(
                    "SELECT * FROM datasets WHERE id = %s AND dataset_kind = 'completion'",
                    (dataset_id,),
                )
            else:
                cur.execute(
                    """
                    SELECT * FROM datasets
                    WHERE status = 'active' AND dataset_kind = 'completion'
                    ORDER BY uploaded_at DESC, id DESC
                    LIMIT 1
                    """
                )
            dataset = cur.fetchone()
            if not dataset:
                return jsonify({"error": "Completion dataset not found"}), 404
            return completion_dataset_csv_response(cur, dataset)


def completion_dataset_csv_response(cur, dataset):
    cur.execute(
        "SELECT * FROM completion_rows WHERE dataset_id = %s ORDER BY row_number NULLS LAST, id",
        (dataset["id"],),
    )
    rows = cur.fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "rowNumber",
            "shopCode",
            "firstName",
            "lastName",
            "note",
            "streetWithNumber",
            "city",
            "zipCode",
            "phone",
            "email",
            "weight",
            "codAmount",
            "paymentMethod",
            "orderNumber",
            "shippingMethod",
            "amount",
            "quantity",
            "paidStatus",
            "expeditionNumber",
            "expeditionOrderCode",
            "packetaId",
            "completionStatus",
            "orderId",
            "street",
            "houseNumber",
            "dpdFlag",
            "packetaStatus",
            "packetaShipmentId",
            "orderDate",
            "twistoPaid",
            "dpdOrderAndPieces",
            "canceledOrderBackup",
            "labelPrinted",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row["row_number"],
                row["shop_code"],
                row["first_name"],
                row["last_name"],
                row["note"],
                row["street_with_number"],
                row["city"],
                row["zip_code"],
                row["phone"],
                row["email"],
                row["weight"],
                row["cod_amount"],
                row["payment_method"],
                row["order_number"],
                row["shipping_method"],
                row["amount"],
                row["quantity_text"],
                row["paid_status"],
                row["expedition_number"],
                row["expedition_order_code"],
                row["packeta_id"],
                row["completion_status"],
                row["order_id"],
                row["street"],
                row["house_number"],
                row["dpd_flag"],
                row["packeta_status"],
                row["packeta_shipment_id"],
                row["order_date"],
                row["twisto_paid"],
                row["dpd_order_and_pieces"],
                row["canceled_order_backup"],
                row["label_printed"],
            ]
        )

    return csv_response(output.getvalue(), f"completion-{dataset['id']}.csv")


def csv_response(text, filename):
    data = "\ufeff" + text
    return Response(
        data,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
