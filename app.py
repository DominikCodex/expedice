import csv
import base64
import hashlib
import io
import json
import os
import re
import secrets
import tempfile
import threading
import time
import unicodedata
import urllib.error
import datetime as dt
import urllib.parse
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timedelta
from xml.sax.saxutils import escape as xml_escape
from zoneinfo import ZoneInfo

import psycopg2
from psycopg2 import pool
from psycopg2.extras import Json, RealDictCursor
from flask import Flask, Response, g, jsonify, request, send_from_directory
from werkzeug.security import check_password_hash, generate_password_hash

from expedition_integrity import assess_integrity, build_batch_snapshot


def env_int(name, default, minimum=None, maximum=None):
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        value = default
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


APP_DIR = os.path.dirname(os.path.abspath(__file__))
PRAGUE_TZ = ZoneInfo("Europe/Prague")

app = Flask(__name__, static_folder=None)
SCHEMA_READY = False
AUTH_SCHEMA_READY = False
DB_POOL = None
DB_POOL_DSN = ""
SESSION_CACHE = {}
SESSION_CACHE_SECONDS = 30
SESSION_COOKIE = "expedice_session"
SESSION_SECONDS = 12 * 60 * 60
INITIAL_ADMIN_USERNAME = os.environ.get("INITIAL_ADMIN_USERNAME", "").strip()
INITIAL_ADMIN_PASSWORD = os.environ.get("INITIAL_ADMIN_PASSWORD", "")
PASSWORD_HASH_METHOD = "pbkdf2:sha256:260000"
LOGIN_USER_IP_MAX_ATTEMPTS = env_int("LOGIN_USER_IP_MAX_ATTEMPTS", 5, 1, 100)
LOGIN_IP_MAX_ATTEMPTS = env_int("LOGIN_IP_MAX_ATTEMPTS", 25, LOGIN_USER_IP_MAX_ATTEMPTS, 500)
LOGIN_FAILURE_WINDOW_SECONDS = env_int("LOGIN_FAILURE_WINDOW_SECONDS", 15 * 60, 60, 24 * 60 * 60)
LOGIN_LOCK_SECONDS = env_int("LOGIN_LOCK_SECONDS", 15 * 60, 60, 24 * 60 * 60)
LOGIN_CLEANUP_AFTER_SECONDS = env_int("LOGIN_CLEANUP_AFTER_SECONDS", 24 * 60 * 60, 60 * 60, 7 * 24 * 60 * 60)
PAYMENT_SYNC_LOCK = threading.Lock()
PAYMENT_SYNC_ACTIVE_SECONDS = 20 * 60
PRODUCT_FEED_DEFAULT_TIMEOUT_SECONDS = 600
PRODUCT_FEED_DEFAULT_MAX_DOWNLOAD_MB = 512
PRODUCT_FEED_MIN_TIMEOUT_SECONDS = 30
PRODUCT_FEED_MAX_TIMEOUT_SECONDS = 900
PRODUCT_FEED_MIN_DOWNLOAD_MB = 50
PRODUCT_FEED_MAX_DOWNLOAD_MB = 1024
APP_UI_FONT_DEFAULT = "system"
APP_UI_FONT_CHOICES = {"system", "segoe", "aptos", "inter", "arial", "verdana", "tahoma", "roboto", "lexend", "georgia"}
APP_COMPLETION_DENSITY_DEFAULT = "auto"
APP_COMPLETION_DENSITY_CHOICES = {"auto", "comfortable", "warehouse", "ultra"}
EXPEDITION_ORDER_CODE_LABELS_DEFAULT = {
    "0.8": "Komplet ze skladu Galantra.cz přes Zásilkovnu",
    "1": "Komplet ze skladu iVeronika.cz",
    "1.5": "Komplet ze skladu iVeronika.sk",
    "1.8": "Komplet ze skladu Galantra.cz přes DPD",
    "1.9": "Komplet ze skladu DPD mimo Galantra.cz",
    "2": "Zásilkovna pouze Hotex",
    "3": "Zásilkovna Milpex",
    "4": "Zásilkovna Milpex + Hotex kombinace",
    "5": "Zatím nepoužíváme",
    "6": "iVeronika.sk Zásilkovna",
    "7": "DPD Milpex nebo Hotex",
    "8": "ERRORKA Galantra.cz",
}
PRODUCT_IMAGE_CACHE_SECONDS = 12 * 60 * 60
PRODUCT_IMAGE_REQUEST_CODE_LIMIT = 10000
PRODUCT_IMAGE_CACHE_LOCK = threading.Lock()
PRODUCT_IMAGE_CACHE = {
    "signature": "",
    "loadedAt": 0,
    "images": {},
    "rowsSeen": 0,
    "bytesRead": 0,
    "imageColumns": [],
    "error": "",
}

csv.field_size_limit(max(csv.field_size_limit(), 20 * 1024 * 1024))

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
        "order_prefixes": ["42"],
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


def db_pool():
    global DB_POOL, DB_POOL_DSN
    url = database_url()
    if not url:
        raise RuntimeError("DATABASE_URL is not configured")
    if DB_POOL is None or DB_POOL_DSN != url:
        minconn = int(os.environ.get("DB_POOL_MIN", "1"))
        maxconn = int(os.environ.get("DB_POOL_MAX", "6"))
        DB_POOL = pool.SimpleConnectionPool(minconn, maxconn, dsn=url)
        DB_POOL_DSN = url
    return DB_POOL


@contextmanager
def db_conn():
    active_pool = db_pool()
    conn = active_pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        if not conn.closed:
            conn.rollback()
        raise
    finally:
        active_pool.putconn(conn, close=bool(conn.closed))


def ensure_login_rate_limit_schema(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS login_rate_limits (
            scope TEXT NOT NULL,
            identifier TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            locked_until TIMESTAMPTZ,
            PRIMARY KEY (scope, identifier)
        )
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_login_rate_limits_locked
        ON login_rate_limits (locked_until)
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_login_rate_limits_last_attempt
        ON login_rate_limits (last_attempt_at)
        """
    )


def ensure_schema():
    global SCHEMA_READY, AUTH_SCHEMA_READY
    if SCHEMA_READY:
        return

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
                CREATE TABLE IF NOT EXISTS expedition_days (
                    id BIGSERIAL PRIMARY KEY,
                    day_date DATE NOT NULL UNIQUE,
                    label TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    deleted_at TIMESTAMPTZ,
                    deleted_by TEXT,
                    delete_reason TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("ALTER TABLE expedition_days ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE expedition_days ADD COLUMN IF NOT EXISTS deleted_by TEXT")
            cur.execute("ALTER TABLE expedition_days ADD COLUMN IF NOT EXISTS delete_reason TEXT")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS datasets (
                    id BIGSERIAL PRIMARY KEY,
                    expedition_day_id BIGINT REFERENCES expedition_days(id) ON DELETE SET NULL,
                    dataset_kind TEXT NOT NULL DEFAULT 'sorting',
                    batch_name TEXT,
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
                    replaced_at TIMESTAMPTZ,
                    replaced_by_dataset_id BIGINT,
                    replace_reason TEXT,
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
            cur.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS expedition_day_id BIGINT")
            cur.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS batch_name TEXT")
            cur.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS shop_code TEXT")
            cur.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS shop_name TEXT")
            cur.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS source_system TEXT")
            cur.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS external_batch_id TEXT")
            cur.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS replaced_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS replaced_by_dataset_id BIGINT")
            cur.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS replace_reason TEXT")
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
                    carrier_note TEXT,
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
                    label_cache_status TEXT,
                    label_cache_error TEXT,
                    label_cache_fetched_at TIMESTAMPTZ,
                    label_cache_size INTEGER NOT NULL DEFAULT 0,
                    cells JSONB NOT NULL DEFAULT '[]'::jsonb,
                    raw_row JSONB NOT NULL DEFAULT '{}'::jsonb
                )
                """
            )
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS shop_code TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS carrier_note TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS address_validation_status TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS address_validation_message TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS address_validation_query TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS address_validation_checked_at TIMESTAMPTZ")
            cur.execute(
                "ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS address_validation_result JSONB NOT NULL DEFAULT '{}'::jsonb"
            )
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS label_cache_status TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS label_cache_error TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS label_cache_fetched_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS label_cache_size INTEGER NOT NULL DEFAULT 0")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS payment_check_status TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS payment_check_message TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS payment_check_source_status TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS payment_check_paid TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS payment_check_order_date TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS payment_check_package_number TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS payment_check_feed_shop TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS payment_check_checked_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS payment_check_changed_at TIMESTAMPTZ")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS payment_feed_syncs (
                    id SERIAL PRIMARY KEY,
                    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    finished_at TIMESTAMPTZ,
                    status TEXT NOT NULL DEFAULT 'running',
                    trigger_source TEXT,
                    date_from DATE,
                    date_until DATE,
                    rows_seen INTEGER NOT NULL DEFAULT 0,
                    rows_checked INTEGER NOT NULL DEFAULT 0,
                    rows_changed INTEGER NOT NULL DEFAULT 0,
                    errors JSONB NOT NULL DEFAULT '[]'::jsonb
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS label_cache (
                    id BIGSERIAL PRIMARY KEY,
                    dataset_id BIGINT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
                    completion_row_id BIGINT NOT NULL REFERENCES completion_rows(id) ON DELETE CASCADE,
                    carrier TEXT NOT NULL,
                    label_number TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'ready',
                    pdf_content BYTEA,
                    error TEXT,
                    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    pdf_size INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (completion_row_id, carrier, label_number)
                )
                """
            )
            cur.execute("ALTER TABLE label_cache ADD COLUMN IF NOT EXISTS pdf_content BYTEA")
            cur.execute("ALTER TABLE label_cache ADD COLUMN IF NOT EXISTS error TEXT")
            cur.execute("ALTER TABLE label_cache ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")
            cur.execute("ALTER TABLE label_cache ADD COLUMN IF NOT EXISTS pdf_size INTEGER NOT NULL DEFAULT 0")
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_label_cache_dataset
                ON label_cache (dataset_id, status, fetched_at DESC)
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS address_validation_logs (
                    id BIGSERIAL PRIMARY KEY,
                    dataset_id BIGINT REFERENCES datasets(id) ON DELETE SET NULL,
                    row_id BIGINT REFERENCES completion_rows(id) ON DELETE SET NULL,
                    actor_user_id BIGINT,
                    actor_name TEXT,
                    order_number TEXT,
                    customer_name TEXT,
                    original_address TEXT,
                    resolved_address TEXT,
                    carrier_note_before TEXT,
                    carrier_note_after TEXT,
                    status TEXT,
                    action TEXT,
                    message TEXT,
                    details JSONB NOT NULL DEFAULT '{}'::jsonb,
                    original_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
                    updated_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
                    reverted_at TIMESTAMPTZ,
                    reverted_by TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("ALTER TABLE address_validation_logs ADD COLUMN IF NOT EXISTS actor_user_id BIGINT")
            cur.execute("ALTER TABLE address_validation_logs ADD COLUMN IF NOT EXISTS actor_name TEXT")
            cur.execute(
                "ALTER TABLE address_validation_logs ADD COLUMN IF NOT EXISTS original_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb"
            )
            cur.execute(
                "ALTER TABLE address_validation_logs ADD COLUMN IF NOT EXISTS updated_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb"
            )
            cur.execute("ALTER TABLE address_validation_logs ADD COLUMN IF NOT EXISTS reverted_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE address_validation_logs ADD COLUMN IF NOT EXISTS reverted_by TEXT")
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_address_validation_logs_dataset
                ON address_validation_logs (dataset_id, created_at DESC)
                """
            )
            cur.execute(
                """
                INSERT INTO expedition_days (day_date, label)
                SELECT DISTINCT dataset_date, TO_CHAR(dataset_date, 'FMDD.FMMM.YYYY')
                FROM datasets
                ON CONFLICT (day_date) DO UPDATE SET
                    label = EXCLUDED.label,
                    updated_at = NOW()
                """
            )
            cur.execute(
                """
                UPDATE datasets d
                SET expedition_day_id = ed.id,
                    batch_name = COALESCE(NULLIF(d.batch_name, ''), ed.label)
                FROM expedition_days ed
                WHERE d.dataset_date = ed.day_date
                  AND (d.expedition_day_id IS NULL OR d.batch_name IS NULL OR d.batch_name = '')
                """
            )
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
                CREATE TABLE IF NOT EXISTS users (
                    id BIGSERIAL PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL DEFAULT '',
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'employee',
                    active BOOLEAN NOT NULL DEFAULT TRUE,
                    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_login_at TIMESTAMPTZ,
                    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL
                )
                """
            )
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'employee'")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE")
            cur.execute(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE"
            )
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by BIGINT")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_sessions (
                    id BIGSERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    token_hash TEXT NOT NULL UNIQUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    expires_at TIMESTAMPTZ NOT NULL
                )
                """
            )
            ensure_login_rate_limit_schema(cur)
            seed_initial_admin(cur)
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value JSONB NOT NULL DEFAULT '{}'::jsonb,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_users_username
                ON users (username)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash
                ON user_sessions (token_hash)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
                ON user_sessions (user_id)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_expedition_days_date
                ON expedition_days (day_date DESC)
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
                CREATE INDEX IF NOT EXISTS idx_datasets_expedition_day_status
                ON datasets (expedition_day_id, status, dataset_kind, shop_code)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_datasets_replace_key
                ON datasets (expedition_day_id, dataset_kind, shop_code, batch_name, status)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_dataset_rows_dataset_id
                ON dataset_rows (dataset_id)
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
                CREATE INDEX IF NOT EXISTS idx_completion_rows_dataset_id
                ON completion_rows (dataset_id)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_completion_rows_shop
                ON completion_rows (shop_code)
                """
            )
    SCHEMA_READY = True
    AUTH_SCHEMA_READY = True


def ensure_auth_schema():
    global AUTH_SCHEMA_READY
    if AUTH_SCHEMA_READY:
        return

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id BIGSERIAL PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL DEFAULT '',
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'employee',
                    active BOOLEAN NOT NULL DEFAULT TRUE,
                    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_login_at TIMESTAMPTZ,
                    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL
                )
                """
            )
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'employee'")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE")
            cur.execute(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE"
            )
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by BIGINT")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_sessions (
                    id BIGSERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    token_hash TEXT NOT NULL UNIQUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    expires_at TIMESTAMPTZ NOT NULL
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_users_username
                ON users (username)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash
                ON user_sessions (token_hash)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
                ON user_sessions (user_id)
                """
            )
            ensure_login_rate_limit_schema(cur)
            seed_initial_admin(cur)

    AUTH_SCHEMA_READY = True


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


def seed_initial_admin(cur):
    if not INITIAL_ADMIN_USERNAME or not INITIAL_ADMIN_PASSWORD:
        return
    username = INITIAL_ADMIN_USERNAME.lower()
    cur.execute("SELECT id FROM users WHERE username = %s", (username,))
    if cur.fetchone():
        return

    cur.execute(
        """
        INSERT INTO users (
            username, display_name, password_hash, role, active, must_change_password
        )
        VALUES (%s, %s, %s, 'admin', TRUE, FALSE)
        """,
        (username, "Dominik Najman", make_password_hash(INITIAL_ADMIN_PASSWORD)),
    )


def make_password_hash(password):
    return generate_password_hash(password, method=PASSWORD_HASH_METHOD)


def password_hash_needs_upgrade(password_hash):
    return not clean_text(password_hash).startswith(PASSWORD_HASH_METHOD)


def normalize_username(value):
    return clean_text(value).strip().lower()


def hash_session_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def client_ip_address():
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        first_ip = forwarded_for.split(",", 1)[0].strip()
        if first_ip:
            return first_ip[:128]
    real_ip = request.headers.get("X-Real-IP", "").strip()
    if real_ip:
        return real_ip[:128]
    return (request.remote_addr or "unknown")[:128]


def login_rate_identifier(*parts):
    normalized = "|".join(clean_text(part).strip().lower()[:200] for part in parts)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def login_rate_limit_targets(username):
    ip_address = client_ip_address()
    return [
        {
            "scope": "user_ip",
            "identifier": login_rate_identifier(username, ip_address),
            "max_attempts": LOGIN_USER_IP_MAX_ATTEMPTS,
        },
        {
            "scope": "ip",
            "identifier": login_rate_identifier(ip_address),
            "max_attempts": LOGIN_IP_MAX_ATTEMPTS,
        },
    ]


def cleanup_login_rate_limits(cur):
    now = dt.datetime.now(dt.timezone.utc)
    cutoff = now - timedelta(seconds=LOGIN_CLEANUP_AFTER_SECONDS)
    cur.execute(
        """
        DELETE FROM login_rate_limits
        WHERE last_attempt_at < %s
          AND (locked_until IS NULL OR locked_until < %s)
        """,
        (cutoff, now),
    )


def login_rate_limited_until(cur, username):
    now = dt.datetime.now(dt.timezone.utc)
    locked_until = None
    for target in login_rate_limit_targets(username):
        cur.execute(
            """
            SELECT locked_until
            FROM login_rate_limits
            WHERE scope = %s
              AND identifier = %s
              AND locked_until > %s
            """,
            (target["scope"], target["identifier"], now),
        )
        row = cur.fetchone()
        if row and (locked_until is None or row["locked_until"] > locked_until):
            locked_until = row["locked_until"]
    return locked_until


def login_retry_after_seconds(locked_until):
    if not locked_until:
        return 0
    now = dt.datetime.now(dt.timezone.utc)
    return max(1, int((locked_until - now).total_seconds()))


def login_rate_limit_response(locked_until):
    retry_after = login_retry_after_seconds(locked_until)
    minutes = max(1, (retry_after + 59) // 60)
    response = jsonify(
        {
            "error": f"Příliš mnoho neúspěšných pokusů. Zkus to prosím znovu za {minutes} min.",
            "retryAfterSeconds": retry_after,
        }
    )
    response.status_code = 429
    response.headers["Retry-After"] = str(retry_after)
    return response


def record_login_failure(cur, username):
    now = dt.datetime.now(dt.timezone.utc)
    window_start = now - timedelta(seconds=LOGIN_FAILURE_WINDOW_SECONDS)
    locked_until = None
    for target in login_rate_limit_targets(username):
        cur.execute(
            """
            SELECT attempts, first_attempt_at, locked_until
            FROM login_rate_limits
            WHERE scope = %s AND identifier = %s
            FOR UPDATE
            """,
            (target["scope"], target["identifier"]),
        )
        row = cur.fetchone()
        if row and row["first_attempt_at"] >= window_start and not (
            row["locked_until"] and row["locked_until"] <= now
        ):
            attempts = int(row["attempts"] or 0) + 1
            first_attempt_at = row["first_attempt_at"]
        else:
            attempts = 1
            first_attempt_at = now

        next_locked_until = now + timedelta(seconds=LOGIN_LOCK_SECONDS) if attempts >= target["max_attempts"] else None
        cur.execute(
            """
            INSERT INTO login_rate_limits (
                scope, identifier, attempts, first_attempt_at, last_attempt_at, locked_until
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (scope, identifier) DO UPDATE SET
                attempts = EXCLUDED.attempts,
                first_attempt_at = EXCLUDED.first_attempt_at,
                last_attempt_at = EXCLUDED.last_attempt_at,
                locked_until = EXCLUDED.locked_until
            """,
            (target["scope"], target["identifier"], attempts, first_attempt_at, now, next_locked_until),
        )
        if next_locked_until and (locked_until is None or next_locked_until > locked_until):
            locked_until = next_locked_until
    return locked_until


def clear_login_failures_for_user_ip(cur, username):
    ip_address = client_ip_address()
    cur.execute(
        "DELETE FROM login_rate_limits WHERE scope = %s AND identifier = %s",
        ("user_ip", login_rate_identifier(username, ip_address)),
    )


def user_to_api(user):
    if not user:
        return None
    return {
        "id": user["id"],
        "username": user["username"],
        "displayName": user.get("display_name") or user["username"],
        "role": user.get("role") or "employee",
        "active": bool(user.get("active")),
        "mustChangePassword": False,
        "createdAt": user.get("created_at").isoformat() if user.get("created_at") else None,
        "updatedAt": user.get("updated_at").isoformat() if user.get("updated_at") else None,
        "lastLoginAt": user.get("last_login_at").isoformat() if user.get("last_login_at") else None,
    }


def is_admin(user=None):
    active_user = user or current_user()
    return bool(active_user and active_user.get("role") == "admin")


def include_deleted_for_admin():
    return request.args.get("includeDeleted") == "1" and is_admin()


def current_user():
    if hasattr(g, "current_user"):
        return g.current_user

    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        g.current_user = None
        return None

    token_hash = hash_session_token(token)
    cached = SESSION_CACHE.get(token_hash)
    now_ts = time.time()
    if cached and cached["cache_until"] > now_ts:
        g.current_user = cached["user"]
        return g.current_user

    ensure_auth_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT u.*, s.last_seen_at
                FROM user_sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = %s
                  AND s.expires_at > NOW()
                  AND u.active = TRUE
                LIMIT 1
                """,
                (token_hash,),
            )
            user = cur.fetchone()
            if user and (
                not user.get("last_seen_at")
                or user["last_seen_at"] < datetime.now(user["last_seen_at"].tzinfo) - timedelta(minutes=10)
            ):
                cur.execute("UPDATE user_sessions SET last_seen_at = NOW() WHERE token_hash = %s", (token_hash,))

    if user:
        user = dict(user)
        user.pop("last_seen_at", None)
        SESSION_CACHE[token_hash] = {"user": user, "cache_until": now_ts + SESSION_CACHE_SECONDS}
    g.current_user = user
    return user


def valid_upload_token():
    expected = os.environ.get("UPLOAD_TOKEN", "")
    if not expected:
        return False
    provided = request.headers.get("X-Upload-Token") or request.args.get("token") or ""
    return secrets.compare_digest(provided, expected)


def valid_download_token():
    expected = os.environ.get("DOWNLOAD_TOKEN", "")
    if not expected:
        return False
    provided = request.headers.get("X-Download-Token") or request.args.get("token") or ""
    return secrets.compare_digest(provided, expected)


def require_upload_token():
    if valid_upload_token() or current_user():
        return None

    expected = os.environ.get("UPLOAD_TOKEN", "")
    if not expected:
        return None

    return jsonify({"error": "Unauthorized"}), 401


def require_download_token_if_configured():
    if request.method == "GET" and valid_download_token() and not api_path_requires_admin(path):
        return None
    if current_user():
        return None
    return jsonify({"error": "Unauthorized"}), 401


def require_login():
    user = current_user()
    if not user:
        return jsonify({"error": "Je potřeba se přihlásit."}), 401
    return None


def require_admin():
    auth_error = require_login()
    if auth_error:
        return auth_error
    if not is_admin():
        return jsonify({"error": "Tahle akce je dostupná jen pro admina."}), 403
    return None


def set_session_cookie(response, token):
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=request.is_secure,
        samesite="Lax",
        path="/",
    )


def clear_session_cookie(response):
    response.delete_cookie(SESSION_COOKIE, path="/")


def clear_session_cache_for_token(token):
    if token:
        SESSION_CACHE.pop(hash_session_token(token), None)


def clear_session_cache_for_user(user_id):
    for token_hash, cached in list(SESSION_CACHE.items()):
        if cached.get("user", {}).get("id") == user_id:
            SESSION_CACHE.pop(token_hash, None)


def create_user_session(cur, user_id):
    token = secrets.token_urlsafe(36)
    expires_at = local_now() + timedelta(seconds=SESSION_SECONDS)
    cur.execute(
        """
        INSERT INTO user_sessions (user_id, token_hash, expires_at)
        VALUES (%s, %s, %s)
        """,
        (user_id, hash_session_token(token), expires_at),
    )
    return token


def api_path_requires_admin(path):
    if path == "/api/settings" or path.startswith("/api/users"):
        return True
    if path.startswith("/api/product-feed"):
        return True
    if path == "/api/packeta/validate" or path == "/api/dpd/send":
        return True
    if request.method == "DELETE" and path.startswith("/api/datasets/"):
        return True
    if path.startswith("/api/datasets/") and path.endswith("/restore"):
        return True
    return False


@app.before_request
def enforce_api_auth():
    path = request.path.rstrip("/") or "/"
    if not path.startswith("/api/"):
        return None

    public_paths = {"/api/health", "/api/auth/login", "/api/auth/logout", "/api/auth/me"}
    if path in public_paths:
        return None

    if path == "/api/datasets/upload":
        return None

    if request.method == "GET" and valid_download_token():
        return None

    user = current_user()
    if not user:
        return jsonify({"error": "Je potřeba se přihlásit."}), 401

    if api_path_requires_admin(path) and user.get("role") != "admin":
        return jsonify({"error": "Tahle akce je dostupná jen pro admina."}), 403

    return None


@app.route("/api/auth/me")
def auth_me():
    user = current_user()
    return jsonify({"authenticated": bool(user), "user": user_to_api(user) if user else None})


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    ensure_auth_schema()
    data = request.get_json(silent=True) or {}
    username = normalize_username(data.get("username") or data.get("email"))
    password = clean_text(data.get("password"))
    if not username or not password:
        return jsonify({"error": "Vyplň uživatelské jméno/e-mail a heslo."}), 400

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cleanup_login_rate_limits(cur)
            locked_until = login_rate_limited_until(cur, username)
            if locked_until:
                return login_rate_limit_response(locked_until)

            cur.execute("SELECT * FROM users WHERE username = %s", (username,))
            user = cur.fetchone()
            if not user or not user["active"] or not check_password_hash(user["password_hash"], password):
                locked_until = record_login_failure(cur, username)
                if locked_until:
                    return login_rate_limit_response(locked_until)
                return jsonify({"error": "Nesprávné přihlašovací údaje."}), 401

            password_update_sql = ", password_hash = %s" if password_hash_needs_upgrade(user["password_hash"]) else ""
            password_update_params = [make_password_hash(password)] if password_update_sql else []
            clear_login_failures_for_user_ip(cur, username)
            token = create_user_session(cur, user["id"])
            cur.execute(
                f"UPDATE users SET last_login_at = NOW(), must_change_password = FALSE, updated_at = NOW(){password_update_sql} WHERE id = %s RETURNING *",
                [*password_update_params, user["id"]],
            )
            user = cur.fetchone()

    response = jsonify({"ok": True, "user": user_to_api(user)})
    set_session_cookie(response, token)
    return response


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        ensure_auth_schema()
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM user_sessions WHERE token_hash = %s", (hash_session_token(token),))
        clear_session_cache_for_token(token)
    response = jsonify({"ok": True})
    clear_session_cookie(response)
    return response


@app.route("/api/auth/change-password", methods=["POST"])
def auth_change_password():
    auth_error = require_login()
    if auth_error:
        return auth_error

    data = request.get_json(silent=True) or {}
    current_password = clean_text(data.get("currentPassword"))
    new_password = clean_text(data.get("newPassword"))
    if len(new_password) < 4:
        return jsonify({"error": "Nové heslo musí mít alespoň 4 znaky."}), 400

    user = current_user()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM users WHERE id = %s", (user["id"],))
            fresh_user = cur.fetchone()
            if not fresh_user or not check_password_hash(fresh_user["password_hash"], current_password):
                return jsonify({"error": "Aktuální heslo nesedí."}), 400
            cur.execute(
                """
                UPDATE users
                SET password_hash = %s,
                    must_change_password = FALSE,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING *
                """,
                (make_password_hash(new_password), user["id"]),
            )
            updated = cur.fetchone()

    g.current_user = updated
    return jsonify({"ok": True, "user": user_to_api(updated)})


@app.route("/api/users")
def list_users():
    auth_error = require_admin()
    if auth_error:
        return auth_error

    ensure_auth_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM users ORDER BY active DESC, role, display_name, username")
            users = cur.fetchall()
    return jsonify({"users": [user_to_api(user) for user in users]})


@app.route("/api/users", methods=["POST"])
def create_user():
    auth_error = require_admin()
    if auth_error:
        return auth_error

    data = request.get_json(silent=True) or {}
    username = normalize_username(data.get("username") or data.get("email"))
    display_name = clean_text(data.get("displayName") or username).strip()
    password = clean_text(data.get("password"))
    role = clean_text(data.get("role") or "employee").strip().lower()
    if role not in {"admin", "employee"}:
        return jsonify({"error": "Role musí být admin nebo uživatel."}), 400
    if not username or not password:
        return jsonify({"error": "Vyplň uživatele a heslo."}), 400
    if len(password) < 4:
        return jsonify({"error": "Heslo musí mít alespoň 4 znaky."}), 400

    creator = current_user()
    try:
        with db_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO users (
                        username, display_name, password_hash, role, active,
                        must_change_password, created_by
                    )
                    VALUES (%s, %s, %s, %s, TRUE, FALSE, %s)
                    RETURNING *
                    """,
                    (username, display_name or username, make_password_hash(password), role, creator["id"]),
                )
                user = cur.fetchone()
    except psycopg2.IntegrityError:
        return jsonify({"error": "Uživatel s tímto jménem/e-mailem už existuje."}), 409

    return jsonify({"ok": True, "user": user_to_api(user)}), 201


@app.route("/api/users/<int:user_id>", methods=["PATCH"])
def update_user(user_id):
    auth_error = require_admin()
    if auth_error:
        return auth_error

    data = request.get_json(silent=True) or {}
    updates = []
    params = []
    if "displayName" in data:
        updates.append("display_name = %s")
        params.append(clean_text(data.get("displayName")).strip())
    if "role" in data:
        role = clean_text(data.get("role")).strip().lower()
        if role not in {"admin", "employee"}:
            return jsonify({"error": "Role musí být admin nebo uživatel."}), 400
        updates.append("role = %s")
        params.append(role)
    if "active" in data:
        if user_id == current_user()["id"] and not bool(data.get("active")):
            return jsonify({"error": "Sám sebe raději nevypínej, to by byla administrátorská pastička."}), 400
        updates.append("active = %s")
        params.append(bool(data.get("active")))
    if "mustChangePassword" in data:
        updates.append("must_change_password = %s")
        params.append(bool(data.get("mustChangePassword")))

    if not updates:
        return jsonify({"error": "Není co upravit."}), 400

    params.append(user_id)
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"UPDATE users SET {', '.join(updates)}, updated_at = NOW() WHERE id = %s RETURNING *",
                params,
            )
            user = cur.fetchone()
            if user and "active" in data and not bool(data.get("active")):
                cur.execute("DELETE FROM user_sessions WHERE user_id = %s", (user_id,))
                clear_session_cache_for_user(user_id)

    if not user:
        return jsonify({"error": "Uživatel nenalezen."}), 404
    return jsonify({"ok": True, "user": user_to_api(user)})


@app.route("/api/users/<int:user_id>/reset-password", methods=["POST"])
def reset_user_password(user_id):
    auth_error = require_admin()
    if auth_error:
        return auth_error

    data = request.get_json(silent=True) or {}
    password = clean_text(data.get("password"))
    if len(password) < 4:
        return jsonify({"error": "Heslo musí mít alespoň 4 znaky."}), 400

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE users
                SET password_hash = %s,
                    must_change_password = FALSE,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING *
                """,
                (make_password_hash(password), user_id),
            )
            user = cur.fetchone()
            if user:
                cur.execute("DELETE FROM user_sessions WHERE user_id = %s", (user_id,))
                clear_session_cache_for_user(user_id)

    if not user:
        return jsonify({"error": "Uživatel nenalezen."}), 404
    return jsonify({"ok": True, "user": user_to_api(user)})


def local_now():
    return datetime.now(PRAGUE_TZ)


def clean_text(value):
    if value is None:
        return ""
    return str(value)


def searchable_text(value):
    text = clean_text(value).lower()
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(char for char in normalized if not unicodedata.combining(char))


def row_value(row, *keys):
    for key in keys:
        if isinstance(row, dict) and key in row:
            return row.get(key)
        if hasattr(row, "get") and row.get(key) is not None:
            return row.get(key)
    return ""


def row_text_contains(row, *keys_and_needles):
    values = []
    needles = []
    for item in keys_and_needles:
        if isinstance(item, (tuple, list)) and len(item) == 2:
            values.append(row_value(row, item[0], item[1]))
        else:
            needles.append(item)
    haystack = searchable_text(" ".join(clean_text(value) for value in values))
    return any(searchable_text(needle) in haystack for needle in needles)


def delivery_info_from_row(row):
    shipping = clean_text(row_value(row, "shippingMethod", "shipping_method"))
    dpd_flag = clean_text(row_value(row, "dpdFlag", "dpd_flag"))
    shop_code = clean_text(row_value(row, "shopCode", "shop_code")).lower()
    order_shop_code = shop_code_from_order_number(row)
    text = searchable_text(" ".join([shipping, dpd_flag, shop_code]))
    is_sk_order = order_shop_code == "iveronika_sk" or (not order_shop_code and shop_code.endswith("_sk"))

    if "poukaz" in text and ("email" in text or "emailem" in text):
        return {
            "carrier": "email",
            "carrierLabel": "E-mail",
            "service": "gift_voucher_email",
            "serviceLabel": "Dárkový poukaz e-mailem",
            "requiresCarrier": False,
            "requiresAddress": False,
            "isPacketa": False,
            "isDpd": False,
            "isGiftVoucher": True,
            "isSk": is_sk_order,
        }

    dpd_marked = searchable_text(dpd_flag).strip() in {"1", "ano", "true", "dpd", "yes"}
    if ("dpd" in text or dpd_marked) and not is_sk_order:
        is_pickup = any(token in text for token in ["vydejni", "vydaj", "box", "pickup", "parcelshop", "pobock"])
        return {
            "carrier": "dpd",
            "carrierLabel": "DPD",
            "service": "dpd_pickup" if is_pickup else "dpd_courier",
            "serviceLabel": "DPD výdejní místo/box" if is_pickup else "DPD kurýr na adresu",
            "requiresCarrier": True,
            "requiresAddress": not is_pickup,
            "isPacketa": False,
            "isDpd": True,
            "isGiftVoucher": False,
            "isSk": False,
        }

    if "ceska posta" in text:
        return {
            "carrier": "packeta",
            "carrierLabel": "Zásilkovna/Packeta",
            "service": "packeta_cz_post",
            "serviceLabel": "Česká pošta přes Zásilkovnu",
            "requiresCarrier": True,
            "requiresAddress": True,
            "isPacketa": True,
            "isDpd": False,
            "isGiftVoucher": False,
            "isSk": is_sk_order,
        }
    if "prepravni sluzba" in text or "kuryr" in text:
        return {
            "carrier": "packeta",
            "carrierLabel": "Zásilkovna/Packeta",
            "service": "packeta_cz_courier",
            "serviceLabel": "Přepravní služba na adresu",
            "requiresCarrier": True,
            "requiresAddress": True,
            "isPacketa": True,
            "isDpd": False,
            "isGiftVoucher": False,
            "isSk": is_sk_order,
        }
    is_packeta_pickup = any(
        token in text
        for token in ["zasilkovna", "packeta", "odberne miesto", "odberne misto", "osobni odber", "osobni odber na pobocce"]
    )
    is_packeta_courier = is_sk_order and "kuri" in text and "adres" in text

    if is_packeta_courier:
        return {
            "carrier": "packeta",
            "carrierLabel": "Packeta",
            "service": "packeta_sk_courier",
            "serviceLabel": "Kuriérom na adresu",
            "requiresCarrier": True,
            "requiresAddress": True,
            "isPacketa": True,
            "isDpd": False,
            "isGiftVoucher": False,
            "isSk": True,
        }

    if is_packeta_pickup or is_sk_order:
        return {
            "carrier": "packeta",
            "carrierLabel": "Zásilkovna/Packeta",
            "service": "packeta_pickup",
            "serviceLabel": "Výdejní místo Zásilkovna/Packeta",
            "requiresCarrier": True,
            "requiresAddress": False,
            "isPacketa": True,
            "isDpd": False,
            "isGiftVoucher": False,
            "isSk": is_sk_order,
        }

    return {
        "carrier": "manual",
        "carrierLabel": "Ruční kontrola",
        "service": "manual",
        "serviceLabel": shipping or "Neurčená doprava",
        "requiresCarrier": True,
        "requiresAddress": True,
        "isPacketa": False,
        "isDpd": False,
        "isGiftVoucher": False,
        "isSk": is_sk_order,
    }


def order_number_prefix4(row):
    order_number = clean_text(row_value(row, "orderNumber", "order_number", "orderId", "order_id"))
    digits = "".join(char for char in order_number if char.isdigit())
    return digits[:4]


def shop_code_from_order_number(row):
    prefix = order_number_prefix4(row)
    if prefix == "2018":
        return "iveronika_sk"
    if prefix.startswith("42"):
        return "galantra_cz"
    if prefix == "1700":
        return "iveronika_cz"
    return ""


def country_from_order_number(row):
    shop_code = shop_code_from_order_number(row)
    if shop_code == "iveronika_sk":
        return "SK"
    if shop_code in {"iveronika_cz", "galantra_cz"}:
        return "CZ"
    fallback_shop_code = clean_text(row_value(row, "shopCode", "shop_code")).lower()
    return "SK" if fallback_shop_code.endswith("_sk") else "CZ"


def display_date_label(value):
    text = clean_text(value).strip()
    try:
        parsed = datetime.strptime(text[:10], "%Y-%m-%d")
        return f"{parsed.day}.{parsed.month}.{parsed.year}"
    except ValueError:
        return text


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
    dataset_date = clean_text(payload.get("expeditionDayDate") or payload.get("datasetDate")) or now.strftime("%Y-%m-%d")
    dataset_time = clean_text(payload.get("datasetTime")) or now.strftime("%H:%M:%S")
    label = clean_text(payload.get("label")) or f"{dataset_date} {dataset_time}"
    return dataset_date, dataset_time, label


def ensure_expedition_day(cur, dataset_date, batch_name=""):
    label = clean_text(batch_name) or display_date_label(dataset_date)
    cur.execute(
        """
        INSERT INTO expedition_days (day_date, label, status, updated_at)
        VALUES (%s, %s, 'active', NOW())
        ON CONFLICT (day_date) DO UPDATE SET
            label = EXCLUDED.label,
            status = 'active',
            deleted_at = NULL,
            deleted_by = NULL,
            delete_reason = NULL,
            updated_at = NOW()
        RETURNING *
        """,
        (dataset_date, label),
    )
    return cur.fetchone()


def expedition_day_summary(row):
    return {
        "id": row["id"],
        "date": row["day_date"].isoformat(),
        "label": row["label"],
        "status": row["status"],
        "activeBatches": row.get("active_batches", 0),
        "allBatches": row.get("all_batches", 0),
        "rowsCount": row.get("rows_count", 0),
        "allRowsCount": row.get("all_rows_count", row.get("rows_count", 0)),
        "latestUpload": row["latest_upload"].isoformat() if row.get("latest_upload") else None,
        "deletedAt": row["deleted_at"].isoformat() if row.get("deleted_at") else None,
        "deletedBy": row.get("deleted_by"),
        "deleteReason": row.get("delete_reason"),
    }


def dataset_summary(row):
    return {
        "id": row["id"],
        "expeditionDayId": row.get("expedition_day_id"),
        "datasetKind": row["dataset_kind"],
        "batchName": row.get("batch_name"),
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
        "replacedAt": row["replaced_at"].isoformat() if row.get("replaced_at") else None,
        "replacedByDatasetId": row.get("replaced_by_dataset_id"),
        "replaceReason": row.get("replace_reason"),
        "deletedAt": row["deleted_at"].isoformat() if row["deleted_at"] else None,
        "deletedBy": row.get("deleted_by"),
        "deleteReason": row.get("delete_reason"),
    }


def env_int(name, default):
    try:
        return int(os.environ.get(name, str(default)) or default)
    except (TypeError, ValueError):
        return default


def payment_feed_date_label(day):
    return f"{day.year}-{day.month}-{day.day}"


def payment_feed_date_range(feed_settings=None):
    settings = feed_settings if isinstance(feed_settings, dict) else {}
    try:
        lookback_days = int(settings.get("lookbackDays") or 10)
    except (TypeError, ValueError):
        lookback_days = 10
    lookback_days = max(1, min(31, lookback_days))
    date_until = dt.datetime.now().date()
    date_from = date_until - dt.timedelta(days=lookback_days)
    return {
        "dateFrom": payment_feed_date_label(date_from),
        "dateUntil": payment_feed_date_label(date_until),
        "lookbackDays": lookback_days,
    }


def resolve_payment_feed_url(feed_url, date_range=None):
    url = clean_text(feed_url)
    if not url:
        return ""
    dates = date_range or payment_feed_date_range()
    replacements = {
        "{dateFrom}": dates["dateFrom"],
        "{dateUntil}": dates["dateUntil"],
        "{date_from}": dates["dateFrom"],
        "{date_until}": dates["dateUntil"],
        "{DATE_FROM}": dates["dateFrom"],
        "{DATE_UNTIL}": dates["dateUntil"],
    }
    for needle, value in replacements.items():
        url = url.replace(needle, value)

    parts = urllib.parse.urlsplit(url)
    query = dict(urllib.parse.parse_qsl(parts.query, keep_blank_values=True))
    query["dateFrom"] = dates["dateFrom"]
    query["dateUntil"] = dates["dateUntil"]
    return urllib.parse.urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            parts.path,
            urllib.parse.urlencode(query, doseq=True),
            parts.fragment,
        )
    )


def payment_status_norm(value):
    text = clean_text(value).lower()
    text = unicodedata.normalize("NFKD", text)
    return "".join(char for char in text if not unicodedata.combining(char))


def payment_method_is_cod(value):
    text = payment_status_norm(value)
    return any(
        marker in text
        for marker in (
            "dobirk",
            "dobierk",
            "na dobierku",
            "pri prevzati",
            "platba pri prevzati",
            "cash on delivery",
            "cod",
        )
    )


def classify_feed_payment_status(status_name, paid):
    status = payment_status_norm(status_name)
    paid_text = clean_text(paid).strip().lower()
    if "storno" in status or "zrus" in status:
        return "storno", "Objednávka je ve feedu stornovaná."
    if paid_text in {"1", "true", "ano", "yes"}:
        return "paid", "Platba je podle feedu uhrazená."
    if "platba pripsana" in status or "zaplac" in status:
        return "paid", "Platba je podle statusu uhrazená."
    if "vyrizena" in status and "nevyrizena" not in status:
        return "paid", "Objednávka je podle feedu vyřízená."
    if (
        "pripominka platby" in status
        or "pripomienka platby" in status
        or "ceka na platbu" in status
        or "caka na platbu" in status
        or "nevyrizena" in status
        or "nevybavena" in status
        or paid_text in {"0", "false", "ne", "no"}
    ):
        return "unpaid", "Platba není podle feedu uhrazená."
    return "unknown", "Stav platby se z feedu nepodařilo spolehlivě určit."


def payment_check_message(status, record=None, row=None, lookback_days=10):
    if status == "cod":
        return "Dobírka - platba se řeší u dopravce."
    if status == "missing":
        return f"Objednávka nebyla nalezena v platebním feedu za posledních {lookback_days} dní."
    if record:
        return record.get("message") or ""
    return "Platba nebyla zjištěna."


def payment_row_value(row, key):
    if isinstance(row, dict):
        return row.get(key)
    try:
        return row[key]
    except Exception:
        return ""


def classify_excel_payment_status(row):
    payment_method = payment_row_value(row, "payment_method")
    cod_amount = payment_row_value(row, "cod_amount") or payment_row_value(row, "codAmount")
    if payment_method_is_cod(payment_method) or amount_is_positive(cod_amount):
        return {
            "status": "cod",
            "paid": "cod",
            "sourceStatus": "Dobírka",
            "message": "Dobírka - platba se řeší u dopravce.",
        }

    source_status = clean_text(
        payment_row_value(row, "paid_status")
        or payment_row_value(row, "completion_status")
        or payment_row_value(row, "packeta_status")
        or ""
    )
    normalized_status = payment_status_norm(source_status)

    if any(marker in normalized_status for marker in ("storno", "zrusen", "zruseno", "cancel")):
        return {
            "status": "storno",
            "paid": "storno",
            "sourceStatus": source_status,
            "message": "Excel uvádí storno nebo zrušenou objednávku.",
        }
    if any(marker in normalized_status for marker in ("nezaplacen", "neuhrazen", "neuhraden", "ceka na platbu", "caka na platbu")):
        return {
            "status": "unpaid",
            "paid": "0",
            "sourceStatus": source_status,
            "message": "Excel uvádí neuhrazenou objednávku.",
        }
    if any(marker in normalized_status for marker in ("zaplacen", "uhrazen", "uhraden", "vyrizen", "vybaven", "paid", "hotovo")):
        return {
            "status": "paid",
            "paid": "1",
            "sourceStatus": source_status,
            "message": "Excel uvádí zaplacenou nebo vyřízenou objednávku.",
        }

    return None


def payment_feed_missing_message(shop_result, lookback_days):
    if shop_result and shop_result.get("error"):
        return "Feed e-shopu se nepodařilo načíst: " + clean_text(shop_result.get("error"))
    if shop_result and shop_result.get("rowsSeen") == 0:
        return f"Feed e-shopu nevrátil žádné objednávky za posledních {lookback_days} dní."
    return f"Objednávka nebyla nalezena v platebním feedu za posledních {lookback_days} dní."


def parse_payment_feed_csv(text, delimiter):
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter or ";")
    rows = []
    for row in reader:
        if not isinstance(row, dict):
            continue
        code = clean_text(row.get("code") or row.get("Code") or row.get("objednavka") or row.get("order"))
        if not code:
            continue
        rows.append(
            {
                "code": code,
                "date": clean_text(row.get("date") or row.get("Date")),
                "statusName": clean_text(row.get("statusName") or row.get("status") or row.get("Status")),
                "paid": clean_text(row.get("paid") or row.get("Paid")),
                "packageNumber": clean_text(row.get("packageNumber") or row.get("package") or row.get("trackingNumber")),
            }
        )
    return rows


def fetch_payment_feed_records(feed_settings):
    settings = feed_settings if isinstance(feed_settings, dict) else {}
    date_range = payment_feed_date_range(settings)
    delimiter = settings.get("delimiter") or ";"
    encoding = settings.get("encoding") or "windows-1250"
    records = {}
    rows_seen = 0
    errors = []
    shop_results = {}
    shops = settings.get("shops") or {}

    for shop_code, shop in shops.items():
        if not isinstance(shop, dict):
            continue
        feed_url = clean_text(shop.get("url"))
        if not feed_url:
            error = "CSV feed není nastavený."
            errors.append({"shopCode": shop_code, "error": error})
            shop_results[shop_code] = {"ok": False, "rowsSeen": 0, "error": error}
            continue
        resolved_url = resolve_payment_feed_url(feed_url, date_range)
        try:
            request_obj = urllib.request.Request(
                resolved_url,
                headers={"User-Agent": "ExpedicePaymentSync/1.0"},
            )
            with urllib.request.urlopen(request_obj, timeout=30) as response:
                raw = response.read()
            text = raw.decode(encoding, errors="replace")
            feed_rows = parse_payment_feed_csv(text, delimiter)
            rows_seen += len(feed_rows)
            shop_results[shop_code] = {"ok": True, "rowsSeen": len(feed_rows), "error": ""}
            for feed_row in feed_rows:
                status, message = classify_feed_payment_status(feed_row.get("statusName"), feed_row.get("paid"))
                feed_row["paymentStatus"] = status
                feed_row["message"] = message
                feed_row["shopCode"] = shop_code
                records[(shop_code, feed_row["code"])] = feed_row
        except Exception as exc:
            error = str(exc)
            errors.append({"shopCode": shop_code, "error": error})
            shop_results[shop_code] = {"ok": False, "rowsSeen": 0, "error": error}
    return records, rows_seen, errors, date_range, shop_results


def update_completion_payment_checks(records, date_range, errors=None, shop_results=None):
    ensure_schema()
    lookback_days = date_range.get("lookbackDays", 10)
    configured_shops = sorted({shop_code for shop_code, _order in records.keys()})
    settings = read_settings(include_secrets=True).get("paymentFeeds", {})
    configured_shops.extend(
        code
        for code, shop in (settings.get("shops") or {}).items()
        if isinstance(shop, dict) and clean_text(shop.get("url")) and code not in configured_shops
    )
    if not configured_shops:
        return {"checked": 0, "changed": 0}

    changed = 0
    checked = 0
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT cr.id, cr.shop_code, cr.order_number, cr.payment_method, cr.cod_amount,
                       cr.paid_status, cr.completion_status, cr.packeta_status,
                       cr.payment_check_status, cr.payment_check_message,
                       cr.payment_check_source_status, cr.payment_check_paid,
                       cr.payment_check_order_date, cr.payment_check_package_number
                FROM completion_rows cr
                JOIN datasets d ON d.id = cr.dataset_id
                WHERE d.dataset_kind = 'completion'
                  AND d.deleted_at IS NULL
                  AND d.status = 'active'
                  AND cr.shop_code = ANY(%s)
                """,
                (configured_shops,),
            )
            rows = cur.fetchall()
            for row in rows:
                checked += 1
                key = (row["shop_code"], clean_text(row["order_number"]))
                record = records.get(key)
                if record:
                    status = record.get("paymentStatus") or "unknown"
                    if status != "storno" and (
                        payment_method_is_cod(row.get("payment_method")) or amount_is_positive(row.get("cod_amount"))
                    ):
                        status = "cod"
                        message = payment_check_message(status, lookback_days=lookback_days)
                    else:
                        message = payment_check_message(status, record=record, lookback_days=lookback_days)
                    source_status = record.get("statusName", "")
                    paid = "cod" if status == "cod" else record.get("paid", "")
                    order_date = record.get("date", "")
                    package_number = record.get("packageNumber", "")
                else:
                    fallback = classify_excel_payment_status(row)
                    shop_result = (shop_results or {}).get(row["shop_code"], {})
                    feed_message = payment_feed_missing_message(shop_result, lookback_days)
                    if fallback:
                        status = fallback["status"]
                        message = fallback["message"] + " " + feed_message
                        source_status = fallback["sourceStatus"]
                        paid = fallback["paid"]
                    else:
                        status = "missing"
                        message = feed_message
                        source_status = ""
                        paid = ""
                    order_date = ""
                    package_number = ""

                row_changed = any(
                    clean_text(row.get(field)) != clean_text(value)
                    for field, value in (
                        ("payment_check_status", status),
                        ("payment_check_message", message),
                        ("payment_check_source_status", source_status),
                        ("payment_check_paid", paid),
                        ("payment_check_order_date", order_date),
                        ("payment_check_package_number", package_number),
                    )
                )
                if row_changed:
                    changed += 1
                cur.execute(
                    """
                    UPDATE completion_rows
                    SET payment_check_status = %s,
                        payment_check_message = %s,
                        payment_check_source_status = %s,
                        payment_check_paid = %s,
                        payment_check_order_date = %s,
                        payment_check_package_number = %s,
                        payment_check_feed_shop = %s,
                        payment_check_checked_at = NOW(),
                        payment_check_changed_at = CASE WHEN %s THEN NOW() ELSE payment_check_changed_at END
                    WHERE id = %s
                    """,
                    (
                        status,
                        message,
                        source_status,
                        paid,
                        order_date,
                        package_number,
                        row["shop_code"],
                        row_changed,
                        row["id"],
                    ),
                )
    return {"checked": checked, "changed": changed}


def sync_payment_feeds(trigger_source="background"):
    if not PAYMENT_SYNC_LOCK.acquire(blocking=False):
        return {"ok": False, "skipped": True, "reason": "Synchronizace plateb už běží."}
    sync_id = None
    try:
        ensure_schema()
        settings = read_settings(include_secrets=True).get("paymentFeeds", {})
        date_range = payment_feed_date_range(settings)
        with db_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO payment_feed_syncs (trigger_source, date_from, date_until)
                    VALUES (%s, %s, %s)
                    RETURNING id
                    """,
                    (trigger_source, date_range["dateFrom"], date_range["dateUntil"]),
                )
                sync_id = cur.fetchone()["id"]

        records, rows_seen, errors, date_range, shop_results = fetch_payment_feed_records(settings)
        update_result = update_completion_payment_checks(records, date_range, errors, shop_results)
        status = "ok" if not errors else "warning"
        with db_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    UPDATE payment_feed_syncs
                    SET finished_at = NOW(),
                        status = %s,
                        rows_seen = %s,
                        rows_checked = %s,
                        rows_changed = %s,
                        errors = %s
                    WHERE id = %s
                    RETURNING *
                    """,
                    (
                        status,
                        rows_seen,
                        update_result["checked"],
                        update_result["changed"],
                        Json(errors),
                        sync_id,
                    ),
                )
                sync_row = cur.fetchone()
        return {
            "ok": True,
            "sync": payment_sync_to_api(sync_row),
            "rowsSeen": rows_seen,
            "rowsChecked": update_result["checked"],
            "rowsChanged": update_result["changed"],
            "errors": errors,
            "shopResults": shop_results,
        }
    except Exception as exc:
        if sync_id:
            with db_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE payment_feed_syncs
                        SET finished_at = NOW(), status = 'error', errors = %s
                        WHERE id = %s
                        """,
                        (Json([{"error": str(exc)}]), sync_id),
                    )
        return {"ok": False, "error": str(exc)}
    finally:
        PAYMENT_SYNC_LOCK.release()


def payment_sync_to_api(row):
    if not row:
        return None
    return {
        "id": row["id"],
        "startedAt": row["started_at"].isoformat() if row.get("started_at") else None,
        "finishedAt": row["finished_at"].isoformat() if row.get("finished_at") else None,
        "status": row["status"],
        "trigger": row.get("trigger_source"),
        "dateFrom": row["date_from"].isoformat() if row.get("date_from") else None,
        "dateUntil": row["date_until"].isoformat() if row.get("date_until") else None,
        "rowsSeen": row.get("rows_seen", 0),
        "rowsChecked": row.get("rows_checked", 0),
        "rowsChanged": row.get("rows_changed", 0),
        "errors": row.get("errors") or [],
    }


def latest_payment_sync():
    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM payment_feed_syncs ORDER BY id DESC LIMIT 1")
            return payment_sync_to_api(cur.fetchone())


def payment_sync_active_seconds():
    return max(300, env_int("PAYMENT_FEED_ACTIVE_SYNC_SECONDS", PAYMENT_SYNC_ACTIVE_SECONDS))


def maybe_sync_payment_feeds(trigger_source="active_completion"):
    if os.environ.get("PAYMENT_FEED_SYNC_DISABLED") == "1":
        return {"ok": True, "skipped": True, "reason": "Synchronizace plateb je vypnutá.", "latestSync": latest_payment_sync()}

    ensure_schema()
    interval = payment_sync_active_seconds()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT finished_at
                FROM payment_feed_syncs
                WHERE finished_at IS NOT NULL
                ORDER BY finished_at DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()

    finished_at = row.get("finished_at") if row else None
    if finished_at:
        now = datetime.now(finished_at.tzinfo)
        if now - finished_at < timedelta(seconds=interval):
            return {
                "ok": True,
                "skipped": True,
                "reason": "Poslední synchronizace plateb je ještě čerstvá.",
                "latestSync": latest_payment_sync(),
                "nextSyncAfterSeconds": interval - int((now - finished_at).total_seconds()),
            }

    return sync_payment_feeds(trigger_source)


def default_settings():
    ui_font = clean_text(os.environ.get("APP_UI_FONT", APP_UI_FONT_DEFAULT)).strip().lower()
    if ui_font not in APP_UI_FONT_CHOICES:
        ui_font = APP_UI_FONT_DEFAULT
    return {
        "appearance": {
            "font": ui_font,
            "completionDensity": APP_COMPLETION_DENSITY_DEFAULT,
        },
        "expeditionOrderCodeLabels": dict(EXPEDITION_ORDER_CODE_LABELS_DEFAULT),
        "mapy": {
            "apiKey": os.environ.get("MAPY_API_KEY", ""),
        },
        "printAgent": {
            "testingMode": os.environ.get("PRINT_AGENT_TESTING_MODE") == "1",
        },
        "paymentFeeds": {
            "lookbackDays": env_int("PAYMENT_FEED_LOOKBACK_DAYS", 10),
            "encoding": os.environ.get("PAYMENT_FEED_ENCODING", "windows-1250"),
            "delimiter": os.environ.get("PAYMENT_FEED_DELIMITER", ";"),
            "shops": {
                "iveronika_cz": {
                    "name": "iVeronika.cz",
                    "url": os.environ.get("PAYMENT_FEED_URL_IVERONIKA_CZ")
                    or os.environ.get("ORDER_STATUS_CSV_URL_IVERONIKA_CZ", ""),
                },
                "iveronika_sk": {
                    "name": "iVeronika.sk",
                    "url": os.environ.get("PAYMENT_FEED_URL_IVERONIKA_SK")
                    or os.environ.get("ORDER_STATUS_CSV_URL_IVERONIKA_SK", ""),
                },
                "galantra_cz": {
                    "name": "Galantra.cz",
                    "url": os.environ.get("PAYMENT_FEED_URL_GALANTRA_CZ")
                    or os.environ.get("ORDER_STATUS_CSV_URL_GALANTRA_CZ", ""),
                },
            },
        },
        "productFeed": {
            "url": os.environ.get("PRODUCT_FEED_URL", ""),
            "encoding": os.environ.get("PRODUCT_FEED_ENCODING", "windows-1250"),
            "delimiter": os.environ.get("PRODUCT_FEED_DELIMITER", ";"),
            "downloadTimeoutSeconds": env_int("PRODUCT_FEED_DOWNLOAD_TIMEOUT_SECONDS", PRODUCT_FEED_DEFAULT_TIMEOUT_SECONDS),
            "maxDownloadMegabytes": env_int("PRODUCT_FEED_MAX_DOWNLOAD_MB", PRODUCT_FEED_DEFAULT_MAX_DOWNLOAD_MB),
        },
        "packeta": {
            "apiUrl": os.environ.get("PACKETA_API_URL", "https://www.zasilkovna.cz/api/rest"),
            "apiPassword": os.environ.get("PACKETA_API_PASSWORD", ""),
            "clients": {
                "iveronika_cz": {
                    "name": "iVeronika.cz",
                    "apiPassword": os.environ.get("PACKETA_API_PASSWORD_IVERONIKA_CZ")
                    or os.environ.get("PACKETA_API_PASSWORD_IVERONIKA")
                    or os.environ.get("PACKETA_API_PASSWORD", ""),
                },
                "galantra_cz": {
                    "name": "Galantra.cz",
                    "apiPassword": os.environ.get("PACKETA_API_PASSWORD_GALANTRA_CZ")
                    or os.environ.get("PACKETA_API_PASSWORD_GALANTRA", ""),
                },
            },
        },
        "dpd": {
            "apiBaseUrl": os.environ.get("DPD_API_URL", "https://geoapi.dpd.cz/v1").rstrip("/"),
            "apiKey": os.environ.get("DPD_API_TOKEN") or os.environ.get("DPD_API_KEY", ""),
            "sendEnabled": os.environ.get("DPD_API_ENABLED") == "1",
            "mode": os.environ.get("DPD_API_MODE", "test"),
            "customerDsw": "",
            "customerId": "",
            "shipmentType": "Standard",
            "notification": True,
            "clients": {
                "iveronika_cz": {
                    "name": "iVeronika.cz",
                    "apiKey": os.environ.get("DPD_API_TOKEN_IVERONIKA_CZ")
                    or os.environ.get("DPD_API_KEY_IVERONIKA_CZ")
                    or os.environ.get("DPD_API_TOKEN_IVERONIKA")
                    or os.environ.get("DPD_API_KEY_IVERONIKA", ""),
                    "customerDsw": os.environ.get("DPD_CUSTOMER_DSW_IVERONIKA_CZ")
                    or os.environ.get("DPD_CUSTOMER_DSW_IVERONIKA", ""),
                    "customerId": os.environ.get("DPD_CUSTOMER_ID_IVERONIKA_CZ")
                    or os.environ.get("DPD_CUSTOMER_ID_IVERONIKA", ""),
                },
                "galantra_cz": {
                    "name": "Galantra.cz",
                    "apiKey": os.environ.get("DPD_API_TOKEN_GALANTRA_CZ")
                    or os.environ.get("DPD_API_KEY_GALANTRA_CZ")
                    or os.environ.get("DPD_API_TOKEN_GALANTRA")
                    or os.environ.get("DPD_API_KEY_GALANTRA", ""),
                    "customerDsw": os.environ.get("DPD_CUSTOMER_DSW_GALANTRA_CZ")
                    or os.environ.get("DPD_CUSTOMER_DSW_GALANTRA", ""),
                    "customerId": os.environ.get("DPD_CUSTOMER_ID_GALANTRA_CZ")
                    or os.environ.get("DPD_CUSTOMER_ID_GALANTRA", ""),
                },
            },
            "senderName": "",
            "senderStreet": "",
            "senderHouseNumber": "",
            "senderCity": "",
            "senderZipCode": "",
            "senderCountry": "CZ",
            "senderContactName": "",
            "senderPhone": "",
            "senderEmail": "",
        },
    }


def deep_merge_settings(base, override):
    merged = dict(base)
    if not isinstance(override, dict):
        return merged
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge_settings(merged[key], value)
        else:
            merged[key] = value
    return merged


def clamp_int(value, default, minimum, maximum):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(maximum, number))


def normalize_appearance_settings(settings):
    source = settings if isinstance(settings, dict) else {}
    normalized = dict(source)
    font = clean_text(source.get("font") or APP_UI_FONT_DEFAULT).strip().lower()
    if font not in APP_UI_FONT_CHOICES:
        font = APP_UI_FONT_DEFAULT
    normalized["font"] = font
    completion_density = clean_text(source.get("completionDensity") or APP_COMPLETION_DENSITY_DEFAULT).strip().lower()
    if completion_density not in APP_COMPLETION_DENSITY_CHOICES:
        completion_density = APP_COMPLETION_DENSITY_DEFAULT
    normalized["completionDensity"] = completion_density
    return normalized


def normalize_expedition_order_code_labels(settings):
    source = settings if isinstance(settings, dict) else {}
    normalized = {}
    for code, default_label in EXPEDITION_ORDER_CODE_LABELS_DEFAULT.items():
        label = clean_text(source.get(code)).strip()
        normalized[code] = label[:120] if label else default_label
    return normalized


def normalize_product_feed_settings(settings):
    source = settings if isinstance(settings, dict) else {}
    delimiter = clean_text(source.get("delimiter") or ";")
    normalized = dict(source)
    normalized["url"] = clean_text(source.get("url")).strip()
    normalized["encoding"] = clean_text(source.get("encoding") or "windows-1250").strip() or "windows-1250"
    normalized["delimiter"] = delimiter[:1] if delimiter else ";"
    normalized["downloadTimeoutSeconds"] = clamp_int(
        source.get("downloadTimeoutSeconds"),
        PRODUCT_FEED_DEFAULT_TIMEOUT_SECONDS,
        PRODUCT_FEED_MIN_TIMEOUT_SECONDS,
        PRODUCT_FEED_MAX_TIMEOUT_SECONDS,
    )
    normalized["maxDownloadMegabytes"] = clamp_int(
        source.get("maxDownloadMegabytes"),
        PRODUCT_FEED_DEFAULT_MAX_DOWNLOAD_MB,
        PRODUCT_FEED_MIN_DOWNLOAD_MB,
        PRODUCT_FEED_MAX_DOWNLOAD_MB,
    )
    return normalized


def normalize_carrier_client_code(value):
    text = clean_text(value).lower()
    text = text.replace("https://", "").replace("http://", "").replace("www.", "")
    text = text.replace(".", "_").replace("-", "_").replace(" ", "_")
    if "galantra" in text:
        return "galantra_cz"
    if "iveronika" in text:
        return "iveronika_cz"
    return text.strip("_")


def row_carrier_client_code(row):
    return normalize_carrier_client_code(
        (row or {}).get("shopCode")
        or (row or {}).get("shop_code")
        or (row or {}).get("eshop")
        or (row or {}).get("shop")
        or ""
    )


def request_settings(include_secrets=True):
    try:
        cache = request.environ.setdefault("_expedition_settings_cache", {})
        key = "secret" if include_secrets else "public"
        if key not in cache:
            cache[key] = read_settings(include_secrets=include_secrets)
        return cache[key]
    except RuntimeError:
        return read_settings(include_secrets=include_secrets)


def carrier_client_settings(section_name, row_or_code=None):
    settings = request_settings(include_secrets=True).get(section_name, {})
    code = row_carrier_client_code(row_or_code) if isinstance(row_or_code, dict) else normalize_carrier_client_code(row_or_code)
    client = (settings.get("clients") or {}).get(code, {}) if code else {}
    merged = dict(settings)
    if code in ("iveronika_cz", "galantra_cz"):
        for key, value in client.items():
            if key != "clients":
                merged[key] = value or ""
        for field in ("apiPassword", "apiKey", "customerDsw", "customerId"):
            if field in settings or field in client:
                merged[field] = client.get(field, "")
        if code == "iveronika_cz":
            for field in ("apiPassword", "apiKey", "customerDsw", "customerId"):
                if not merged.get(field):
                    merged[field] = settings.get(field, "")
    else:
        for key, value in client.items():
            if key == "clients":
                continue
            if value not in (None, ""):
                merged[key] = value
    merged["clientCode"] = code or "default"
    merged["clientName"] = client.get("name") or ("Galantra.cz" if code == "galantra_cz" else "iVeronika.cz" if code == "iveronika_cz" else "Výchozí klient")
    return merged


def read_settings(include_secrets=False):
    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT value FROM app_settings WHERE key = 'expedition'")
            row = cur.fetchone()

    settings = deep_merge_settings(default_settings(), row["value"] if row else {})
    settings["appearance"] = normalize_appearance_settings(settings.get("appearance"))
    settings["expeditionOrderCodeLabels"] = normalize_expedition_order_code_labels(
        settings.get("expeditionOrderCodeLabels")
    )
    if include_secrets:
        return settings

    public_settings = json.loads(json.dumps(settings))
    for section, field in (("mapy", "apiKey"), ("packeta", "apiPassword"), ("dpd", "apiKey")):
        value = public_settings.get(section, {}).get(field, "")
        public_settings[section][f"has{field[0].upper()}{field[1:]}"] = bool(value)
        public_settings[section][field] = ""
    for code, client in (public_settings.get("packeta", {}).get("clients") or {}).items():
        value = client.get("apiPassword", "")
        client["hasApiPassword"] = bool(value)
        client["apiPassword"] = ""
    for code, client in (public_settings.get("dpd", {}).get("clients") or {}).items():
        value = client.get("apiKey", "")
        client["hasApiKey"] = bool(value)
        client["apiKey"] = ""
    for code, shop in (public_settings.get("paymentFeeds", {}).get("shops") or {}).items():
        value = shop.get("url", "")
        shop["hasUrl"] = bool(value)
        shop["url"] = ""
    public_settings["paymentFeeds"]["dateRange"] = payment_feed_date_range(public_settings.get("paymentFeeds", {}))
    product_feed = public_settings.get("productFeed", {})
    product_feed["hasUrl"] = bool(product_feed.get("url"))
    product_feed["url"] = ""
    return public_settings


def merge_secret_field(next_section, current_section, field):
    if field not in next_section or next_section.get(field) == "":
        next_section[field] = current_section.get(field, "")
    elif next_section.get(field) == "__CLEAR__":
        next_section[field] = ""


def merge_client_secret_fields(next_section, current_section, field):
    next_clients = next_section.get("clients") or {}
    current_clients = current_section.get("clients") or {}
    for code, next_client in next_clients.items():
        if not isinstance(next_client, dict):
            continue
        merge_secret_field(next_client, current_clients.get(code, {}), field)


def merge_shop_secret_fields(next_section, current_section, field):
    next_shops = next_section.get("shops") or {}
    current_shops = current_section.get("shops") or {}
    for code, next_shop in next_shops.items():
        if not isinstance(next_shop, dict):
            continue
        merge_secret_field(next_shop, current_shops.get(code, {}), field)


def save_settings_payload(payload):
    current = read_settings(include_secrets=True)
    incoming = payload if isinstance(payload, dict) else {}
    next_settings = deep_merge_settings(current, incoming)
    next_settings["appearance"] = normalize_appearance_settings(next_settings.get("appearance"))
    next_settings["expeditionOrderCodeLabels"] = normalize_expedition_order_code_labels(
        next_settings.get("expeditionOrderCodeLabels")
    )
    next_settings.setdefault("productFeed", {})
    merge_secret_field(next_settings["mapy"], current["mapy"], "apiKey")
    merge_secret_field(next_settings["packeta"], current["packeta"], "apiPassword")
    merge_secret_field(next_settings["dpd"], current["dpd"], "apiKey")
    merge_secret_field(next_settings["productFeed"], current.get("productFeed", {}), "url")
    merge_client_secret_fields(next_settings["packeta"], current["packeta"], "apiPassword")
    merge_client_secret_fields(next_settings["dpd"], current["dpd"], "apiKey")
    merge_shop_secret_fields(next_settings["paymentFeeds"], current["paymentFeeds"], "url")
    next_settings["productFeed"] = normalize_product_feed_settings(next_settings["productFeed"])
    next_settings["dpd"]["apiBaseUrl"] = clean_text(next_settings["dpd"].get("apiBaseUrl")).rstrip("/")
    try:
        lookback_days = int(next_settings["paymentFeeds"].get("lookbackDays") or 10)
    except (TypeError, ValueError):
        lookback_days = 10
    next_settings["paymentFeeds"]["lookbackDays"] = max(1, min(31, lookback_days))

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO app_settings (key, value, updated_at)
                VALUES ('expedition', %s, NOW())
                ON CONFLICT (key) DO UPDATE SET
                    value = EXCLUDED.value,
                    updated_at = NOW()
                RETURNING value
                """,
                (Json(next_settings),),
            )
            saved = cur.fetchone()["value"]

    return deep_merge_settings(default_settings(), saved)


class ProductFeedError(Exception):
    pass


def product_feed_settings_from_payload(payload):
    current = read_settings(include_secrets=True).get("productFeed", {})
    incoming = payload if isinstance(payload, dict) else {}
    settings = deep_merge_settings(current, incoming)
    merge_secret_field(settings, current, "url")
    return normalize_product_feed_settings(settings)


def format_size_mb(byte_count):
    return round(byte_count / (1024 * 1024), 2)


def product_feed_image_columns(headers):
    columns = []
    for header in headers:
        key = clean_text(header).strip()
        normalized = key.lower()
        if normalized == "defaultimage" or normalized == "image" or re.fullmatch(r"image\d+", normalized):
            columns.append(key)
    return columns


def product_feed_first_image(row, image_columns):
    for column in image_columns:
        value = clean_text(row.get(column)).strip()
        if value:
            return value
    return ""


def product_image_code_key(value):
    return clean_text(value).strip().upper()


def product_feed_cache_signature(settings):
    payload = {
        "url": settings.get("url") or "",
        "encoding": settings.get("encoding") or "",
        "delimiter": settings.get("delimiter") or "",
        "maxDownloadMegabytes": settings.get("maxDownloadMegabytes") or "",
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def probe_product_feed(settings):
    product_settings = normalize_product_feed_settings(settings)
    feed_url = clean_text(product_settings.get("url")).strip()
    if not feed_url:
        raise ProductFeedError("URL produktového feedu není nastavená.")

    parsed = urllib.parse.urlsplit(feed_url)
    if parsed.scheme not in {"http", "https"}:
        raise ProductFeedError("Produktový feed musí být dostupný přes http nebo https URL.")

    timeout = product_settings["downloadTimeoutSeconds"]
    max_bytes = product_settings["maxDownloadMegabytes"] * 1024 * 1024
    request_obj = urllib.request.Request(
        feed_url,
        headers={"User-Agent": "ExpediceProductFeed/1.0"},
    )

    try:
        with urllib.request.urlopen(request_obj, timeout=timeout) as response:
            content_length = response.headers.get("Content-Length")
            content_length_bytes = int(content_length) if content_length and content_length.isdigit() else None
            content_type = response.headers.get("Content-Type", "")
            if content_length_bytes and content_length_bytes > max_bytes:
                raise ProductFeedError(
                    f"Feed hlásí velikost {format_size_mb(content_length_bytes)} MB, limit je {product_settings['maxDownloadMegabytes']} MB."
                )

            bytes_read = 0
            with tempfile.TemporaryFile() as tmp:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    bytes_read += len(chunk)
                    if bytes_read > max_bytes:
                        raise ProductFeedError(
                            f"Feed je větší než povolený limit {product_settings['maxDownloadMegabytes']} MB."
                        )
                    tmp.write(chunk)

                tmp.seek(0)
                text_stream = io.TextIOWrapper(
                    tmp,
                    encoding=product_settings["encoding"],
                    errors="replace",
                    newline="",
                )
                reader = csv.DictReader(text_stream, delimiter=product_settings["delimiter"])
                headers = [clean_text(header).strip() for header in (reader.fieldnames or []) if clean_text(header).strip()]
                if not headers:
                    raise ProductFeedError("Feed se stáhl, ale CSV hlavička je prázdná.")

                code_column = next((header for header in headers if header.lower() == "code"), "")
                if not code_column:
                    raise ProductFeedError("Feed nemá sloupec code, podle kterého budeme párovat varianty.")

                image_columns = product_feed_image_columns(headers)
                if not image_columns:
                    raise ProductFeedError("Feed nemá sloupce defaultImage/image pro obrázky produktů.")

                rows_seen = 0
                sample = []
                for row in reader:
                    rows_seen += 1
                    if len(sample) < 3:
                        sample.append(
                            {
                                "code": clean_text(row.get(code_column)).strip(),
                                "name": clean_text(row.get("name") or row.get("Name")).strip(),
                                "image": product_feed_first_image(row, image_columns),
                            }
                        )

        return {
            "ok": True,
            "rowsSeen": rows_seen,
            "bytesRead": bytes_read,
            "downloadedMegabytes": format_size_mb(bytes_read),
            "maxDownloadMegabytes": product_settings["maxDownloadMegabytes"],
            "timeoutSeconds": timeout,
            "fieldCount": len(headers),
            "codeColumn": code_column,
            "imageColumns": image_columns,
            "sample": sample,
            "contentType": content_type,
            "contentLength": content_length_bytes,
        }
    except ProductFeedError:
        raise
    except urllib.error.HTTPError as exc:
        raise ProductFeedError(f"Feed vrátil HTTP {exc.code}: {clean_text(exc.reason)}") from exc
    except urllib.error.URLError as exc:
        raise ProductFeedError(f"Feed se nepodařilo stáhnout: {clean_text(exc.reason)}") from exc
    except TimeoutError as exc:
        raise ProductFeedError(f"Stahování feedu překročilo timeout {timeout} s.") from exc
    except csv.Error as exc:
        raise ProductFeedError(f"CSV feed se nepodařilo přečíst: {clean_text(exc)}") from exc
    except UnicodeError as exc:
        raise ProductFeedError(f"Feed se nepodařilo dekódovat: {clean_text(exc)}") from exc


def parse_product_image_feed(settings):
    product_settings = normalize_product_feed_settings(settings)
    feed_url = clean_text(product_settings.get("url")).strip()
    if not feed_url:
        raise ProductFeedError("URL produktového feedu není nastavená.")

    parsed = urllib.parse.urlsplit(feed_url)
    if parsed.scheme not in {"http", "https"}:
        raise ProductFeedError("Produktový feed musí být dostupný přes http nebo https URL.")

    timeout = product_settings["downloadTimeoutSeconds"]
    max_bytes = product_settings["maxDownloadMegabytes"] * 1024 * 1024
    request_obj = urllib.request.Request(
        feed_url,
        headers={"User-Agent": "ExpediceProductImages/1.0"},
    )

    try:
        with urllib.request.urlopen(request_obj, timeout=timeout) as response:
            content_length = response.headers.get("Content-Length")
            content_length_bytes = int(content_length) if content_length and content_length.isdigit() else None
            if content_length_bytes and content_length_bytes > max_bytes:
                raise ProductFeedError(
                    f"Feed hlásí velikost {format_size_mb(content_length_bytes)} MB, limit je {product_settings['maxDownloadMegabytes']} MB."
                )

            bytes_read = 0
            with tempfile.TemporaryFile() as tmp:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    bytes_read += len(chunk)
                    if bytes_read > max_bytes:
                        raise ProductFeedError(
                            f"Feed je větší než povolený limit {product_settings['maxDownloadMegabytes']} MB."
                        )
                    tmp.write(chunk)

                tmp.seek(0)
                text_stream = io.TextIOWrapper(
                    tmp,
                    encoding=product_settings["encoding"],
                    errors="replace",
                    newline="",
                )
                reader = csv.DictReader(text_stream, delimiter=product_settings["delimiter"])
                headers = [clean_text(header).strip() for header in (reader.fieldnames or []) if clean_text(header).strip()]
                if not headers:
                    raise ProductFeedError("Feed se stáhl, ale CSV hlavička je prázdná.")

                code_column = next((header for header in headers if header.lower() == "code"), "")
                if not code_column:
                    raise ProductFeedError("Feed nemá sloupec code, podle kterého budeme párovat varianty.")

                image_columns = product_feed_image_columns(headers)
                if not image_columns:
                    raise ProductFeedError("Feed nemá sloupce defaultImage/image pro obrázky produktů.")

                rows_seen = 0
                images = {}
                for row in reader:
                    rows_seen += 1
                    code = product_image_code_key(row.get(code_column))
                    if not code or code in images:
                        continue
                    image = product_feed_first_image(row, image_columns)
                    if image:
                        images[code] = image

        return {
            "images": images,
            "rowsSeen": rows_seen,
            "bytesRead": bytes_read,
            "imageColumns": image_columns,
            "loadedAt": time.time(),
        }
    except ProductFeedError:
        raise
    except urllib.error.HTTPError as exc:
        raise ProductFeedError(f"Feed vrátil HTTP {exc.code}: {clean_text(exc.reason)}") from exc
    except urllib.error.URLError as exc:
        raise ProductFeedError(f"Feed se nepodařilo stáhnout: {clean_text(exc.reason)}") from exc
    except TimeoutError as exc:
        raise ProductFeedError(f"Stahování feedu překročilo timeout {timeout} s.") from exc
    except csv.Error as exc:
        raise ProductFeedError(f"CSV feed se nepodařilo přečíst: {clean_text(exc)}") from exc
    except UnicodeError as exc:
        raise ProductFeedError(f"Feed se nepodařilo dekódovat: {clean_text(exc)}") from exc


def product_image_cache():
    settings = normalize_product_feed_settings(read_settings(include_secrets=True).get("productFeed", {}))
    if not clean_text(settings.get("url")).strip():
        return {
            "configured": False,
            "signature": "",
            "images": {},
            "rowsSeen": 0,
            "bytesRead": 0,
            "imageColumns": [],
            "loadedAt": 0,
        }

    signature = product_feed_cache_signature(settings)
    now = time.time()
    with PRODUCT_IMAGE_CACHE_LOCK:
        if (
            PRODUCT_IMAGE_CACHE["signature"] == signature
            and PRODUCT_IMAGE_CACHE["images"]
            and now - PRODUCT_IMAGE_CACHE["loadedAt"] < PRODUCT_IMAGE_CACHE_SECONDS
        ):
            return {**PRODUCT_IMAGE_CACHE, "configured": True, "stale": False}

        try:
            parsed = parse_product_image_feed(settings)
        except ProductFeedError:
            if PRODUCT_IMAGE_CACHE["signature"] == signature and PRODUCT_IMAGE_CACHE["images"]:
                return {**PRODUCT_IMAGE_CACHE, "configured": True, "stale": True}
            raise
        PRODUCT_IMAGE_CACHE.update(
            {
                "signature": signature,
                "loadedAt": parsed["loadedAt"],
                "images": parsed["images"],
                "rowsSeen": parsed["rowsSeen"],
                "bytesRead": parsed["bytesRead"],
                "imageColumns": parsed["imageColumns"],
                "error": "",
            }
        )
        return {**PRODUCT_IMAGE_CACHE, "configured": True, "stale": False}


def strict_positive_integer_text(value):
    text = clean_text(value).strip().replace(",", ".")
    if not re.fullmatch(r"\d+(?:\.0+)?", text):
        return ""
    number = int(float(text))
    return str(number) if number > 0 else ""


def sorting_initial_quantity_from_cells(cells, variant_code):
    if not isinstance(cells, list):
        return ""
    target = clean_text(variant_code).strip().upper()
    if not target:
        return ""
    for index, cell in enumerate(cells[:-1]):
        if clean_text(cell).strip().upper() != target:
            continue
        quantity = strict_positive_integer_text(cells[index + 1])
        if quantity:
            return quantity
    return ""


def sorting_initial_quantity_from_item(item):
    if not isinstance(item, dict):
        return ""
    return sorting_initial_quantity_from_cells(item.get("cells"), item.get("variantCode"))


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
        "initialQuantity": row["initial_quantity_text"] or sorting_initial_quantity_from_cells(row["cells"], row["variant_code"]),
        "paircode": row["paircode"],
        "history": row["history"],
        "cells": row["cells"],
        "raw": row["raw_row"],
    }


def completion_row_to_api(row):
    delivery = delivery_info_from_row(row)
    return {
        "id": row["id"],
        "datasetId": row["dataset_id"],
        "shopCode": row.get("shop_code"),
        "rowNumber": row["row_number"],
        "firstName": row["first_name"],
        "lastName": row["last_name"],
        "note": row["note"],
        "carrierNote": row.get("carrier_note") or "",
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
        "paymentCheckStatus": row.get("payment_check_status"),
        "paymentCheckMessage": row.get("payment_check_message"),
        "paymentCheckSourceStatus": row.get("payment_check_source_status"),
        "paymentCheckPaid": row.get("payment_check_paid"),
        "paymentCheckOrderDate": row.get("payment_check_order_date"),
        "paymentCheckPackageNumber": row.get("payment_check_package_number"),
        "paymentCheckFeedShop": row.get("payment_check_feed_shop"),
        "paymentCheckCheckedAt": row["payment_check_checked_at"].isoformat() if row.get("payment_check_checked_at") else None,
        "paymentCheckChangedAt": row["payment_check_changed_at"].isoformat() if row.get("payment_check_changed_at") else None,
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
        "labelCacheStatus": row.get("label_cache_status") or "",
        "labelCacheError": row.get("label_cache_error") or "",
        "labelCacheFetchedAt": row["label_cache_fetched_at"].isoformat()
        if row.get("label_cache_fetched_at")
        else None,
        "labelCacheSize": row.get("label_cache_size") or 0,
        "addressValidationStatus": row.get("address_validation_status") or "",
        "addressValidationMessage": row.get("address_validation_message") or "",
        "addressValidationQuery": row.get("address_validation_query") or "",
        "addressValidationCheckedAt": row["address_validation_checked_at"].isoformat()
        if row.get("address_validation_checked_at")
        else None,
        "addressValidationResult": row.get("address_validation_result") or {},
        "deliveryCarrier": delivery["carrier"],
        "deliveryCarrierLabel": delivery["carrierLabel"],
        "deliveryService": delivery["service"],
        "deliveryServiceLabel": delivery["serviceLabel"],
        "deliveryRequiresCarrier": delivery["requiresCarrier"],
        "deliveryRequiresAddress": delivery["requiresAddress"],
        "deliveryIsPacketa": delivery["isPacketa"],
        "deliveryIsDpd": delivery["isDpd"],
        "deliveryIsGiftVoucher": delivery["isGiftVoucher"],
        "currency": shipment_currency(row),
        "cells": row["cells"],
        "raw": row["raw_row"],
    }


def packeta_text(value):
    return xml_escape(clean_text(value).strip(), {'"': "&quot;", "'": "&apos;"})


def carrier_note_raw(row):
    return clean_text(row.get("carrierNote") or row.get("carrier_note")).strip()


def carrier_note_clean(value, max_length):
    text = clean_text(value).replace('"', " ").replace(";", " ")
    text = "".join(char if ord(char) >= 32 else " " for char in text)
    text = " ".join(text.split())
    if max_length and len(text) > max_length:
        return text[:max_length].rstrip()
    return text


def carrier_note_for_packeta(row):
    return carrier_note_clean(carrier_note_raw(row), 128)


def carrier_note_for_dpd_label(row):
    return carrier_note_clean(carrier_note_raw(row), 35)


def carrier_note_was_shortened(row, prepared):
    original = carrier_note_clean(carrier_note_raw(row), 0)
    return bool(original and prepared and original != prepared)


def packeta_contains(value, *needles):
    text = searchable_text(value)
    return any(searchable_text(needle) in text for needle in needles)


def packeta_is_sk(row):
    return bool(delivery_info_from_row(row).get("isSk"))


def packeta_eshop(row):
    shop = row.get("shopCode", "")
    if shop.startswith("galantra") and packeta_is_sk(row):
        return "Galantra.sk"
    if shop.startswith("galantra"):
        return "Galantra.cz"
    if packeta_is_sk(row):
        return "iVeronika.sk"
    return "iVeronika.cz"


def packeta_route(row):
    shipping = row.get("shippingMethod", "")
    delivery = delivery_info_from_row(row)
    if delivery["service"] == "packeta_sk_courier":
        return {"addressId": "131", "service": "sk_courier"}
    if packeta_contains(shipping, "ceska posta", "česká pošta"):
        return {"addressId": "13", "service": "ceska_posta"}
    if packeta_contains(shipping, "prepravni sluzba", "přepravní služba", "kuryr", "kurýr"):
        return {"addressId": "106", "service": "cz_courier"}
    return {"addressId": clean_text(row.get("packetaId")), "service": "pickup_point"}


def amount_is_positive(value):
    text = clean_text(value).replace(",", ".")
    number_text = "".join(char for char in text if char.isdigit() or char in ".-")
    if not number_text or number_text in (".", "-", "-."):
        return False
    try:
        return float(number_text) > 0
    except ValueError:
        return False


def packeta_requires_cod(row):
    text = " ".join(
        clean_text(row.get(key))
        for key in (
            "paymentMethod",
            "paymentStatus",
            "paidStatus",
            "shippingMethod",
            "note",
            "completionStatus",
            "packetaStatus",
        )
    )
    return packeta_contains(text, "dobirk", "dobierk", "dobírk", "na dobierku", "pri prevzati", "platba pri prevzati", "cash on delivery", "cod")


def packeta_requires_verified_address(row):
    return packeta_route(row).get("service") != "pickup_point"


def packeta_address_is_verified(row):
    return clean_text(row.get("addressValidationStatus") or row.get("address_validation_status")).lower() == "verified"


def completion_row_is_cancelled(row):
    payment_status = clean_text(row.get("paymentCheckStatus") or row.get("payment_check_status")).lower()
    if payment_status == "storno":
        return True
    status_text = " ".join(
        clean_text(row.get(key))
        for key in (
            "completionStatus",
            "completion_status",
            "packetaStatus",
            "packeta_status",
            "paidStatus",
            "paid_status",
            "note",
        )
    )
    normalized = payment_status_norm(status_text)
    return "storno" in normalized or "zrus" in normalized or "cancel" in normalized


def packeta_skip_reason(row):
    delivery = delivery_info_from_row(row)
    status_text = " ".join(
        clean_text(row.get(key))
        for key in ("completionStatus", "packetaStatus", "labelPrinted", "note", "shippingMethod")
    )
    if not clean_text(row.get("orderNumber")):
        return "chybi cislo objednavky"
    if completion_row_is_cancelled(row):
        return "objednavka je STORNO - neposilat dopravci"
    if packeta_contains(status_text, "storno", "fault", "error", "chyba"):
        return "storno nebo chyba"
    if delivery["isGiftVoucher"]:
        return "darkovy poukaz se neposila dopravci"
    if delivery["isDpd"]:
        return "DPD patri do DPD vystupu"
    if not delivery["isPacketa"]:
        return "doprava nepatri do Zasilkovny/Packety"
    if clean_text(row.get("packetaShipmentId")):
        return "zasillka uz ma ID"
    route = packeta_route(row)
    if not route["addressId"]:
        return "chybi Zasilkovna ID / addressId"
    if packeta_requires_cod(row) and not amount_is_positive(row.get("codAmount")):
        return "dobirka nema vyplnenou castku"
    if packeta_requires_verified_address(row) and not packeta_address_is_verified(row):
        return "doruceni na adresu neni overene pres Mapy.com"
    return ""


def packeta_dry_run_packet(row):
    route = packeta_route(row)
    currency = shipment_currency(row)
    client_settings = carrier_client_settings("packeta", row)
    value = clean_text(row.get("amount")) or ("29" if currency == "EUR" else "0")
    carrier_note = carrier_note_for_packeta(row)
    company = ""
    note = clean_text(row.get("note"))
    if "//" in note:
        company = note.split("//", 1)[0].strip()
    elif packeta_contains(note, "dominik", "firma", "company"):
        company = note

    attrs = {
        "number": clean_text(row.get("orderNumber")),
        "name": clean_text(row.get("firstName")),
        "surname": clean_text(row.get("lastName")),
        "phone": clean_text(row.get("phone")),
        "email": clean_text(row.get("email")),
        "street": clean_text(row.get("streetWithNumber") or row.get("street")),
        "city": clean_text(row.get("city")),
        "zip": clean_text(row.get("zipCode")),
        "company": company,
        "addressId": route["addressId"],
        "currency": currency,
        "value": value,
        "eshop": packeta_eshop(row),
        "cod": clean_text(row.get("codAmount")),
        "weight": clean_text(row.get("weight")),
        "note": carrier_note,
    }

    xml_parts = [
        "<createPacket>",
        "<apiPassword>DRY_RUN_PASSWORD_OMITTED</apiPassword>",
        "<packetAttributes>",
        "<packetCourierNumber><packetId>1234567890</packetId></packetCourierNumber>",
    ]
    for key in (
        "number",
        "name",
        "surname",
        "phone",
        "email",
        "street",
        "city",
        "zip",
        "company",
        "addressId",
        "currency",
        "value",
        "eshop",
        "cod",
        "weight",
        "note",
    ):
        if attrs[key] or key in ("company", "cod"):
            xml_parts.append(f"<{key}>{packeta_text(attrs[key])}</{key}>")
    xml_parts.extend(["</packetAttributes>", "</createPacket>"])

    warnings = []
    if not attrs["phone"]:
        warnings.append("chybi telefon")
    if not attrs["email"]:
        warnings.append("chybi e-mail")
    if carrier_note_was_shortened(row, carrier_note):
        warnings.append("poznamka pro prepravce byla zkracena")
    if not attrs["street"] and route["service"] != "pickup_point":
        warnings.append("kuryr bez ulice")
    if not attrs["weight"]:
        warnings.append("chybi vaha")

    return {
        "rowId": row.get("id"),
        "rowNumber": row.get("rowNumber"),
        "orderNumber": attrs["number"],
        "customer": " ".join(part for part in (attrs["name"], attrs["surname"]) if part),
        "shippingMethod": clean_text(row.get("shippingMethod")),
        "shopCode": row_carrier_client_code(row),
        "clientCode": client_settings.get("clientCode"),
        "clientName": client_settings.get("clientName"),
        "clientConfigured": bool(client_settings.get("apiPassword")),
        "service": route["service"],
        "addressId": attrs["addressId"],
        "eshop": attrs["eshop"],
        "currency": attrs["currency"],
        "value": attrs["value"],
        "cod": attrs["cod"],
        "weight": attrs["weight"],
        "warnings": warnings,
        "requestXml": "".join(xml_parts),
    }


@app.route("/")
def index():
    return send_from_directory(APP_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    if path.startswith("api/"):
        return jsonify({"error": "Not found"}), 404
    if path.strip("/").lower() in {"roztrideni", "kompletace", "eany", "nastaveni"}:
        return send_from_directory(APP_DIR, "index.html")
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
    include_deleted = include_deleted_for_admin()
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


@app.route("/api/expedition-days")
def list_expedition_days():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    include_deleted = include_deleted_for_admin()
    day_filter = "" if include_deleted else "WHERE ed.status = 'active'"
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT
                    ed.*,
                    COUNT(d.id) FILTER (WHERE d.status = 'active') AS active_batches,
                    COUNT(d.id) AS all_batches,
                    COALESCE(SUM(d.rows_count) FILTER (WHERE d.status = 'active'), 0) AS rows_count,
                    COALESCE(SUM(d.rows_count), 0) AS all_rows_count,
                    MAX(d.uploaded_at) AS latest_upload
                FROM expedition_days ed
                LEFT JOIN datasets d ON d.expedition_day_id = ed.id
                {day_filter}
                GROUP BY ed.id
                ORDER BY ed.day_date DESC
                """
            )
            days = [expedition_day_summary(row) for row in cur.fetchall()]

    return jsonify({"days": days})


def full_expedition_day_payload(cur, day_date, include_deleted=False):
    cur.execute(
        """
        SELECT
            ed.*,
            COUNT(d.id) FILTER (WHERE d.status = 'active') AS active_batches,
            COUNT(d.id) AS all_batches,
            COALESCE(SUM(d.rows_count) FILTER (WHERE d.status = 'active'), 0) AS rows_count,
            COALESCE(SUM(d.rows_count), 0) AS all_rows_count,
            MAX(d.uploaded_at) AS latest_upload
        FROM expedition_days ed
        LEFT JOIN datasets d ON d.expedition_day_id = ed.id
        WHERE ed.day_date = %s
        GROUP BY ed.id
        """,
        (day_date,),
    )
    day = cur.fetchone()
    if not day:
        return None
    if day["status"] != "active" and not include_deleted:
        return None

    filters = ["expedition_day_id = %s"]
    params = [day["id"]]
    if not include_deleted:
        filters.append("status = 'active'")
    where = " AND ".join(filters)
    cur.execute(
        f"""
        SELECT * FROM datasets
        WHERE {where}
        ORDER BY dataset_kind, shop_code, uploaded_at DESC, id DESC
        """,
        params,
    )
    datasets_raw = cur.fetchall()
    datasets = [dataset_summary(row) for row in datasets_raw]

    active_sorting = next(
        (row for row in datasets_raw if row["dataset_kind"] == "sorting" and row["status"] == "active"),
        next((row for row in datasets_raw if row["dataset_kind"] == "sorting"), None),
    )
    active_completion = next(
        (row for row in datasets_raw if row["dataset_kind"] == "completion" and row["status"] == "active"),
        next((row for row in datasets_raw if row["dataset_kind"] == "completion"), None),
    )

    sorting_rows = []
    completion_rows = []
    if active_sorting:
        cur.execute(
            "SELECT * FROM dataset_rows WHERE dataset_id = %s ORDER BY row_number NULLS LAST, id",
            (active_sorting["id"],),
        )
        sorting_rows = [row_to_api(row) for row in cur.fetchall()]
    if active_completion:
        cur.execute(
            "SELECT * FROM completion_rows WHERE dataset_id = %s ORDER BY row_number NULLS LAST, id",
            (active_completion["id"],),
        )
        completion_rows = [completion_row_to_api(row) for row in cur.fetchall()]

    return {
        "day": expedition_day_summary(day),
        "datasets": datasets,
        "sorting": [item for item in datasets if item["datasetKind"] == "sorting"],
        "completion": [item for item in datasets if item["datasetKind"] == "completion"],
        "activeSorting": {
            "dataset": dataset_summary(active_sorting) if active_sorting else None,
            "rows": sorting_rows,
        },
        "activeCompletion": {
            "dataset": dataset_summary(active_completion) if active_completion else None,
            "rows": completion_rows,
        },
    }


@app.route("/api/expedition-days/initial")
def initial_expedition_day():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    include_deleted = include_deleted_for_admin()
    requested_date = clean_text(request.args.get("date"))
    day_filter = "" if include_deleted else "WHERE ed.status = 'active'"
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT
                    ed.*,
                    COUNT(d.id) FILTER (WHERE d.status = 'active') AS active_batches,
                    COUNT(d.id) AS all_batches,
                    COALESCE(SUM(d.rows_count) FILTER (WHERE d.status = 'active'), 0) AS rows_count,
                    COALESCE(SUM(d.rows_count), 0) AS all_rows_count,
                    MAX(d.uploaded_at) AS latest_upload
                FROM expedition_days ed
                LEFT JOIN datasets d ON d.expedition_day_id = ed.id
                {day_filter}
                GROUP BY ed.id
                ORDER BY ed.day_date DESC
                """
            )
            days = [expedition_day_summary(row) for row in cur.fetchall()]

            selected_date = ""
            if requested_date and any(day["date"] == requested_date for day in days):
                selected_date = requested_date
            elif days:
                selected_date = days[0]["date"]

            if not selected_date:
                return jsonify(
                    {
                        "days": days,
                        "day": None,
                        "datasets": [],
                        "sorting": [],
                        "completion": [],
                        "activeSorting": {"dataset": None, "rows": []},
                        "activeCompletion": {"dataset": None, "rows": []},
                    }
                )

            payload = full_expedition_day_payload(cur, selected_date, include_deleted)
            if not payload:
                return jsonify({"error": "Expedition day not found"}), 404
            payload["days"] = days

    return jsonify(payload)


@app.route("/api/expedition-days/<day_date>")
def get_expedition_day(day_date):
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    include_deleted = include_deleted_for_admin()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    ed.*,
                    COUNT(d.id) FILTER (WHERE d.status = 'active') AS active_batches,
                    COUNT(d.id) AS all_batches,
                    COALESCE(SUM(d.rows_count) FILTER (WHERE d.status = 'active'), 0) AS rows_count,
                    COALESCE(SUM(d.rows_count), 0) AS all_rows_count,
                    MAX(d.uploaded_at) AS latest_upload
                FROM expedition_days ed
                LEFT JOIN datasets d ON d.expedition_day_id = ed.id
                WHERE ed.day_date = %s
                GROUP BY ed.id
                """,
                (day_date,),
            )
            day = cur.fetchone()
            if not day:
                return jsonify({"error": "Expedition day not found"}), 404
            if day["status"] != "active" and not include_deleted:
                return jsonify({"error": "Expedition day not found"}), 404

            filters = ["expedition_day_id = %s"]
            params = [day["id"]]
            if not include_deleted:
                filters.append("status = 'active'")
            where = " AND ".join(filters)
            cur.execute(
                f"""
                SELECT * FROM datasets
                WHERE {where}
                ORDER BY dataset_kind, shop_code, uploaded_at DESC, id DESC
                """,
                params,
            )
            datasets = [dataset_summary(row) for row in cur.fetchall()]

    return jsonify(
        {
            "day": expedition_day_summary(day),
            "datasets": datasets,
            "sorting": [item for item in datasets if item["datasetKind"] == "sorting"],
            "completion": [item for item in datasets if item["datasetKind"] == "completion"],
        }
    )


@app.route("/api/expedition-days/<day_date>/full")
def get_full_expedition_day(day_date):
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    include_deleted = include_deleted_for_admin()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    ed.*,
                    COUNT(d.id) FILTER (WHERE d.status = 'active') AS active_batches,
                    COUNT(d.id) AS all_batches,
                    COALESCE(SUM(d.rows_count) FILTER (WHERE d.status = 'active'), 0) AS rows_count,
                    COALESCE(SUM(d.rows_count), 0) AS all_rows_count,
                    MAX(d.uploaded_at) AS latest_upload
                FROM expedition_days ed
                LEFT JOIN datasets d ON d.expedition_day_id = ed.id
                WHERE ed.day_date = %s
                GROUP BY ed.id
                """,
                (day_date,),
            )
            day = cur.fetchone()
            if not day:
                return jsonify({"error": "Expedition day not found"}), 404
            if day["status"] != "active" and not include_deleted:
                return jsonify({"error": "Expedition day not found"}), 404

            filters = ["expedition_day_id = %s"]
            params = [day["id"]]
            if not include_deleted:
                filters.append("status = 'active'")
            where = " AND ".join(filters)
            cur.execute(
                f"""
                SELECT * FROM datasets
                WHERE {where}
                ORDER BY dataset_kind, shop_code, uploaded_at DESC, id DESC
                """,
                params,
            )
            datasets_raw = cur.fetchall()
            datasets = [dataset_summary(row) for row in datasets_raw]

            active_sorting = next(
                (row for row in datasets_raw if row["dataset_kind"] == "sorting" and row["status"] == "active"),
                next((row for row in datasets_raw if row["dataset_kind"] == "sorting"), None),
            )
            active_completion = next(
                (row for row in datasets_raw if row["dataset_kind"] == "completion" and row["status"] == "active"),
                next((row for row in datasets_raw if row["dataset_kind"] == "completion"), None),
            )

            sorting_rows = []
            completion_rows = []
            if active_sorting:
                cur.execute(
                    "SELECT * FROM dataset_rows WHERE dataset_id = %s ORDER BY row_number NULLS LAST, id",
                    (active_sorting["id"],),
                )
                sorting_rows = [row_to_api(row) for row in cur.fetchall()]
            if active_completion:
                cur.execute(
                    "SELECT * FROM completion_rows WHERE dataset_id = %s ORDER BY row_number NULLS LAST, id",
                    (active_completion["id"],),
                )
                completion_rows = [completion_row_to_api(row) for row in cur.fetchall()]

    return jsonify(
        {
            "day": expedition_day_summary(day),
            "datasets": datasets,
            "sorting": [item for item in datasets if item["datasetKind"] == "sorting"],
            "completion": [item for item in datasets if item["datasetKind"] == "completion"],
            "activeSorting": {
                "dataset": dataset_summary(active_sorting) if active_sorting else None,
                "rows": sorting_rows,
            },
            "activeCompletion": {
                "dataset": dataset_summary(active_completion) if active_completion else None,
                "rows": completion_rows,
            },
        }
    )


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
    batch_name = clean_text(payload.get("batchName")) or display_date_label(dataset_date)
    replace_mode = clean_text(payload.get("replaceMode")) or "replace-active"
    label = clean_text(payload.get("label")) or f"{batch_name} | {dataset_kind} | {dataset_time}"

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            expedition_day = ensure_expedition_day(cur, dataset_date, batch_name)
            cur.execute(
                """
                INSERT INTO datasets (
                    expedition_day_id, dataset_kind, batch_name,
                    shop_code, shop_name, source_system, external_batch_id,
                    dataset_date, dataset_time, uploaded_at_local, label, source,
                    workbook_name, worksheet_name, source_filename, rows_count,
                    headers, raw_payload
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    expedition_day["id"],
                    dataset_kind,
                    batch_name,
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
            replaced_datasets = []
            if replace_mode == "replace-active":
                cur.execute(
                    """
                    UPDATE datasets
                    SET status = 'replaced',
                        replaced_at = NOW(),
                        replaced_by_dataset_id = %s,
                        replace_reason = %s
                    WHERE id <> %s
                      AND status = 'active'
                      AND expedition_day_id = %s
                      AND dataset_kind = %s
                      AND COALESCE(shop_code, '') = COALESCE(%s, '')
                      AND COALESCE(batch_name, '') = COALESCE(%s, '')
                    RETURNING *
                    """,
                    (
                        dataset["id"],
                        "Nahrazeno novym uploadem stejneho expedicniho dne",
                        dataset["id"],
                        expedition_day["id"],
                        dataset_kind,
                        shop_code,
                        batch_name,
                    ),
                )
                replaced_datasets = [dataset_summary(row) for row in cur.fetchall()]

            for item in rows:
                if not isinstance(item, dict):
                    continue
                row_shop_code = infer_row_shop_code(item, shop_code if shop_code != "mixed" else "")
                if dataset_kind == "completion":
                    insert_completion_row(cur, dataset["id"], item, row_shop_code)
                    continue
                quantity = clean_text(item.get("quantity"))
                initial_quantity = clean_text(item.get("initialQuantity")) or sorting_initial_quantity_from_item(item)
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
                        initial_quantity,
                        clean_text(item.get("paircode")),
                        clean_text(item.get("history")),
                        Json(item.get("cells") if isinstance(item.get("cells"), list) else []),
                        Json(item),
                    ),
                )

    return jsonify(
        {
            "ok": True,
            "dataset": dataset_summary(dataset),
            "expeditionDay": expedition_day_summary(expedition_day),
            "rows": len(rows),
            "replacedDatasets": replaced_datasets,
        }
    )


def insert_completion_row(cur, dataset_id, item, shop_code=""):
    cur.execute(
        """
        INSERT INTO completion_rows (
            dataset_id, shop_code, row_number, first_name, last_name, note, carrier_note, street_with_number,
            city, zip_code, phone, email, weight, cod_amount, payment_method,
            order_number, shipping_method, amount, quantity_text, paid_status,
            expedition_number, expedition_order_code, packeta_id, completion_status,
            order_id, street, house_number, dpd_flag, packeta_status,
            packeta_shipment_id, order_date, twisto_paid, dpd_order_and_pieces,
            canceled_order_backup, label_printed, cells, raw_row
        )
        VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        """,
        (
            dataset_id,
            shop_code,
            item.get("rowNumber"),
            clean_text(item.get("firstName")),
            clean_text(item.get("lastName")),
            clean_text(item.get("note")),
            clean_text(item.get("carrierNote") or item.get("carrier_note") or item.get("transportNote")),
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
    include_deleted = include_deleted_for_admin()
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


def packeta_api_url(settings=None):
    packeta_settings = settings or request_settings(include_secrets=True).get("packeta", {})
    return packeta_settings.get("apiUrl") or "https://www.zasilkovna.cz/api/rest"


def packeta_validation_xml(request_xml, password):
    xml = request_xml.replace("<createPacket>", "<packetAttributesValid>", 1)
    xml = xml.replace("</createPacket>", "</packetAttributesValid>", 1)
    xml = xml.replace("DRY_RUN_PASSWORD_OMITTED", packeta_text(password), 1)
    xml = xml.replace(
        "\n  <packetCourierNumber>\n    <packetId>1234567890</packetId>\n  </packetCourierNumber>",
        "",
    )
    return xml


def packeta_create_xml(request_xml, password):
    return request_xml.replace("DRY_RUN_PASSWORD_OMITTED", packeta_text(password), 1)


def xml_tag_text(response_text, tag_name):
    text = clean_text(response_text)
    start = text.find(f"<{tag_name}>")
    end = text.find(f"</{tag_name}>", start + len(tag_name) + 2)
    if start < 0 or end < 0:
        return ""
    return text[start + len(tag_name) + 2 : end].strip()


def packeta_response_status(response_text):
    compact = clean_text(response_text).lower().replace(" ", "").replace("\n", "").replace("\r", "")
    if "<status>ok</status>" in compact:
        return "ok"
    if "<status>fault</status>" in compact:
        return "fault"
    if "<status>error</status>" in compact:
        return "error"
    return "unknown"


def packeta_post_validation_xml(validation_xml, settings=None):
    timeout = int_from_text(os.environ.get("PACKETA_API_TIMEOUT")) or 20
    request_data = validation_xml.encode("utf-8")
    packeta_request = urllib.request.Request(
        packeta_api_url(settings),
        data=request_data,
        headers={"Content-Type": "application/xml; charset=utf-8"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(packeta_request, timeout=timeout) as response:
            response_text = response.read().decode("utf-8", "replace")
            status = packeta_response_status(response_text)
            return {
                "httpStatus": response.getcode(),
                "responseText": response_text,
                "status": status,
                "valid": status == "ok",
                "error": "",
            }
    except urllib.error.HTTPError as exc:
        response_text = exc.read().decode("utf-8", "replace")
        status = packeta_response_status(response_text)
        return {
            "httpStatus": exc.code,
            "responseText": response_text,
            "status": status,
            "valid": False,
            "error": clean_text(exc.reason) or "HTTP error",
        }
    except urllib.error.URLError as exc:
        return {
            "httpStatus": 0,
            "responseText": "",
            "status": "request_error",
            "valid": False,
            "error": clean_text(getattr(exc, "reason", exc)),
        }


def dpd_api_url(settings=None):
    dpd_settings = settings or request_settings(include_secrets=True).get("dpd", {})
    return dpd_settings.get("apiBaseUrl", "").rstrip("/")


def dpd_api_token(settings=None):
    dpd_settings = settings or request_settings(include_secrets=True).get("dpd", {})
    return dpd_settings.get("apiKey", "")


def dpd_country(row):
    return country_from_order_number(row)


def shipment_currency(row):
    return "EUR" if country_from_order_number(row) == "SK" else "CZK"


def dpd_recipient_name(row):
    return " ".join(part for part in [row.get("firstName"), row.get("lastName")] if part).strip()


def dpd_address_text(row):
    return clean_text(row.get("streetWithNumber")) or " ".join(
        part for part in [clean_text(row.get("street")), clean_text(row.get("houseNumber"))] if part
    )


def dpd_skip_reason(row):
    delivery = delivery_info_from_row(row)
    if not delivery["isDpd"]:
        return "radek nepatri do DPD"
    if not clean_text(row.get("orderNumber")):
        return "chybi cislo objednavky"
    if completion_row_is_cancelled(row):
        return "objednavka je STORNO - neposilat dopravci"
    if not dpd_recipient_name(row):
        return "chybi jmeno zakaznika"
    if not clean_text(row.get("phone")) and not clean_text(row.get("email")):
        return "chybi telefon nebo e-mail"

    if delivery["service"] == "dpd_courier":
        if not dpd_address_text(row):
            return "chybi adresa"
        if not clean_text(row.get("city")):
            return "chybi mesto"
        if not clean_text(row.get("zipCode")):
            return "chybi PSC"
        if row.get("addressValidationStatus") not in ("verified", ""):
            return "adresa neni overena"

    if delivery["service"] == "dpd_pickup" and not clean_text(row.get("packetaId")):
        return "chybi ID vydejniho mista/boxu DPD"

    return ""


def dpd_payload(row):
    delivery = delivery_info_from_row(row)
    client_settings = carrier_client_settings("dpd", row)
    carrier_note = carrier_note_for_dpd_label(row)
    shipment = {
        "reference": clean_text(row.get("orderNumber")),
        "orderId": clean_text(row.get("orderId")),
        "shopCode": row_carrier_client_code(row),
        "clientCode": client_settings.get("clientCode"),
        "clientName": client_settings.get("clientName"),
        "service": delivery["service"],
        "serviceLabel": delivery["serviceLabel"],
        "recipient": {
            "name": dpd_recipient_name(row),
            "phone": clean_text(row.get("phone")),
            "email": clean_text(row.get("email")),
        },
        "address": {
            "streetWithNumber": dpd_address_text(row),
            "street": clean_text(row.get("street")),
            "houseNumber": clean_text(row.get("houseNumber")),
            "city": clean_text(row.get("city")),
            "zipCode": clean_text(row.get("zipCode")),
            "country": dpd_country(row),
            "validated": row.get("addressValidationStatus") == "verified",
        },
        "pickupPointId": clean_text(row.get("packetaId")) if delivery["service"] == "dpd_pickup" else "",
        "cashOnDelivery": {
            "amount": clean_text(row.get("codAmount")),
            "currency": shipment_currency(row),
        },
        "parcel": {
            "weight": clean_text(row.get("weight")) or "1",
            "pieces": int_from_text(row.get("quantity")) or 1,
        },
        "carrierNote": carrier_note,
        "note": carrier_note,
        "source": {
            "rowNumber": row.get("rowNumber"),
            "shippingMethod": clean_text(row.get("shippingMethod")),
            "datasetRowId": row.get("id"),
        },
    }
    if carrier_note:
        shipment["parcel"]["references"] = {"ref1": carrier_note}
    warnings = []
    if not shipment["address"]["validated"] and delivery["service"] == "dpd_courier":
        warnings.append("Adresa neni oznacena jako overena.")
    if not shipment["cashOnDelivery"]["amount"]:
        warnings.append("Bez dobirky.")
    if carrier_note_was_shortened(row, carrier_note):
        warnings.append("Poznamka pro prepravce byla zkracena.")
    return {
        "rowNumber": row.get("rowNumber"),
        "orderNumber": row.get("orderNumber"),
        "customer": dpd_recipient_name(row),
        "shippingMethod": row.get("shippingMethod"),
        "shopCode": row_carrier_client_code(row),
        "clientCode": client_settings.get("clientCode"),
        "clientName": client_settings.get("clientName"),
        "service": delivery["service"],
        "serviceLabel": delivery["serviceLabel"],
        "warnings": warnings,
        "payload": shipment,
    }


def dpd_request_headers(settings=None):
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    token = dpd_api_token(settings)
    if token:
        headers["x-api-key"] = token
    return headers


def dpd_post_payload(payload, settings=None):
    settings = settings or request_settings(include_secrets=True).get("dpd", {})
    if not settings.get("sendEnabled"):
        return {
            "httpStatus": 0,
            "ok": False,
            "responseText": "",
            "error": "DPD odesílání není povolené v Nastavení",
        }
    if not clean_text(settings.get("apiKey")):
        return {
            "httpStatus": 0,
            "ok": False,
            "responseText": "",
            "error": f"DPD API key neni nastaveny pro klienta {settings.get('clientName') or 'Vychozi klient'}.",
        }
    base_url = clean_text(settings.get("apiBaseUrl")).rstrip("/")
    if not base_url:
        return {
            "httpStatus": 0,
            "ok": False,
            "responseText": "",
            "error": "DPD API URL není nastavené",
        }

    timeout = 25
    request_data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    dpd_request = urllib.request.Request(
        f"{base_url}/shipments",
        data=request_data,
        headers=dpd_request_headers(settings),
        method="POST",
    )

    try:
        with urllib.request.urlopen(dpd_request, timeout=timeout) as response:
            response_text = response.read().decode("utf-8", "replace")
            return {
                "httpStatus": response.getcode(),
                "ok": 200 <= response.getcode() < 300,
                "responseText": response_text,
                "error": "",
            }
    except urllib.error.HTTPError as exc:
        response_text = exc.read().decode("utf-8", "replace")
        return {
            "httpStatus": exc.code,
            "ok": False,
            "responseText": response_text,
            "error": clean_text(exc.reason) or "DPD HTTP error",
        }
    except urllib.error.URLError as exc:
        return {
            "httpStatus": 0,
            "ok": False,
            "responseText": "",
            "error": clean_text(getattr(exc, "reason", exc)),
        }


def dpd_label_pdf(parcel_number, settings=None):
    settings = settings or request_settings(include_secrets=True).get("dpd", {})
    if not clean_text(settings.get("apiKey")):
        return None, {
            "httpStatus": 0,
            "ok": False,
            "error": f"DPD API key neni nastaveny pro klienta {settings.get('clientName') or 'Vychozi klient'}.",
        }
    base_url = clean_text(settings.get("apiBaseUrl")).rstrip("/")
    if not base_url:
        return None, {"httpStatus": 0, "ok": False, "error": "DPD API URL není nastavené"}

    payload = {
        "printType": "PDF",
        "printProperties": {"pageSize": "A6", "labelsPerPage": 1},
        "parcels": [{"parcelNumber": clean_text(parcel_number)}],
    }
    request_data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = dpd_request_headers(settings)
    headers["Accept"] = "application/pdf, application/json"
    dpd_request = urllib.request.Request(
        f"{base_url}/parcels/labels",
        data=request_data,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(dpd_request, timeout=25) as response:
            return response.read(), {"httpStatus": response.getcode(), "ok": 200 <= response.getcode() < 300, "error": ""}
    except urllib.error.HTTPError as exc:
        response_text = exc.read().decode("utf-8", "replace")
        return None, {"httpStatus": exc.code, "ok": False, "error": response_text or clean_text(exc.reason) or "DPD HTTP error"}
    except urllib.error.URLError as exc:
        return None, {"httpStatus": 0, "ok": False, "error": clean_text(getattr(exc, "reason", exc))}


def packeta_label_pdf(packet_id, settings=None):
    settings = settings or carrier_client_settings("packeta")
    password = settings.get("apiPassword", "")
    if not password:
        return None, {
            "httpStatus": 0,
            "ok": False,
            "error": f"Packeta API heslo není nastavené pro klienta {settings.get('clientName') or 'výchozí klient'}.",
        }

    label_xml = (
        "<packetsLabelsPdf>"
        f"<apiPassword>{packeta_text(password)}</apiPassword>"
        "<packetIds>"
        f"<id>{packeta_text(packet_id)}</id>"
        "</packetIds>"
        "<format>A8 on A8</format>"
        "<offset>0</offset>"
        "</packetsLabelsPdf>"
    )
    result = packeta_post_validation_xml(label_xml, settings)
    if not result.get("valid"):
        return None, {
            "httpStatus": result.get("httpStatus", 0),
            "ok": False,
            "error": result.get("error") or result.get("responseText") or "Packeta label error",
        }
    encoded_pdf = xml_tag_text(result.get("responseText", ""), "result")
    if not encoded_pdf:
        return None, {"httpStatus": result.get("httpStatus", 0), "ok": False, "error": "Packeta nevrátila PDF štítek."}
    try:
        return base64.b64decode(encoded_pdf), {"httpStatus": result.get("httpStatus", 200), "ok": True, "error": ""}
    except Exception as exc:
        return None, {"httpStatus": result.get("httpStatus", 0), "ok": False, "error": clean_text(exc)}


def mapy_api_key():
    return read_settings(include_secrets=True)["mapy"].get("apiKey") or os.environ.get("MAPY_API_TOKEN") or ""


def mapy_geocode_url():
    return os.environ.get("MAPY_GEOCODE_URL") or "https://api.mapy.com/v1/geocode"


def mapy_address_query(data):
    street_with_number = clean_text(data.get("streetWithNumber")).strip()
    street = clean_text(data.get("street")).strip()
    house_number = clean_text(data.get("houseNumber")).strip()
    city = clean_text(data.get("city")).strip()
    zip_code = clean_text(data.get("zipCode")).strip()

    street_part = street_with_number or " ".join(part for part in [street, house_number] if part)
    return ", ".join(part for part in [street_part, zip_code, city] if part).strip()


def address_input_parts(data):
    street_with_number = clean_text(data.get("streetWithNumber")).strip()
    street = clean_text(data.get("street")).strip()
    house_number = clean_text(data.get("houseNumber")).strip()
    city = clean_text(data.get("city")).strip()
    zip_code = clean_text(data.get("zipCode")).strip()

    combined_street = street_with_number or " ".join(part for part in [street, house_number] if part)
    return {
        "streetWithNumber": street_with_number,
        "street": street,
        "houseNumber": house_number,
        "city": city,
        "zipCode": zip_code,
        "combinedStreet": combined_street,
    }


def address_has_house_number(parts):
    if clean_text(parts.get("houseNumber")).strip():
        return True
    combined = clean_text(parts.get("combinedStreet"))
    return any(char.isdigit() for char in combined)


def address_precheck_error(data):
    parts = address_input_parts(data)
    missing = []
    if not parts["combinedStreet"]:
        missing.append("ulice")
    if not address_has_house_number(parts):
        missing.append("číslo domu")
    if not parts["city"]:
        missing.append("město")

    if missing:
        return f"Chybí {', '.join(missing)}. Adresa musí být vyřešena se zákazníkem."
    return ""


def mapy_item_search_text(item):
    regional = " ".join(clean_text(part.get("name")) for part in item.get("regionalStructure") or [])
    return searchable_text(" ".join([item.get("name") or "", item.get("location") or "", item.get("zip") or "", regional]))


def address_matches_mapy_result(data, item):
    parts = address_input_parts(data)
    result_text = mapy_item_search_text(item)

    if not item or item.get("type") != "regional.address":
        return False, "Mapy.com nenašly přesnou adresu."

    if not address_has_house_number(parts):
        return False, "Chybí číslo domu."

    street = parts["street"] or parts["streetWithNumber"]
    street_words = [
        word
        for word in searchable_text(street).replace("/", " ").split()
        if not any(char.isdigit() for char in word)
    ]
    if street_words and not any(word in result_text for word in street_words):
        return False, "Nalezená adresa neodpovídá zadané ulici."

    if parts["houseNumber"]:
        house_number = searchable_text(parts["houseNumber"]).replace(" ", "")
        result_compact = result_text.replace(" ", "")
        if house_number and house_number not in result_compact:
            return False, "Nalezená adresa neodpovídá zadanému číslu domu."

    if parts["city"]:
        city_words = searchable_text(parts["city"]).split()
        if city_words and not any(word in result_text for word in city_words):
            return False, "Nalezená adresa neodpovídá zadanému městu."

    if parts["zipCode"]:
        wanted_zip = "".join(char for char in parts["zipCode"] if char.isdigit())
        found_zip = "".join(char for char in clean_text(item.get("zip")) if char.isdigit())
        if wanted_zip and found_zip and wanted_zip != found_zip:
            return False, "Nalezená adresa má jiné PSČ."

    return True, ""


def mapy_country(data):
    explicit = clean_text(data.get("country")).strip().lower()
    if explicit:
        return explicit
    shop_code = clean_text(data.get("shopCode")).lower()
    return "sk" if shop_code.endswith("_sk") or "slovak" in shop_code else "cz"


def mapy_normalize_items(payload):
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        items = payload.get("items") or payload.get("results") or payload.get("data") or []
    else:
        items = []

    normalized = []
    for item in items[:5]:
        if not isinstance(item, dict):
            continue
        position = item.get("position") or {}
        normalized.append(
            {
                "name": item.get("name"),
                "label": item.get("label"),
                "type": item.get("type"),
                "location": item.get("location"),
                "zip": item.get("zip"),
                "position": {
                    "lat": position.get("lat"),
                    "lon": position.get("lon"),
                },
                "regionalStructure": item.get("regionalStructure") or [],
            }
        )
    return normalized


def mapy_strip_leading_zip(value, zip_code=""):
    text = clean_text(value)
    zip_text = clean_text(zip_code)
    if zip_text and text.startswith(zip_text):
        return text[len(zip_text) :].strip(" ,-")
    if len(text) >= 6 and text[:3].isdigit() and text[3] == " " and text[4:6].isdigit():
        return text[6:].strip(" ,-")
    return text


def mapy_split_street_house(street_with_number):
    text = clean_text(street_with_number)
    if not text:
        return "", ""
    parts = text.rsplit(" ", 1)
    if len(parts) == 2 and any(char.isdigit() for char in parts[1]):
        return parts[0].strip(), parts[1].strip()
    return text, ""


def mapy_city_from_item(item):
    if not item:
        return ""
    location = clean_text(item.get("location"))
    street_name = clean_text(item.get("name")).lower()
    zip_code = clean_text(item.get("zip"))
    pieces = []
    for raw_piece in location.split(","):
        piece = raw_piece.strip()
        lowered = piece.lower()
        if not piece:
            continue
        if lowered in {"cesko", "česko", "czechia", "czech republic", "slovensko", "slovakia"}:
            continue
        if street_name and lowered == street_name:
            continue
        pieces.append(piece)
    if pieces:
        return mapy_strip_leading_zip(pieces[0], zip_code)
    return ""


def mapy_address_from_item(item):
    if not item or item.get("type") != "regional.address":
        return None
    street_with_number = clean_text(item.get("name"))
    if not street_with_number:
        return None
    street, house_number = mapy_split_street_house(street_with_number)
    return {
        "streetWithNumber": street_with_number,
        "street": street,
        "houseNumber": house_number,
        "city": mapy_city_from_item(item),
        "zipCode": clean_text(item.get("zip")),
    }


def mapy_address_label(address):
    if not address:
        return ""
    city_line = " ".join(part for part in [address.get("zipCode"), address.get("city")] if part)
    return ", ".join(part for part in [address.get("streetWithNumber"), city_line] if part)


def mapy_address_fills_missing_input(data, address):
    if not address:
        return False
    parts = address_input_parts(data)
    field_pairs = [
        ("streetWithNumber", "streetWithNumber"),
        ("street", "street"),
        ("houseNumber", "houseNumber"),
        ("city", "city"),
        ("zipCode", "zipCode"),
    ]
    return any(clean_text(address.get(address_key)) and not clean_text(parts.get(input_key)) for input_key, address_key in field_pairs)


def merge_carrier_note(existing, addition):
    existing = clean_text(existing).strip()
    addition = clean_text(addition).strip()
    if not addition:
        return existing
    if not existing:
        return addition
    existing_parts = [part.strip().lower() for part in existing.split("|")]
    if addition.lower() in existing_parts:
        return existing
    return f"{existing} | {addition}"


def address_cleanup_candidates(data):
    parts = address_input_parts(data)
    original_street = clean_text(parts.get("streetWithNumber") or parts.get("combinedStreet")).strip()
    if not original_street:
        return []

    candidates = []

    def add_candidate(strategy, clean_street, carrier_note_addition):
        clean_street = clean_text(clean_street).strip(" ,;-")
        carrier_note_addition = clean_text(carrier_note_addition).strip(" ,;-")
        if not clean_street or not carrier_note_addition:
            return
        if not any(ch.isdigit() for ch in clean_street):
            return
        candidate_data = dict(data)
        candidate_data["streetWithNumber"] = clean_street
        candidate_data["street"] = ""
        candidate_data["houseNumber"] = ""
        candidates.append(
            {
                "strategy": strategy,
                "originalStreet": original_street,
                "cleanStreet": clean_street,
                "carrierNoteAddition": carrier_note_addition,
                "data": candidate_data,
            }
        )

    if "," in original_street:
        before, after = original_street.split(",", 1)
        add_candidate("prefix-company", after, before)

    tokens = original_street.split()
    last_number_index = -1
    for index, token in enumerate(tokens):
        if any(ch.isdigit() for ch in token):
            last_number_index = index
    if 0 <= last_number_index < len(tokens) - 1:
        add_candidate(
            "trailing-place",
            " ".join(tokens[: last_number_index + 1]),
            " ".join(tokens[last_number_index + 1 :]),
        )

    unique = []
    seen = set()
    for candidate in candidates:
        key = candidate["cleanStreet"].lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def mapy_geocode_items(api_key, data, query, timeout):
    api_key_param = os.environ.get("MAPY_API_KEY_PARAM", "apikey")
    params = {
        "query": query,
        "lang": os.environ.get("MAPY_API_LANG", "cs"),
        "limit": int_from_text(os.environ.get("MAPY_API_LIMIT")) or 5,
        "type": os.environ.get("MAPY_API_TYPE", "regional.address"),
        "locality": mapy_country(data),
        api_key_param: api_key,
    }
    url = f"{mapy_geocode_url()}?{urllib.parse.urlencode(params)}"
    geocode_request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "X-Mapy-Api-Key": api_key},
        method="GET",
    )
    with urllib.request.urlopen(geocode_request, timeout=timeout) as response:
        response_text = response.read().decode("utf-8", "replace")
        payload = json.loads(response_text)
    return mapy_normalize_items(payload)


def address_log_address(row):
    if not row:
        return ""
    street = row_value(row, "streetWithNumber", "street_with_number")
    if not clean_text(street):
        street = " ".join(
            part
            for part in [
                clean_text(row_value(row, "street", "street")),
                clean_text(row_value(row, "houseNumber", "house_number")),
            ]
            if part
        )
    return ", ".join(
        part
        for part in [
            clean_text(street),
            clean_text(row_value(row, "zipCode", "zip_code")),
            clean_text(row_value(row, "city", "city")),
        ]
        if part
    )


def address_validation_action(result_payload):
    if result_payload.get("appliedAddressCleanup"):
        return "address-cleaned"
    if result_payload.get("appliedCarrierNote"):
        return "carrier-note"
    if result_payload.get("appliedSuggestion"):
        return "address-replaced"
    if result_payload.get("appliedAddressCompletion"):
        return "address-completed"
    if result_payload.get("valid"):
        return "verified"
    return clean_text(result_payload.get("status")) or "error"


def address_validation_row_snapshot(row):
    if not row:
        return {}
    checked_at = row_value(row, "addressValidationCheckedAt", "address_validation_checked_at")
    if hasattr(checked_at, "isoformat"):
        checked_at = checked_at.isoformat()
    return {
        "streetWithNumber": clean_text(row_value(row, "streetWithNumber", "street_with_number")),
        "street": clean_text(row_value(row, "street", "street")),
        "houseNumber": clean_text(row_value(row, "houseNumber", "house_number")),
        "city": clean_text(row_value(row, "city", "city")),
        "zipCode": clean_text(row_value(row, "zipCode", "zip_code")),
        "carrierNote": clean_text(row_value(row, "carrierNote", "carrier_note")),
        "addressValidationStatus": clean_text(row_value(row, "addressValidationStatus", "address_validation_status")),
        "addressValidationMessage": clean_text(row_value(row, "addressValidationMessage", "address_validation_message")),
        "addressValidationQuery": clean_text(row_value(row, "addressValidationQuery", "address_validation_query")),
        "addressValidationCheckedAt": checked_at or None,
        "addressValidationResult": row_value(row, "addressValidationResult", "address_validation_result") or {},
    }


def insert_address_validation_log(cur, original_row, updated_row, result_payload):
    row = updated_row or original_row or {}
    actor = current_user() or {}
    cur.execute(
        """
        INSERT INTO address_validation_logs (
            dataset_id, row_id, actor_user_id, actor_name, order_number, customer_name, original_address,
            resolved_address, carrier_note_before, carrier_note_after,
            status, action, message, details, original_snapshot, updated_snapshot
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            row_value(row, "datasetId", "dataset_id"),
            row_value(row, "id", "id"),
            actor.get("id"),
            actor.get("displayName") or actor.get("display_name") or actor.get("username") or actor.get("email"),
            row_value(row, "orderNumber", "order_number"),
            " ".join(
                part
                for part in [
                    clean_text(row_value(row, "firstName", "first_name")),
                    clean_text(row_value(row, "lastName", "last_name")),
                ]
                if part
            ),
            address_log_address(original_row),
            address_log_address(updated_row or original_row),
            row_value(original_row or {}, "carrierNote", "carrier_note"),
            row_value(updated_row or original_row or {}, "carrierNote", "carrier_note"),
            result_payload.get("status"),
            address_validation_action(result_payload),
            result_payload.get("message"),
            Json(result_payload),
            Json(address_validation_row_snapshot(original_row)),
            Json(address_validation_row_snapshot(updated_row or original_row)),
        ),
    )


def address_validation_log_to_api(row):
    return {
        "id": row["id"],
        "datasetId": row.get("dataset_id"),
        "rowId": row.get("row_id"),
        "actorName": row.get("actor_name") or "",
        "orderNumber": row.get("order_number") or "",
        "customerName": row.get("customer_name") or "",
        "originalAddress": row.get("original_address") or "",
        "resolvedAddress": row.get("resolved_address") or "",
        "carrierNoteBefore": row.get("carrier_note_before") or "",
        "carrierNoteAfter": row.get("carrier_note_after") or "",
        "status": row.get("status") or "",
        "action": row.get("action") or "",
        "message": row.get("message") or "",
        "details": row.get("details") or {},
        "originalSnapshot": row.get("original_snapshot") or {},
        "updatedSnapshot": row.get("updated_snapshot") or {},
        "revertedAt": row["reverted_at"].isoformat() if row.get("reverted_at") else None,
        "revertedBy": row.get("reverted_by") or "",
        "canRevert": bool(row.get("row_id") and row.get("original_snapshot") and not row.get("reverted_at")),
        "createdAt": row["created_at"].isoformat() if row.get("created_at") else None,
    }


@app.route("/api/packeta/dry-run")
def packeta_dry_run():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    dataset_id = request.args.get("datasetId") or request.args.get("id")
    dataset_date = request.args.get("date")
    shop_code = request.args.get("shop")
    limit = int_from_text(request.args.get("limit"))

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if dataset_id:
                cur.execute(
                    "SELECT * FROM datasets WHERE id = %s AND dataset_kind = 'completion'",
                    (dataset_id,),
                )
            else:
                filters = ["status = 'active'", "dataset_kind = 'completion'"]
                params = []
                if dataset_date:
                    filters.append("dataset_date = %s")
                    params.append(dataset_date)
                if shop_code:
                    filters.append("shop_code = %s")
                    params.append(normalize_shop_code(shop_code))
                where = " AND ".join(filters)
                cur.execute(
                    f"""
                    SELECT * FROM datasets
                    WHERE {where}
                    ORDER BY uploaded_at DESC, id DESC
                    LIMIT 1
                    """,
                    params,
                )

            dataset = cur.fetchone()
            if not dataset:
                return jsonify({"error": "Completion dataset not found"}), 404

            cur.execute(
                "SELECT * FROM completion_rows WHERE dataset_id = %s ORDER BY row_number NULLS LAST, id",
                (dataset["id"],),
            )
            rows = [completion_row_to_api(row) for row in cur.fetchall()]

    packets = []
    skipped = []
    for row in rows:
        reason = packeta_skip_reason(row)
        if reason:
            skipped.append(
                {
                    "rowNumber": row.get("rowNumber"),
                    "orderNumber": row.get("orderNumber"),
                    "customer": " ".join(
                        part for part in [row.get("firstName"), row.get("lastName")] if part
                    ),
                    "shippingMethod": row.get("shippingMethod"),
                    "reason": reason,
                }
            )
            continue
        packets.append(packeta_dry_run_packet(row))

    visible_packets = packets[:limit] if limit > 0 else packets

    return jsonify(
        {
            "ok": True,
            "dryRun": True,
            "endpoint": "http://www.zasilkovna.cz/api/rest",
            "method": "POST",
            "apiPasswordIncluded": False,
            "note": "Dry run only. No request was sent and no database rows were changed.",
            "dataset": dataset_summary(dataset),
            "rowsCount": len(rows),
            "packetsCount": len(packets),
            "skippedCount": len(skipped),
            "truncatedCount": max(0, len(packets) - len(visible_packets)),
            "packets": visible_packets,
            "skipped": skipped,
        }
    )


@app.route("/api/packeta/validate", methods=["POST"])
def packeta_validate():
    auth_error = require_upload_token()
    if auth_error:
        return auth_error

    ensure_schema()
    data = request.get_json(silent=True) or {}
    dataset_id = data.get("datasetId") or request.args.get("datasetId") or request.args.get("id")
    limit = int_from_text(data.get("limit") or request.args.get("limit")) or 30
    client_filter = normalize_carrier_client_code(
        data.get("clientCode") or data.get("client") or data.get("shopCode") or request.args.get("clientCode") or request.args.get("client") or request.args.get("shopCode")
    )

    if not dataset_id:
        return jsonify({"error": "datasetId is required"}), 400

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM datasets WHERE id = %s AND dataset_kind = 'completion'",
                (dataset_id,),
            )
            dataset = cur.fetchone()
            if not dataset:
                return jsonify({"error": "Completion dataset not found"}), 404

            cur.execute(
                "SELECT * FROM completion_rows WHERE dataset_id = %s ORDER BY row_number NULLS LAST, id",
                (dataset["id"],),
            )
            rows = [completion_row_to_api(row) for row in cur.fetchall()]

    packets = []
    skipped = []
    for row in rows:
        reason = packeta_skip_reason(row)
        if reason:
            skipped.append(
                {
                    "rowNumber": row.get("rowNumber"),
                    "orderNumber": row.get("orderNumber"),
                    "customer": " ".join(
                        part for part in [row.get("firstName"), row.get("lastName")] if part
                    ),
                    "shippingMethod": row.get("shippingMethod"),
                    "reason": reason,
                }
            )
            continue
        packets.append(packeta_dry_run_packet(row))

    results = []
    for packet in packets[:limit]:
        client_settings = carrier_client_settings("packeta", packet.get("clientCode") or packet.get("shopCode"))
        password = client_settings.get("apiPassword", "")
        if not password:
            results.append(
                {
                    "rowNumber": packet.get("rowNumber"),
                    "orderNumber": packet.get("orderNumber"),
                    "customer": packet.get("customer"),
                    "shippingMethod": packet.get("shippingMethod"),
                    "service": packet.get("service"),
                    "addressId": packet.get("addressId"),
                    "eshop": packet.get("eshop"),
                    "clientCode": client_settings.get("clientCode"),
                    "clientName": client_settings.get("clientName"),
                    "valid": False,
                    "status": "configuration_error",
                    "httpStatus": 0,
                    "responseText": "",
                    "error": f"Packeta API heslo neni nastavene pro klienta {client_settings.get('clientName')}.",
                }
            )
            continue
        validation_xml = packeta_validation_xml(packet["requestXml"], password)
        result = packeta_post_validation_xml(validation_xml, client_settings)
        results.append(
            {
                "rowNumber": packet.get("rowNumber"),
                "orderNumber": packet.get("orderNumber"),
                "customer": packet.get("customer"),
                "shippingMethod": packet.get("shippingMethod"),
                "service": packet.get("service"),
                "addressId": packet.get("addressId"),
                "eshop": packet.get("eshop"),
                "clientCode": client_settings.get("clientCode"),
                "clientName": client_settings.get("clientName"),
                "valid": result["valid"],
                "status": result["status"],
                "httpStatus": result["httpStatus"],
                "responseText": result["responseText"],
                "error": result["error"],
            }
        )

    return jsonify(
        {
            "ok": True,
            "dryRun": False,
            "validationOnly": True,
            "endpoint": packeta_api_url(),
            "method": "POST",
            "apiPasswordIncluded": False,
            "note": "Validation only. Packeta API was called, but no shipment should be created.",
            "dataset": dataset_summary(dataset),
            "rowsCount": len(rows),
            "packetsCount": len(packets),
            "validatedCount": len(results),
            "skippedCount": len(skipped),
            "notValidatedCount": max(0, len(packets) - len(results)),
            "results": results,
            "skipped": skipped,
        }
    )


@app.route("/api/packeta/send", methods=["POST"])
def packeta_send():
    auth_error = require_upload_token()
    if auth_error:
        return auth_error

    ensure_schema()
    data = request.get_json(silent=True) or {}
    dataset_id = data.get("datasetId") or request.args.get("datasetId") or request.args.get("id")
    client_filter = normalize_carrier_client_code(
        data.get("clientCode")
        or data.get("client")
        or data.get("shopCode")
        or request.args.get("clientCode")
        or request.args.get("client")
        or request.args.get("shopCode")
    )

    if not dataset_id:
        return jsonify({"error": "datasetId is required"}), 400

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM datasets WHERE id = %s AND dataset_kind = 'completion'",
                (dataset_id,),
            )
            dataset = cur.fetchone()
            if not dataset:
                return jsonify({"error": "Completion dataset not found"}), 404

            cur.execute(
                "SELECT * FROM completion_rows WHERE dataset_id = %s ORDER BY row_number NULLS LAST, id",
                (dataset["id"],),
            )
            rows = [completion_row_to_api(row) for row in cur.fetchall()]

    packets = []
    skipped = []
    for row in rows:
        reason = packeta_skip_reason(row)
        if reason:
            skipped.append(
                {
                    "rowId": row.get("id"),
                    "rowNumber": row.get("rowNumber"),
                    "orderNumber": row.get("orderNumber"),
                    "customer": " ".join(part for part in [row.get("firstName"), row.get("lastName")] if part),
                    "shippingMethod": row.get("shippingMethod"),
                    "reason": reason,
                }
            )
            continue
        packet = packeta_dry_run_packet(row)
        if client_filter and packet.get("clientCode") != client_filter:
            skipped.append(
                {
                    "rowId": row.get("id"),
                    "rowNumber": row.get("rowNumber"),
                    "orderNumber": row.get("orderNumber"),
                    "customer": " ".join(part for part in [row.get("firstName"), row.get("lastName")] if part),
                    "shippingMethod": row.get("shippingMethod"),
                    "reason": "jiny klient dopravce",
                }
            )
            continue
        packets.append(packet)

    results = []
    updated_rows = []
    for packet in packets:
        client_settings = carrier_client_settings("packeta", packet.get("clientCode") or packet.get("shopCode"))
        password = client_settings.get("apiPassword", "")
        if not password:
            results.append(
                {
                    "rowId": packet.get("rowId"),
                    "rowNumber": packet.get("rowNumber"),
                    "orderNumber": packet.get("orderNumber"),
                    "customer": packet.get("customer"),
                    "shippingMethod": packet.get("shippingMethod"),
                    "service": packet.get("service"),
                    "addressId": packet.get("addressId"),
                    "eshop": packet.get("eshop"),
                    "clientCode": client_settings.get("clientCode"),
                    "clientName": client_settings.get("clientName"),
                    "valid": False,
                    "created": False,
                    "shipmentId": "",
                    "status": "configuration_error",
                    "httpStatus": 0,
                    "responseText": "",
                    "error": f"Packeta API heslo neni nastavene pro klienta {client_settings.get('clientName')}.",
                }
            )
            continue

        create_xml = packeta_create_xml(packet["requestXml"], password)
        api_result = packeta_post_validation_xml(create_xml, client_settings)
        shipment_id = xml_tag_text(api_result.get("responseText", ""), "id")
        created = bool(api_result.get("valid") and shipment_id)
        updated_row = None
        if created and packet.get("rowId"):
            updated_row = update_completion_carrier_result(
                packet["rowId"],
                "packeta",
                True,
                api_result.get("status") or "ok",
                shipment_id,
                api_result.get("responseText", ""),
            )
            if updated_row:
                updated_rows.append(updated_row)

        results.append(
            {
                "rowId": packet.get("rowId"),
                "rowNumber": packet.get("rowNumber"),
                "orderNumber": packet.get("orderNumber"),
                "customer": packet.get("customer"),
                "shippingMethod": packet.get("shippingMethod"),
                "service": packet.get("service"),
                "addressId": packet.get("addressId"),
                "eshop": packet.get("eshop"),
                "clientCode": client_settings.get("clientCode"),
                "clientName": client_settings.get("clientName"),
                "valid": api_result.get("valid"),
                "created": created,
                "shipmentId": shipment_id,
                "status": api_result.get("status"),
                "httpStatus": api_result.get("httpStatus"),
                "responseText": api_result.get("responseText"),
                "error": "" if created else api_result.get("error") or "Packeta nevratila ID zasilky.",
            }
        )

    created_count = len([item for item in results if item.get("created")])
    error_count = len([item for item in results if not item.get("created")])
    return jsonify(
        {
            "ok": error_count == 0,
            "dryRun": False,
            "validationOnly": False,
            "createShipments": True,
            "endpoint": packeta_api_url(),
            "method": "POST",
            "apiPasswordIncluded": False,
            "note": "Ostre odeslani vybrane konkretni davky do Zasilkovny/Packety.",
            "dataset": dataset_summary(dataset),
            "rowsCount": len(rows),
            "packetsCount": len(packets),
            "createdCount": created_count,
            "errorCount": error_count,
            "skippedCount": len(skipped),
            "results": results,
            "skipped": skipped,
            "rows": updated_rows,
        }
    )


@app.route("/api/dpd/dry-run")
def dpd_dry_run():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    dataset_id = request.args.get("datasetId") or request.args.get("id")
    dataset_date = request.args.get("date")
    limit = int_from_text(request.args.get("limit"))
    client_filter = normalize_carrier_client_code(
        request.args.get("clientCode") or request.args.get("client") or request.args.get("shopCode")
    )

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if dataset_id:
                cur.execute(
                    "SELECT * FROM datasets WHERE id = %s AND dataset_kind = 'completion'",
                    (dataset_id,),
                )
            else:
                filters = ["status = 'active'", "dataset_kind = 'completion'"]
                params = []
                if dataset_date:
                    filters.append("dataset_date = %s")
                    params.append(dataset_date)
                where = " AND ".join(filters)
                cur.execute(
                    f"""
                    SELECT * FROM datasets
                    WHERE {where}
                    ORDER BY uploaded_at DESC, id DESC
                    LIMIT 1
                    """,
                    params,
                )
            dataset = cur.fetchone()
            if not dataset:
                return jsonify({"error": "Completion dataset not found"}), 404

            cur.execute(
                "SELECT * FROM completion_rows WHERE dataset_id = %s ORDER BY row_number NULLS LAST, id",
                (dataset["id"],),
            )
            rows = [completion_row_to_api(row) for row in cur.fetchall()]

    shipments = []
    skipped = []
    for row in rows:
        reason = dpd_skip_reason(row)
        if reason:
            skipped.append(
                {
                    "rowNumber": row.get("rowNumber"),
                    "orderNumber": row.get("orderNumber"),
                    "customer": dpd_recipient_name(row),
                    "shippingMethod": row.get("shippingMethod"),
                    "carrier": row.get("deliveryCarrierLabel"),
                    "reason": reason,
                }
            )
            continue
        shipment = dpd_payload(row)
        if client_filter and shipment.get("clientCode") != client_filter:
            continue
        shipments.append(shipment)

    visible_shipments = shipments[:limit] if limit > 0 else shipments
    return jsonify(
        {
            "ok": True,
            "dryRun": True,
            "carrier": "dpd",
            "endpointConfigured": bool(dpd_api_url()),
            "sendEnabled": read_settings(include_secrets=True)["dpd"].get("sendEnabled", False),
            "dataset": dataset_summary(dataset),
            "rowsCount": len(rows),
            "shipmentsCount": len(shipments),
            "skippedCount": len(skipped),
            "truncatedCount": max(0, len(shipments) - len(visible_shipments)),
            "clientFilter": client_filter,
            "shipments": visible_shipments,
            "skipped": skipped,
        }
    )


@app.route("/api/dpd/send", methods=["POST"])
def dpd_send():
    auth_error = require_upload_token()
    if auth_error:
        return auth_error

    ensure_schema()
    data = request.get_json(silent=True) or {}
    dataset_id = data.get("datasetId") or request.args.get("datasetId") or request.args.get("id")
    limit = int_from_text(data.get("limit") or request.args.get("limit")) or 30
    if not dataset_id:
        return jsonify({"error": "datasetId is required"}), 400

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM datasets WHERE id = %s AND dataset_kind = 'completion'",
                (dataset_id,),
            )
            dataset = cur.fetchone()
            if not dataset:
                return jsonify({"error": "Completion dataset not found"}), 404

            cur.execute(
                "SELECT * FROM completion_rows WHERE dataset_id = %s ORDER BY row_number NULLS LAST, id",
                (dataset["id"],),
            )
            rows = [completion_row_to_api(row) for row in cur.fetchall()]

    shipments = []
    skipped = []
    for row in rows:
        reason = dpd_skip_reason(row)
        if reason:
            skipped.append(
                {
                    "rowNumber": row.get("rowNumber"),
                    "orderNumber": row.get("orderNumber"),
                    "customer": dpd_recipient_name(row),
                    "shippingMethod": row.get("shippingMethod"),
                    "carrier": row.get("deliveryCarrierLabel"),
                    "reason": reason,
                }
            )
            continue
        shipment = dpd_payload(row)
        if client_filter and shipment.get("clientCode") != client_filter:
            continue
        shipments.append(shipment)

    selected = shipments[:limit]
    grouped_shipments = {}
    for item in selected:
        client_code = item["payload"].get("clientCode") or "default"
        grouped_shipments.setdefault(client_code, []).append(item["payload"])

    send_results = []
    for client_code, client_shipments in grouped_shipments.items():
        client_settings = carrier_client_settings("dpd", client_code)
        api_payload = {
            "mode": data.get("mode") or client_settings.get("mode") or "test",
            "source": "expedice-railway",
            "dataset": dataset_summary(dataset),
            "clientCode": client_settings.get("clientCode"),
            "clientName": client_settings.get("clientName"),
            "client": {
                "customerDsw": client_settings.get("customerDsw"),
                "customerId": client_settings.get("customerId"),
                "shipmentType": client_settings.get("shipmentType"),
            },
            "shipments": client_shipments,
        }
        api_result = dpd_post_payload(api_payload, client_settings)
        send_results.append(
            {
                "clientCode": client_settings.get("clientCode"),
                "clientName": client_settings.get("clientName"),
                "shipmentsCount": len(client_shipments),
                "result": api_result,
            }
        )

    all_ok = bool(send_results) and all(item["result"].get("ok") for item in send_results)

    return jsonify(
        {
            "ok": all_ok,
            "carrier": "dpd",
            "endpointConfigured": bool(dpd_api_url()),
            "sendEnabled": request_settings(include_secrets=True).get("dpd", {}).get("sendEnabled", False),
            "dataset": dataset_summary(dataset),
            "shipmentsCount": len(shipments),
            "sentCount": len(selected) if all_ok else 0,
            "notSentCount": max(0, len(shipments) - len(selected)),
            "skippedCount": len(skipped),
            "clientFilter": client_filter,
            "results": send_results,
            "result": send_results[0]["result"] if len(send_results) == 1 else {"ok": all_ok, "error": "" if all_ok else "Nektera klientská DPD odeslani skoncila chybou."},
            "shipments": selected,
            "skipped": skipped,
        }
    )


def update_completion_carrier_result(row_id, carrier, ok, status_text="", shipment_id="", response_text=""):
    carrier_label = "DPD" if carrier == "dpd" else "Packeta"
    label_text = f"{carrier_label} ODESLÁNO" if ok else f"{carrier_label} CHYBA"
    row_status = clean_text(status_text) or ("ok" if ok else "error")
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE completion_rows
                SET packeta_status = %s,
                    packeta_shipment_id = CASE WHEN %s <> '' THEN %s ELSE packeta_shipment_id END,
                    label_printed = CASE WHEN %s THEN %s ELSE label_printed END,
                    note = CASE
                        WHEN %s = '' THEN note
                        WHEN note IS NULL OR note = '' THEN %s
                        ELSE note || ' | ' || %s
                    END
                WHERE id = %s
                RETURNING *
                """,
                (
                    row_status,
                    clean_text(shipment_id),
                    clean_text(shipment_id),
                    ok,
                    label_text,
                    clean_text(response_text)[:220],
                    clean_text(response_text)[:220],
                    clean_text(response_text)[:220],
                    row_id,
                ),
            )
            return completion_row_to_api(cur.fetchone())


def dpd_label_number_from_text(value):
    text = clean_text(value)
    if not text:
        return ""
    match = re.search(r"\b\d{14}\b", text)
    return match.group(0) if match else ""


def completion_label_number(row):
    packeta_number = clean_text(row.get("packetaShipmentId") or row.get("packeta_shipment_id") or "")
    if packeta_number:
        return packeta_number
    return dpd_label_number_from_text(row.get("dpdOrderAndPieces") or row.get("dpd_order_and_pieces"))


def label_carrier_for_row(row, label_number=""):
    delivery = delivery_info_from_row(row)
    carrier = clean_text(row.get("deliveryCarrier") or delivery.get("carrier")).lower()
    if carrier in {"dpd", "packeta"}:
        return carrier
    digits = "".join(char for char in clean_text(label_number) if char.isdigit())
    if len(digits) == 14:
        return "dpd"
    if clean_text(label_number):
        return "packeta"
    return ""


def ready_label_cache(row_id, carrier, label_number, include_content=False):
    columns = "id, dataset_id, completion_row_id, carrier, label_number, status, error, fetched_at, pdf_size"
    if include_content:
        columns += ", pdf_content"
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT {columns}
                FROM label_cache
                WHERE completion_row_id = %s
                  AND carrier = %s
                  AND label_number = %s
                  AND status = 'ready'
                  AND pdf_content IS NOT NULL
                ORDER BY fetched_at DESC
                LIMIT 1
                """,
                (row_id, carrier, clean_text(label_number)),
            )
            return cur.fetchone()


def save_label_cache_result(dataset_id, row_id, carrier, label_number, status, pdf_bytes=None, error=""):
    pdf_size = len(pdf_bytes or b"")
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO label_cache (
                    dataset_id, completion_row_id, carrier, label_number, status,
                    pdf_content, error, fetched_at, pdf_size, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), %s, NOW())
                ON CONFLICT (completion_row_id, carrier, label_number)
                DO UPDATE SET
                    dataset_id = EXCLUDED.dataset_id,
                    status = EXCLUDED.status,
                    pdf_content = EXCLUDED.pdf_content,
                    error = EXCLUDED.error,
                    fetched_at = NOW(),
                    pdf_size = EXCLUDED.pdf_size,
                    updated_at = NOW()
                """,
                (
                    dataset_id,
                    row_id,
                    carrier,
                    clean_text(label_number),
                    status,
                    psycopg2.Binary(pdf_bytes) if pdf_bytes else None,
                    clean_text(error)[:500],
                    pdf_size,
                ),
            )
            cur.execute(
                """
                UPDATE completion_rows
                SET label_cache_status = %s,
                    label_cache_error = %s,
                    label_cache_fetched_at = NOW(),
                    label_cache_size = %s
                WHERE id = %s
                RETURNING *
                """,
                (status, clean_text(error)[:500], pdf_size, row_id),
            )
            return completion_row_to_api(cur.fetchone())


@app.route("/api/labels/cache-batch", methods=["POST"])
def labels_cache_batch():
    auth_error = require_upload_token()
    if auth_error:
        return auth_error

    ensure_schema()
    data = request.get_json(silent=True) or {}
    dataset_id = data.get("datasetId") or request.args.get("datasetId") or request.args.get("id")
    carrier_filter = clean_text(data.get("carrier") or request.args.get("carrier") or "dpd").lower()
    if carrier_filter not in {"dpd", "packeta", "all"}:
        return jsonify({"error": "Unsupported carrier filter"}), 400
    if not dataset_id:
        return jsonify({"error": "datasetId is required"}), 400

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM datasets WHERE id = %s AND dataset_kind = 'completion'",
                (dataset_id,),
            )
            dataset = cur.fetchone()
            if not dataset:
                return jsonify({"error": "Completion dataset not found"}), 404
            cur.execute(
                "SELECT * FROM completion_rows WHERE dataset_id = %s ORDER BY row_number NULLS LAST, id",
                (dataset["id"],),
            )
            rows = [completion_row_to_api(row) for row in cur.fetchall()]

    ready = []
    skipped = []
    errors = []
    updated_rows = []

    for row in rows:
        row_id = row.get("id")
        label_number = completion_label_number(row)
        carrier = label_carrier_for_row(row, label_number)
        base_item = {
            "rowId": row_id,
            "rowNumber": row.get("rowNumber"),
            "orderNumber": row.get("orderNumber"),
            "carrier": carrier,
            "labelNumber": label_number,
        }

        if carrier_filter != "all" and carrier != carrier_filter:
            skipped.append({**base_item, "reason": f"jiný dopravce ({carrier or 'neurčeno'})"})
            continue
        if not label_number:
            skipped.append({**base_item, "reason": "chybí číslo štítku/zásilky"})
            continue
        if not carrier:
            skipped.append({**base_item, "reason": "dopravce štítku nelze určit"})
            continue
        if ready_label_cache(row_id, carrier, label_number):
            skipped.append({**base_item, "reason": "štítek už je v cache"})
            continue

        client_settings = carrier_client_settings(carrier, row)
        if carrier == "dpd":
            pdf_bytes, result = dpd_label_pdf(label_number, client_settings)
        elif carrier == "packeta":
            pdf_bytes, result = packeta_label_pdf(label_number, client_settings)
        else:
            pdf_bytes, result = None, {"ok": False, "error": "Nepodporovaný dopravce štítku"}

        if pdf_bytes and result.get("ok"):
            updated_row = save_label_cache_result(dataset["id"], row_id, carrier, label_number, "ready", pdf_bytes, "")
            updated_rows.append(updated_row)
            ready.append({**base_item, "size": len(pdf_bytes)})
        else:
            error = result.get("error") or "Stažení PDF štítku selhalo"
            updated_row = save_label_cache_result(dataset["id"], row_id, carrier, label_number, "error", None, error)
            updated_rows.append(updated_row)
            errors.append({**base_item, "error": error, "httpStatus": result.get("httpStatus")})

    return jsonify(
        {
            "ok": not errors,
            "carrierFilter": carrier_filter,
            "dataset": dataset_summary(dataset),
            "rowsCount": len(rows),
            "readyCount": len(ready),
            "skippedCount": len(skipped),
            "errorCount": len(errors),
            "ready": ready,
            "skipped": skipped,
            "errors": errors,
            "rows": updated_rows,
        }
    )


@app.route("/api/completion/rows/<int:row_id>/sorting-check")
def completion_row_sorting_check(row_id):
    auth_error = require_upload_token()
    if auth_error:
        return auth_error

    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT cr.*, d.expedition_day_id
                FROM completion_rows cr
                JOIN datasets d ON d.id = cr.dataset_id
                WHERE cr.id = %s
                """,
                (row_id,),
            )
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Řádek kompletace nebyl nalezen."}), 404

            expedition_day_id = row.get("expedition_day_id")
            active_sorting = None
            if expedition_day_id:
                cur.execute(
                    """
                    SELECT *
                    FROM datasets
                    WHERE expedition_day_id = %s
                      AND dataset_kind = 'sorting'
                      AND status = 'active'
                      AND deleted_at IS NULL
                    ORDER BY uploaded_at DESC, id DESC
                    LIMIT 1
                    """,
                    (expedition_day_id,),
                )
                active_sorting = cur.fetchone()

            sorting_rows = []
            if active_sorting:
                cur.execute(
                    """
                    SELECT *
                    FROM dataset_rows
                    WHERE dataset_id = %s
                      AND order_number = %s
                    ORDER BY row_number NULLS LAST, id
                    """,
                    (active_sorting["id"], row["order_number"]),
                )
                sorting_rows = [row_to_api(item) for item in cur.fetchall()]

    remaining_total = sum(max(0, int_from_text(item.get("remaining"))) for item in sorting_rows)
    return jsonify(
        {
            "ok": bool(active_sorting) and bool(sorting_rows) and remaining_total == 0,
            "dataset": dataset_summary(active_sorting) if active_sorting else None,
            "rows": sorting_rows,
            "remainingTotal": remaining_total,
            "orderNumber": clean_text(row.get("order_number")),
        }
    )


@app.route("/api/completion/rows/<int:row_id>/label")
def completion_row_label(row_id):
    auth_error = require_upload_token()
    if auth_error:
        return auth_error

    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM completion_rows WHERE id = %s", (row_id,))
            row = cur.fetchone()
    if not row:
        return jsonify({"error": "Řádek kompletace nebyl nalezen."}), 404

    row_api = completion_row_to_api(row)
    label_number = completion_label_number(row_api)
    if not label_number:
        return jsonify({"error": "Řádek zatím nemá číslo štítku/zásilky."}), 400
    carrier = label_carrier_for_row(row_api, label_number)
    if not carrier:
        return jsonify({"error": "Pro tento radek neumim urcit dopravce stitku."}), 400

    cache_row = ready_label_cache(row_id, carrier, label_number, include_content=True)
    if not cache_row:
        return jsonify(
            {
                "error": "Stitek neni pripraveny v serverove cache. Spust nejdrive Pripravit stitky davky.",
                "carrier": carrier,
                "labelNumber": label_number,
                "cache": "miss",
            }
        ), 409

    pdf_bytes = bytes(cache_row["pdf_content"])
    if request.args.get("markPrinted") == "1":
        with db_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "UPDATE completion_rows SET label_printed = 'Label printed' WHERE id = %s",
                    (row_id,),
                )

    filename = f"{label_number}.pdf"
    disposition = "attachment" if request.args.get("download") == "1" else "inline"
    return Response(
        pdf_bytes,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Carrier": carrier,
            "X-Label-Number": label_number,
            "X-Label-Cache": "hit",
        },
    )


CODE128_PATTERNS = [
    "212222",
    "222122",
    "222221",
    "121223",
    "121322",
    "131222",
    "122213",
    "122312",
    "132212",
    "221213",
    "221312",
    "231212",
    "112232",
    "122132",
    "122231",
    "113222",
    "123122",
    "123221",
    "223211",
    "221132",
    "221231",
    "213212",
    "223112",
    "312131",
    "311222",
    "321122",
    "321221",
    "312212",
    "322112",
    "322211",
    "212123",
    "212321",
    "232121",
    "111323",
    "131123",
    "131321",
    "112313",
    "132113",
    "132311",
    "211313",
    "231113",
    "231311",
    "112133",
    "112331",
    "132131",
    "113123",
    "113321",
    "133121",
    "313121",
    "211331",
    "231131",
    "213113",
    "213311",
    "213131",
    "311123",
    "311321",
    "331121",
    "312113",
    "312311",
    "332111",
    "314111",
    "221411",
    "431111",
    "111224",
    "111422",
    "121124",
    "121421",
    "141122",
    "141221",
    "112214",
    "112412",
    "122114",
    "122411",
    "142112",
    "142211",
    "241211",
    "221114",
    "413111",
    "241112",
    "134111",
    "111242",
    "121142",
    "121241",
    "114212",
    "124112",
    "124211",
    "411212",
    "421112",
    "421211",
    "212141",
    "214121",
    "412121",
    "111143",
    "111341",
    "131141",
    "114113",
    "114311",
    "411113",
    "411311",
    "113141",
    "114131",
    "311141",
    "411131",
    "211412",
    "211214",
    "211232",
    "2331112",
]


def ascii_pdf_text(value):
    text = clean_text(value)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return text.replace("\r", " ").replace("\n", " ").strip()


def pdf_escape(value):
    return ascii_pdf_text(value).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def wrap_pdf_text(value, limit=78):
    words = ascii_pdf_text(value).split()
    lines = []
    current = ""
    for word in words:
        next_text = f"{current} {word}".strip()
        if len(next_text) > limit and current:
            lines.append(current)
            current = word
        else:
            current = next_text
    if current:
        lines.append(current)
    return lines or [""]


def code128_values(text):
    safe = ascii_pdf_text(text)
    values = [104]
    checksum = 104
    for index, char in enumerate(safe, start=1):
        code = ord(char)
        if code < 32 or code > 126:
            continue
        value = code - 32
        values.append(value)
        checksum += value * index
    values.append(checksum % 103)
    values.append(106)
    return values


def issue_document_kind(kind):
    normalized = clean_text(kind).lower().replace("-", "_")
    if normalized in {"error", "errorka"}:
        return {
            "code": "error",
            "title": "ERRORKA",
            "headline": "ERRORKA: zkontrolovat zbozi",
            "banner": (1, 0.55, 0.55),
            "suffix": "ERR",
        }
    if normalized in {"unpaid_error", "nezaplaceno_error", "nezaplaceno+error"}:
        return {
            "code": "unpaid_error",
            "title": "NEZAPLACENO + ERROR",
            "headline": "NEZAPLACENO + ERRORKA",
            "banner": (1, 0.72, 0.42),
            "suffix": "NEZERR",
        }
    return {
        "code": "unpaid",
        "title": "NEZAPLACENO",
        "headline": "NEZAPLACENO",
        "banner": (1, 0.84, 0.28),
        "suffix": "NEZ",
    }


def payment_barcode_value(row, kind_meta):
    order_number = ascii_pdf_text(row.get("orderNumber") or row.get("orderId") or row.get("id"))
    amount = ascii_pdf_text(row.get("codAmount") or row.get("paidStatus") or "0")
    amount = "".join(char for char in amount.replace(",", ".") if char.isdigit() or char == ".")
    if "." in amount:
        amount = amount.split(".", 1)[0]
    amount = amount or "0"
    currency = ascii_pdf_text(row.get("currency") or "KC").upper().replace("CZK", "KC").replace("KČ", "KC")
    return f"{order_number}X{amount}X{currency}X{kind_meta['suffix']}"


def issue_document_clean_item_line(value):
    text_value = ascii_pdf_text(clean_text(value)).strip()
    while "  " in text_value:
        text_value = text_value.replace("  ", " ")
    return text_value.strip(" |;")


def issue_document_split_text(value):
    text_value = clean_text(value)
    if not text_value:
        return []
    text_value = text_value.replace("\r", "\n")
    chunks = []
    for line in text_value.split("\n"):
        for part in line.split(";"):
            cleaned = issue_document_clean_item_line(part)
            if cleaned:
                chunks.append(cleaned)
    return chunks


def issue_document_value_lines(value):
    if isinstance(value, dict):
        ordered_keys = (
            "productCode",
            "product_code",
            "variantCode",
            "variant_code",
            "code",
            "sku",
            "variant",
            "name",
            "title",
            "quantity",
            "qty",
            "amount",
        )
        parts = [issue_document_clean_item_line(value.get(key)) for key in ordered_keys if value.get(key)]
        return [" ".join(part for part in parts if part)] if parts else []
    if isinstance(value, list):
        lines = []
        for item in value:
            lines.extend(issue_document_value_lines(item))
        return lines
    return issue_document_split_text(value)


def issue_document_looks_like_item(text_value):
    normalized = issue_document_clean_item_line(text_value).lower()
    if len(normalized) < 8:
        return False
    if normalized.startswith("error:"):
        return True
    has_digit = any(char.isdigit() for char in normalized)
    has_item_shape = "-" in normalized or "/" in normalized or " ks" in normalized or "x " in normalized or normalized.endswith("x")
    excluded_words = (
        "zasilkovna",
        "packeta",
        "dobirka",
        "platba",
        "objednavka",
        "telefon",
        "email",
        "ulice",
        "mesto",
        "psc",
        "kuryr",
        "kurier",
        "dpd",
    )
    if any(word in normalized for word in excluded_words) and not normalized.startswith("error:"):
        return False
    return has_digit and has_item_shape


def issue_document_known_values(row):
    keys = (
        "firstName",
        "lastName",
        "note",
        "streetWithNumber",
        "street",
        "houseNumber",
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
        "dpdFlag",
        "packetaStatus",
        "packetaShipmentId",
        "orderDate",
        "twistoPaid",
        "dpdOrderAndPieces",
        "canceledOrderBackup",
        "labelPrinted",
    )
    known = set()
    for key in keys:
        value = issue_document_clean_item_line(row.get(key))
        if value:
            known.add(value.lower())
    return known


def issue_document_item_lines(row):
    raw = row.get("raw") if isinstance(row.get("raw"), dict) else {}
    cells = row.get("cells") if isinstance(row.get("cells"), list) else []
    known_values = issue_document_known_values(row)
    candidates = []

    for key in (
        "items",
        "orderItems",
        "order_items",
        "products",
        "productItems",
        "product_items",
        "productsText",
        "products_text",
        "itemsText",
        "items_text",
        "goods",
        "zbozi",
        "zboziText",
        "orderProducts",
    ):
        if key in raw:
            candidates.extend(issue_document_value_lines(raw.get(key)))

    for index, value in enumerate(cells):
        for line in issue_document_value_lines(value):
            if index >= 34 or issue_document_looks_like_item(line):
                candidates.append(line)

    unique = []
    seen = set()
    for candidate in candidates:
        line = issue_document_clean_item_line(candidate)
        key = line.lower()
        if not line or key in known_values or key in seen:
            continue
        if len(line) < 8:
            continue
        if issue_document_looks_like_item(line) or len(unique) < 1:
            unique.append(line)
            seen.add(key)
    return unique


def issue_document_lines(row):
    customer = " ".join(filter(None, [row.get("firstName"), row.get("lastName")]))
    street = row.get("streetWithNumber") or " ".join(filter(None, [row.get("street"), row.get("houseNumber")]))
    city = " ".join(filter(None, [row.get("zipCode"), row.get("city")]))
    lines = [
        ("Zakaznik", customer or "-"),
        ("Castka", f"{row.get('codAmount') or '-'} {row.get('currency') or ''}".strip()),
        ("Doprava", row.get("deliveryServiceLabel") or row.get("shippingMethod") or "-"),
        ("Objednavka", row.get("orderNumber") or "-"),
        ("Adresa", ", ".join(part for part in [street, city] if part) or "-"),
        ("Kod v expedici", row.get("expeditionNumber") or row.get("rowNumber") or "-"),
        ("Kusu pro kontrolu", row.get("quantity") or "-"),
        ("Platba", row.get("paymentMethod") or row.get("paidStatus") or "-"),
        ("Stav kompletace", row.get("completionStatus") or "-"),
    ]
    note = row.get("note") or row.get("packetaStatus") or row.get("labelPrinted") or ""
    if note:
        lines.append(("Poznamka", note))
    return lines


def build_issue_document_pdf(row, kind_meta):
    width = 595
    height = 842
    commands = ["0 0 0 rg"]

    def rect(x, y, w, h, color=(0, 0, 0)):
        commands.append(f"{color[0]:.3f} {color[1]:.3f} {color[2]:.3f} rg {x:.2f} {y:.2f} {w:.2f} {h:.2f} re f")

    def text(x, y, value, size=12, bold=False):
        font = "F2" if bold else "F1"
        commands.append(f"0 0 0 rg BT /{font} {size} Tf {x:.2f} {y:.2f} Td ({pdf_escape(value)}) Tj ET")

    barcode = payment_barcode_value(row, kind_meta)
    values = code128_values(barcode)
    pattern_modules = sum(sum(int(char) for char in CODE128_PATTERNS[value]) for value in values)
    module = min(0.82, 240 / max(pattern_modules, 1))
    x = 70
    y = 778
    barcode_height = 26
    for value in values:
        pattern = CODE128_PATTERNS[value]
        is_bar = True
        for char in pattern:
            bar_width = int(char) * module
            if is_bar:
                rect(x, y, bar_width, barcode_height)
            x += bar_width
            is_bar = not is_bar

    text(70, 758, barcode, 11, True)
    text(70, 735, "Expedice - kontrolni papir pro sklad", 12, False)

    rect(70, 692, 455, 28, kind_meta["banner"])
    text(84, 701, kind_meta["headline"], 17, True)

    y_cursor = 660
    for label, value in issue_document_lines(row):
        text(70, y_cursor, f"{label}:", 12, True)
        for line in wrap_pdf_text(value, 64):
            text(190, y_cursor, line, 12, False)
            y_cursor -= 16
        y_cursor -= 5

    y_cursor -= 10
    text(70, y_cursor, "Zbozi v objednavce:", 13, True)
    y_cursor -= 16
    item_lines = issue_document_item_lines(row)
    if item_lines:
        printed = 0
        for item in item_lines:
            if y_cursor < 78:
                text(76, y_cursor, "... dalsi polozky se uz na papir nevesly", 7.5, False)
                y_cursor -= 10
                break
            prefix = "- "
            for line in wrap_pdf_text(f"{prefix}{item}", 118):
                if y_cursor < 78:
                    break
                text(76, y_cursor, line, 7.5, False)
                y_cursor -= 9
                prefix = "  "
            printed += 1
            y_cursor -= 2
            if printed >= 26:
                if len(item_lines) > printed and y_cursor >= 78:
                    text(76, y_cursor, f"... a dalsich {len(item_lines) - printed} polozek", 7.5, False)
                    y_cursor -= 10
                break
    else:
        text(76, y_cursor, "Polozky nebyly v uploadu rozpoznane.", 8, False)
        y_cursor -= 12

    y_cursor -= 8
    text(70, y_cursor, "Doplnkove info:", 10, True)
    y_cursor -= 13
    details = [
        row.get("expeditionOrderCode"),
        row.get("shippingMethod"),
        row.get("deliveryCarrierLabel"),
        row.get("packetaShipmentId"),
        row.get("addressValidationMessage"),
    ]
    for detail in [item for item in details if clean_text(item)]:
        if y_cursor < 64:
            break
        for line in wrap_pdf_text(detail, 82):
            text(76, y_cursor, line, 9, False)
            y_cursor -= 12

    text(70, 48, "Po vyreseni naskenuj carovy kod v expedici pro rychlou kontrolu platby/stavu.", 9, False)
    stream = "\n".join(commands).encode("ascii", "ignore")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{index} 0 obj\n".encode("ascii"))
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")
    xref = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii")
    )
    return bytes(pdf), barcode


@app.route("/api/completion/rows/<int:row_id>/issue-document")
def completion_issue_document(row_id):
    auth_error = require_login()
    if auth_error:
        return auth_error

    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM completion_rows WHERE id = %s", (row_id,))
            row = cur.fetchone()
    if not row:
        return jsonify({"error": "Řádek kompletace nebyl nalezen."}), 404

    kind_meta = issue_document_kind(request.args.get("kind") or "unpaid")
    row_api = completion_row_to_api(row)
    pdf_bytes, barcode = build_issue_document_pdf(row_api, kind_meta)
    filename = f"{kind_meta['code']}-{ascii_pdf_text(row_api.get('orderNumber') or row_id)}.pdf"
    return Response(
        pdf_bytes,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Issue-Document": kind_meta["code"],
            "X-Issue-Barcode": barcode,
        },
    )


@app.before_request
def ensure_payment_sync_started():
    return None


@app.route("/api/settings")
def get_settings():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    return jsonify({"settings": read_settings(include_secrets=False)})


@app.route("/api/settings", methods=["POST"])
def update_settings():
    auth_error = require_upload_token()
    if auth_error:
        return auth_error

    payload = request.get_json(silent=True) or {}
    save_settings_payload(payload.get("settings") or payload)
    return jsonify({"ok": True, "settings": read_settings(include_secrets=False)})


@app.route("/api/product-feed/check", methods=["POST"])
def check_product_feed():
    auth_error = require_admin()
    if auth_error:
        return auth_error

    payload = request.get_json(silent=True) or {}
    try:
        settings = product_feed_settings_from_payload(payload.get("productFeed") or {})
        return jsonify(probe_product_feed(settings))
    except ProductFeedError as exc:
        return jsonify({"ok": False, "error": clean_text(exc)}), 400


@app.route("/api/product-images", methods=["POST"])
def product_images():
    auth_error = require_login()
    if auth_error:
        return auth_error

    payload = request.get_json(silent=True) or {}
    incoming_codes = payload.get("codes") or []
    if not isinstance(incoming_codes, list):
        incoming_codes = []

    codes = []
    seen = set()
    truncated = False
    for value in incoming_codes:
        key = product_image_code_key(value)
        if not key or key in seen:
            continue
        seen.add(key)
        codes.append(key)
        if len(codes) >= PRODUCT_IMAGE_REQUEST_CODE_LIMIT:
            truncated = True
            break

    try:
        cache = product_image_cache()
    except ProductFeedError as exc:
        return jsonify(
            {
                "ok": False,
                "configured": True,
                "error": clean_text(exc),
                "images": {},
                "requestedCount": len(codes),
                "matchedCount": 0,
                "truncated": truncated,
            }
        )

    source_images = cache.get("images") or {}
    images = {code: source_images[code] for code in codes if source_images.get(code)}
    return jsonify(
        {
            "ok": True,
            "configured": cache.get("configured", False),
            "images": images,
            "requestedCount": len(codes),
            "matchedCount": len(images),
            "truncated": truncated,
            "cacheRowsSeen": cache.get("rowsSeen", 0),
            "cacheImageCount": len(source_images),
            "cacheLoadedAt": datetime.fromtimestamp(cache.get("loadedAt"), PRAGUE_TZ).isoformat()
            if cache.get("loadedAt")
            else None,
            "cacheStale": cache.get("stale", False),
            "cacheBytesRead": cache.get("bytesRead", 0),
            "imageColumns": cache.get("imageColumns") or [],
        }
    )


@app.route("/api/payment-feeds/sync", methods=["POST"])
def run_payment_feed_sync():
    auth_error = require_login()
    if auth_error:
        return auth_error

    result = sync_payment_feeds("manual")
    status_code = 200 if result.get("ok") or result.get("skipped") else 500
    return jsonify(result), status_code


@app.route("/api/payment-feeds/updates")
def payment_feed_updates():
    auth_error = require_login()
    if auth_error:
        return auth_error

    ensure_schema()
    dataset_id = clean_text(request.args.get("datasetId"))
    since = clean_text(request.args.get("since"))
    sync_attempt = maybe_sync_payment_feeds("active_completion") if dataset_id else {"ok": True, "skipped": True}
    params = []
    filters = ["cr.payment_check_status IS NOT NULL"]
    if dataset_id:
        filters.append("cr.dataset_id = %s")
        params.append(dataset_id)
    if since:
        filters.append("cr.payment_check_changed_at > %s")
        params.append(since)

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT cr.*
                FROM completion_rows cr
                WHERE {' AND '.join(filters)}
                ORDER BY cr.payment_check_changed_at DESC NULLS LAST, cr.id
                LIMIT 300
                """,
                params,
            )
            rows = [completion_row_to_api(row) for row in cur.fetchall()]
    return jsonify({"rows": rows, "latestSync": latest_payment_sync(), "syncAttempt": sync_attempt, "serverTime": datetime.utcnow().isoformat() + "Z"})


@app.route("/api/expedition-days/<day_date>", methods=["DELETE"])
def delete_expedition_day(day_date):
    auth_error = require_admin()
    if auth_error:
        return auth_error

    try:
        parsed_day = datetime.strptime(day_date, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"error": "Neplatné datum expedičního dne."}), 400

    data = request.get_json(silent=True) or {}
    user = current_user() or {}
    actor = clean_text(data.get("deletedBy")) or user.get("username") or "admin"
    reason = clean_text(data.get("reason")) or "Smazán celý expediční den ve webovém rozhraní"

    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM expedition_days WHERE day_date = %s", (parsed_day,))
            day = cur.fetchone()
            if not day:
                return jsonify({"error": "Expediční den nebyl nalezen."}), 404

            cur.execute(
                """
                UPDATE datasets
                SET status = 'deleted',
                    deleted_at = COALESCE(deleted_at, NOW()),
                    deleted_by = %s,
                    delete_reason = %s
                WHERE expedition_day_id = %s
                  AND deleted_at IS NULL
                RETURNING id
                """,
                (actor, reason, day["id"]),
            )
            deleted_dataset_ids = [row["id"] for row in cur.fetchall()]

            cur.execute(
                """
                UPDATE expedition_days
                SET status = 'deleted',
                    deleted_at = COALESCE(deleted_at, NOW()),
                    deleted_by = %s,
                    delete_reason = %s,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING *
                """,
                (actor, reason, day["id"]),
            )
            updated_day = cur.fetchone()

    return jsonify(
        {
            "ok": True,
            "expeditionDay": {
                "id": updated_day["id"],
                "date": updated_day["day_date"].isoformat(),
                "label": updated_day["label"],
                "status": updated_day["status"],
            },
            "deletedDatasets": len(deleted_dataset_ids),
            "deletedDatasetIds": deleted_dataset_ids,
        }
    )


@app.route("/api/completion/datasets")
def list_completion_datasets():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    include_deleted = include_deleted_for_admin()
    return jsonify({"datasets": fetch_datasets(include_deleted, "completion", request.args.get("shop"), request.args.get("date"))})


@app.route("/api/address/validate", methods=["POST"])
def validate_address():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    api_key = mapy_api_key()
    if not api_key:
        return jsonify({"error": "MAPY_API_KEY is not configured"}), 400

    data = request.get_json(silent=True) or {}
    query = clean_text(data.get("query")).strip() or mapy_address_query(data)
    if not query:
        return jsonify({"error": "Address query is empty"}), 400

    precheck_error = "" if data.get("query") else address_precheck_error(data)
    row_id = int_from_text(data.get("rowId"))
    if precheck_error:
        result_payload = {
            "valid": False,
            "status": "error",
            "message": precheck_error,
            "query": query,
            "country": mapy_country(data),
            "items": [],
            "rawCount": 0,
        }
        if row_id:
            ensure_schema()
            with db_conn() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("SELECT * FROM completion_rows WHERE id = %s", (row_id,))
                    original_row = cur.fetchone()
                    cur.execute(
                        """
                        UPDATE completion_rows
                        SET address_validation_status = %s,
                            address_validation_message = %s,
                            address_validation_query = %s,
                            address_validation_checked_at = NOW(),
                            address_validation_result = %s
                        WHERE id = %s
                        RETURNING *
                        """,
                        ("error", precheck_error, query, Json(result_payload), row_id),
                    )
                    updated_row = cur.fetchone()
                    insert_address_validation_log(cur, original_row, updated_row, result_payload)
        return jsonify(
            {
                "ok": True,
                "valid": False,
                "status": "error",
                "message": precheck_error,
                "query": query,
                "country": mapy_country(data),
                "items": [],
                "rawCount": 0,
            }
        )

    params = {
        "query": query,
        "lang": clean_text(data.get("lang")) or "cs",
        "limit": clean_text(data.get("limit")) or "5",
        "type": clean_text(data.get("type")) or "regional.address",
        "locality": mapy_country(data),
        os.environ.get("MAPY_API_KEY_PARAM") or "apikey": api_key,
    }
    url = f"{mapy_geocode_url()}?{urllib.parse.urlencode(params)}"
    timeout = int_from_text(os.environ.get("MAPY_API_TIMEOUT")) or 15
    geocode_request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "X-Mapy-Api-Key": api_key},
        method="GET",
    )

    try:
        with urllib.request.urlopen(geocode_request, timeout=timeout) as response:
            response_text = response.read().decode("utf-8", "replace")
            payload = json.loads(response_text)
            items = mapy_normalize_items(payload)
            first = items[0] if items else {}
            valid, match_message = address_matches_mapy_result(data, first)
            status = "verified" if valid else "suggestion" if items else "not_found"
            message = ", ".join(
                part for part in [clean_text(first.get("name")), clean_text(first.get("location"))] if part
            )
            if not message:
                message = "Adresa nebyla nalezena"
            if match_message:
                message = f"{match_message} Návrh Mapy.com: {message}" if items else match_message
            result_payload = {
                "valid": valid,
                "status": status,
                "message": message,
                "query": query,
                "country": mapy_country(data),
                "items": items,
                "rawCount": len(items),
            }
            validation_data = data
            cleanup_candidate = None
            if not valid:
                for candidate in address_cleanup_candidates(data):
                    cleanup_query = mapy_address_query(candidate["data"])
                    if not cleanup_query or cleanup_query == query:
                        continue
                    cleanup_items = mapy_geocode_items(api_key, candidate["data"], cleanup_query, timeout)
                    cleanup_first = cleanup_items[0] if cleanup_items else {}
                    cleanup_valid, cleanup_message = address_matches_mapy_result(candidate["data"], cleanup_first)
                    if not cleanup_valid:
                        continue
                    validation_data = candidate["data"]
                    cleanup_candidate = candidate
                    query = cleanup_query
                    items = cleanup_items
                    first = cleanup_first
                    valid = True
                    status = "verified"
                    cleaned_address = mapy_address_from_item(first)
                    message = "Adresa byla ocistena a overena pres Mapy.com: " + mapy_address_label(cleaned_address)
                    if candidate.get("carrierNoteAddition"):
                        message += ". Do poznamky pro prepravce presunuto: " + candidate["carrierNoteAddition"]
                    result_payload.update(
                        {
                            "valid": True,
                            "status": "verified",
                            "message": message,
                            "query": cleanup_query,
                            "originalQuery": result_payload.get("query"),
                            "items": cleanup_items,
                            "rawCount": len(cleanup_items),
                            "appliedAddressCleanup": True,
                            "appliedCarrierNote": bool(candidate.get("carrierNoteAddition")),
                            "carrierNoteAdded": candidate.get("carrierNoteAddition") or "",
                            "cleanupStrategy": candidate.get("strategy"),
                            "cleanupOriginalStreet": candidate.get("originalStreet"),
                            "cleanupStreet": candidate.get("cleanStreet"),
                            "originalStatus": result_payload.get("status"),
                            "originalMessage": cleanup_message or match_message,
                            "appliedAddress": cleaned_address,
                        }
                    )
                    break
            mapy_address = mapy_address_from_item(first)
            original_status = status
            suggested_address = mapy_address if status == "suggestion" else None
            if status == "verified" and (cleanup_candidate or mapy_address_fills_missing_input(validation_data, mapy_address)):
                suggested_address = mapy_address
            if suggested_address:
                valid = True
                status = "verified"
                if cleanup_candidate:
                    message = result_payload.get("message") or "Adresa byla ocistena podle Mapy.com: " + mapy_address_label(suggested_address)
                elif original_status == "suggestion":
                    message = "Adresa byla upravena podle návrhu Mapy.com: " + mapy_address_label(suggested_address)
                else:
                    message = "Adresa byla doplněna podle přesné shody Mapy.com: " + mapy_address_label(suggested_address)
                result_payload.update(
                    {
                        "valid": valid,
                        "status": status,
                        "message": message,
                        "appliedSuggestion": original_status == "suggestion" and not cleanup_candidate,
                        "appliedAddressCompletion": original_status == "verified" and not cleanup_candidate,
                        "appliedAddress": suggested_address,
                        "originalStatus": result_payload.get("originalStatus") or original_status,
                        "originalMessage": result_payload.get("originalMessage") or match_message,
                    }
                )
            row_id = int_from_text(data.get("rowId"))
            carrier_note_addition = cleanup_candidate.get("carrierNoteAddition") if cleanup_candidate else ""
            updated_row = None
            if row_id:
                ensure_schema()
                with db_conn() as conn:
                    with conn.cursor(cursor_factory=RealDictCursor) as cur:
                        cur.execute("SELECT * FROM completion_rows WHERE id = %s", (row_id,))
                        original_row = cur.fetchone()
                        carrier_note_after = merge_carrier_note(
                            row_value(original_row or {}, "carrierNote", "carrier_note"),
                            carrier_note_addition,
                        )
                        if carrier_note_addition:
                            result_payload["carrierNoteAfter"] = carrier_note_after
                        if suggested_address:
                            cur.execute(
                                """
                                UPDATE completion_rows
                                SET street_with_number = %s,
                                    street = %s,
                                    house_number = %s,
                                    city = %s,
                                    zip_code = %s,
                                    carrier_note = CASE WHEN %s THEN %s ELSE carrier_note END,
                                    address_validation_status = %s,
                                    address_validation_message = %s,
                                    address_validation_query = %s,
                                    address_validation_checked_at = NOW(),
                                    address_validation_result = %s
                                WHERE id = %s
                                RETURNING *
                                """,
                                (
                                    suggested_address.get("streetWithNumber"),
                                    suggested_address.get("street"),
                                    suggested_address.get("houseNumber"),
                                    suggested_address.get("city"),
                                    suggested_address.get("zipCode"),
                                    bool(carrier_note_addition),
                                    carrier_note_after,
                                    status,
                                    message,
                                    query,
                                    Json(result_payload),
                                    row_id,
                                ),
                            )
                        else:
                            cur.execute(
                                """
                                UPDATE completion_rows
                                SET address_validation_status = %s,
                                    address_validation_message = %s,
                                    address_validation_query = %s,
                                    address_validation_checked_at = NOW(),
                                    address_validation_result = %s,
                                    carrier_note = CASE WHEN %s THEN %s ELSE carrier_note END
                                WHERE id = %s
                                RETURNING *
                                """,
                                (
                                    status,
                                    message,
                                    query,
                                    Json(result_payload),
                                    bool(carrier_note_addition),
                                    carrier_note_after,
                                    row_id,
                                ),
                            )
                        updated_row = cur.fetchone()
                        insert_address_validation_log(cur, original_row, updated_row, result_payload)
            if updated_row:
                result_payload["row"] = completion_row_to_api(updated_row)
            return jsonify({"ok": True, **result_payload})
    except urllib.error.HTTPError as exc:
        response_text = exc.read().decode("utf-8", "replace")
        return jsonify({"error": response_text or clean_text(exc.reason) or "Mapy.com API error"}), exc.code
    except urllib.error.URLError as exc:
        return jsonify({"error": clean_text(getattr(exc, "reason", exc)) or "Mapy.com request failed"}), 502
    except json.JSONDecodeError:
        return jsonify({"error": "Mapy.com returned invalid JSON"}), 502


@app.route("/api/address-validation-logs")
def address_validation_logs():
    auth_error = require_login()
    if auth_error:
        return auth_error

    ensure_schema()
    dataset_id = int_from_text(request.args.get("datasetId"))
    row_id = int_from_text(request.args.get("rowId"))
    limit = min(max(int_from_text(request.args.get("limit")) or 50, 1), 200)
    filters = []
    params = []
    if dataset_id:
        filters.append("dataset_id = %s")
        params.append(dataset_id)
    if row_id:
        filters.append("row_id = %s")
        params.append(row_id)
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    params.append(limit)

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT *
                FROM address_validation_logs
                {where}
                ORDER BY created_at DESC, id DESC
                LIMIT %s
                """,
                params,
            )
            logs = [address_validation_log_to_api(row) for row in cur.fetchall()]

    return jsonify({"logs": logs})


@app.route("/api/address-validation-logs/<int:log_id>/revert", methods=["POST"])
def revert_address_validation_log(log_id):
    auth_error = require_login()
    if auth_error:
        return auth_error

    ensure_schema()
    actor = current_user() or {}
    actor_name = actor.get("displayName") or actor.get("display_name") or actor.get("username") or actor.get("email") or ""
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM address_validation_logs WHERE id = %s FOR UPDATE", (log_id,))
            log_row = cur.fetchone()
            if not log_row:
                return jsonify({"error": "Zaznam logu nebyl nalezen."}), 404
            if log_row.get("reverted_at"):
                return jsonify({"error": "Tato zmena uz byla vracena."}), 400

            snapshot = log_row.get("original_snapshot") or {}
            row_id = log_row.get("row_id")
            if not row_id or not snapshot:
                return jsonify({"error": "Log nema ulozeny puvodni stav pro vraceni."}), 400

            checked_at = snapshot.get("addressValidationCheckedAt") or None
            cur.execute(
                """
                UPDATE completion_rows
                SET street_with_number = %s,
                    street = %s,
                    house_number = %s,
                    city = %s,
                    zip_code = %s,
                    carrier_note = %s,
                    address_validation_status = NULLIF(%s, ''),
                    address_validation_message = NULLIF(%s, ''),
                    address_validation_query = NULLIF(%s, ''),
                    address_validation_checked_at = %s,
                    address_validation_result = %s
                WHERE id = %s
                RETURNING *
                """,
                (
                    snapshot.get("streetWithNumber") or "",
                    snapshot.get("street") or "",
                    snapshot.get("houseNumber") or "",
                    snapshot.get("city") or "",
                    snapshot.get("zipCode") or "",
                    snapshot.get("carrierNote") or "",
                    snapshot.get("addressValidationStatus") or "",
                    snapshot.get("addressValidationMessage") or "",
                    snapshot.get("addressValidationQuery") or "",
                    checked_at,
                    Json(snapshot.get("addressValidationResult") or {}),
                    row_id,
                ),
            )
            updated_row = cur.fetchone()
            if not updated_row:
                return jsonify({"error": "Radek kompletace uz neexistuje."}), 404

            cur.execute(
                """
                UPDATE address_validation_logs
                SET reverted_at = NOW(),
                    reverted_by = %s
                WHERE id = %s
                RETURNING *
                """,
                (actor_name, log_id),
            )
            updated_log = cur.fetchone()

    return jsonify(
        {
            "ok": True,
            "row": completion_row_to_api(updated_row),
            "log": address_validation_log_to_api(updated_log),
        }
    )


@app.route("/api/sorting/rows/<int:row_id>/adjust", methods=["POST"])
def adjust_sorting_row(row_id):
    auth_error = require_login()
    if auth_error:
        return auth_error

    data = request.get_json(silent=True) or {}
    try:
        delta = int(data.get("delta"))
    except (TypeError, ValueError):
        return jsonify({"error": "Chybí platná změna množství."}), 400

    if delta == 0 or abs(delta) > 50:
        return jsonify({"error": "Změna množství musí být v rozumném rozsahu."}), 400

    amount = abs(delta)
    user = current_user()
    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if delta < 0:
                cur.execute(
                    """
                    UPDATE dataset_rows
                    SET remaining = remaining - %s
                    WHERE id = %s AND remaining >= %s
                    RETURNING *
                    """,
                    (amount, row_id, amount),
                )
            else:
                cur.execute(
                    """
                    UPDATE dataset_rows
                    SET remaining = remaining + %s
                    WHERE id = %s
                    RETURNING *
                    """,
                    (amount, row_id),
                )
            row = cur.fetchone()

            if not row:
                cur.execute("SELECT * FROM dataset_rows WHERE id = %s", (row_id,))
                current = cur.fetchone()
                if current:
                    return (
                        jsonify(
                            {
                                "error": "Položka už nemá dost kusů k odpisu. Načítám aktuální stav ze serveru.",
                                "row": row_to_api(current),
                            }
                        ),
                        409,
                    )
                return jsonify({"error": "Řádek roztřídění nebyl nalezen."}), 404

            payload = {
                "delta": delta,
                "amount": amount,
                "remainingAfter": row["remaining"],
                "mode": clean_text(data.get("mode")),
                "ean": clean_text(data.get("ean")),
                "userId": user["id"] if user else None,
                "username": user["username"] if user else "",
            }
            cur.execute(
                """
                INSERT INTO audit_events (
                    event_type, dataset_id, shop_code, order_number, row_ref, payload, actor
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    "sorting_deduct" if delta < 0 else "sorting_restore",
                    row["dataset_id"],
                    row["shop_code"],
                    row["order_number"],
                    row["sequence"],
                    Json(payload),
                    user["username"] if user else "unknown",
                ),
            )

    return jsonify({"ok": True, "row": row_to_api(row), "delta": delta, "actor": user_to_api(user)})


@app.route("/api/completion/rows/<int:row_id>/workflow", methods=["POST"])
def update_completion_workflow(row_id):
    auth_error = require_login()
    if auth_error:
        return auth_error

    data = request.get_json(silent=True) or {}
    action = clean_text(data.get("action")).strip().lower()
    status_by_action = {
        "ok": "OK",
        "error": "ERROR",
        "unpaid": "NEZAPLACENO",
        "unpaid_error": "NEZAPLACENO + ERROR",
        "manual_reprint": "PŘETISK ŠTÍTKU",
        "clear_error": "",
    }
    if action not in status_by_action:
        return jsonify({"error": "Neznámá akce kompletace."}), 400

    user = current_user()
    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE completion_rows
                SET completion_status = %s,
                    label_printed = CASE
                        WHEN %s = 'ok' THEN COALESCE(NULLIF(label_printed, ''), 'ano')
                        ELSE label_printed
                    END
                WHERE id = %s
                RETURNING *
                """,
                (status_by_action[action], action, row_id),
            )
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Řádek kompletace nebyl nalezen."}), 404

            cur.execute(
                """
                INSERT INTO audit_events (
                    event_type, dataset_id, shop_code, order_number, row_ref, payload, actor
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    "completion_workflow",
                    row["dataset_id"],
                    row["shop_code"],
                    row["order_number"],
                    row["expedition_number"],
                    Json({"action": action, "status": status_by_action[action]}),
                    user["username"] if user else "unknown",
                ),
            )

    return jsonify({"ok": True, "row": completion_row_to_api(row), "actor": user_to_api(user)})


@app.route("/api/completion/rows/<int:row_id>", methods=["PATCH"])
def update_completion_row(row_id):
    auth_error = require_upload_token()
    if auth_error:
        return auth_error

    ensure_schema()
    data = request.get_json(silent=True) or {}
    allowed = {
        "firstName": "first_name",
        "lastName": "last_name",
        "phone": "phone",
        "email": "email",
        "streetWithNumber": "street_with_number",
        "street": "street",
        "houseNumber": "house_number",
        "city": "city",
        "zipCode": "zip_code",
        "carrierNote": "carrier_note",
    }
    updates = []
    params = []
    for api_name, column_name in allowed.items():
        if api_name not in data:
            continue
        updates.append(f"{column_name} = %s")
        params.append(clean_text(data.get(api_name)))

    address_fields = {"streetWithNumber", "street", "houseNumber", "city", "zipCode"}
    if any(field in data for field in address_fields):
        updates.extend(
            [
                "address_validation_status = NULL",
                "address_validation_message = NULL",
                "address_validation_query = NULL",
                "address_validation_checked_at = NULL",
                "address_validation_result = '{}'::jsonb",
            ]
        )

    if not updates:
        return jsonify({"error": "No editable fields provided"}), 400

    params.append(row_id)
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                UPDATE completion_rows
                SET {', '.join(updates)}
                WHERE id = %s
                RETURNING *
                """,
                params,
            )
            row = cur.fetchone()

    if not row:
        return jsonify({"error": "Completion row not found"}), 404

    return jsonify({"ok": True, "row": completion_row_to_api(row)})


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
    include_deleted = include_deleted_for_admin()
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
                    clean_text(data.get("deletedBy")) or (current_user() or {}).get("username") or "vba-or-admin",
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
    include_deleted = include_deleted_for_admin()
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
            "expedition_day_id",
            "kind",
            "batch_name",
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
                row["expedition_day_id"],
                row["dataset_kind"],
                row["batch_name"],
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
    dataset_kind = request.args.get("kind")
    dataset_date = request.args.get("date")
    shop_code = request.args.get("shop")

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if dataset_id:
                cur.execute("SELECT * FROM datasets WHERE id = %s", (dataset_id,))
            else:
                filters = ["status = 'active'"]
                params = []
                if dataset_kind:
                    filters.append("dataset_kind = %s")
                    params.append(dataset_kind)
                if dataset_date:
                    filters.append("dataset_date = %s")
                    params.append(dataset_date)
                if shop_code:
                    filters.append("shop_code = %s")
                    params.append(normalize_shop_code(shop_code))
                where = " AND ".join(filters)
                cur.execute(
                    f"SELECT * FROM datasets WHERE {where} ORDER BY uploaded_at DESC, id DESC LIMIT 1",
                    params,
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
    dataset_date = request.args.get("date")
    shop_code = request.args.get("shop")
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if dataset_id:
                cur.execute(
                    "SELECT * FROM datasets WHERE id = %s AND dataset_kind = 'completion'",
                    (dataset_id,),
                )
            else:
                filters = ["status = 'active'", "dataset_kind = 'completion'"]
                params = []
                if dataset_date:
                    filters.append("dataset_date = %s")
                    params.append(dataset_date)
                if shop_code:
                    filters.append("shop_code = %s")
                    params.append(normalize_shop_code(shop_code))
                where = " AND ".join(filters)
                cur.execute(
                    f"""
                    SELECT * FROM datasets
                    WHERE {where}
                    ORDER BY uploaded_at DESC, id DESC
                    LIMIT 1
                    """,
                    params,
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

