import csv
import hashlib
import io
import json
import os
import secrets
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from xml.sax.saxutils import escape as xml_escape
from zoneinfo import ZoneInfo

import psycopg2
from psycopg2.extras import Json, RealDictCursor
from flask import Flask, Response, g, jsonify, request, send_from_directory
from werkzeug.security import check_password_hash, generate_password_hash


APP_DIR = os.path.dirname(os.path.abspath(__file__))
PRAGUE_TZ = ZoneInfo("Europe/Prague")

app = Flask(__name__, static_folder=None)
SCHEMA_READY = False
SESSION_COOKIE = "expedice_session"
SESSION_SECONDS = 12 * 60 * 60
INITIAL_ADMIN_USERNAME = "d.najman@centrum.cz"
INITIAL_ADMIN_PASSWORD = "1234"

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
    global SCHEMA_READY
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
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
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
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS address_validation_status TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS address_validation_message TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS address_validation_query TEXT")
            cur.execute("ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS address_validation_checked_at TIMESTAMPTZ")
            cur.execute(
                "ALTER TABLE completion_rows ADD COLUMN IF NOT EXISTS address_validation_result JSONB NOT NULL DEFAULT '{}'::jsonb"
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
    username = INITIAL_ADMIN_USERNAME.lower()
    cur.execute("SELECT id FROM users WHERE username = %s", (username,))
    if cur.fetchone():
        return

    cur.execute(
        """
        INSERT INTO users (
            username, display_name, password_hash, role, active, must_change_password
        )
        VALUES (%s, %s, %s, 'admin', TRUE, TRUE)
        """,
        (username, "Dominik Najman", generate_password_hash(INITIAL_ADMIN_PASSWORD)),
    )


def normalize_username(value):
    return clean_text(value).strip().lower()


def hash_session_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_to_api(user):
    if not user:
        return None
    return {
        "id": user["id"],
        "username": user["username"],
        "displayName": user.get("display_name") or user["username"],
        "role": user.get("role") or "employee",
        "active": bool(user.get("active")),
        "mustChangePassword": bool(user.get("must_change_password")),
        "createdAt": user.get("created_at").isoformat() if user.get("created_at") else None,
        "updatedAt": user.get("updated_at").isoformat() if user.get("updated_at") else None,
        "lastLoginAt": user.get("last_login_at").isoformat() if user.get("last_login_at") else None,
    }


def is_admin(user=None):
    active_user = user or current_user()
    return bool(active_user and active_user.get("role") == "admin")


def current_user():
    if hasattr(g, "current_user"):
        return g.current_user

    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        g.current_user = None
        return None

    token_hash = hash_session_token(token)
    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT u.*
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
            if user:
                cur.execute("UPDATE user_sessions SET last_seen_at = NOW() WHERE token_hash = %s", (token_hash,))

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
    ensure_schema()
    data = request.get_json(silent=True) or {}
    username = normalize_username(data.get("username") or data.get("email"))
    password = clean_text(data.get("password"))
    if not username or not password:
        return jsonify({"error": "Vyplň uživatelské jméno/e-mail a heslo."}), 400

    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM users WHERE username = %s", (username,))
            user = cur.fetchone()
            if not user or not user["active"] or not check_password_hash(user["password_hash"], password):
                return jsonify({"error": "Nesprávné přihlašovací údaje."}), 401

            token = create_user_session(cur, user["id"])
            cur.execute("UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = %s RETURNING *", (user["id"],))
            user = cur.fetchone()

    response = jsonify({"ok": True, "user": user_to_api(user)})
    set_session_cookie(response, token)
    return response


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        ensure_schema()
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM user_sessions WHERE token_hash = %s", (hash_session_token(token),))
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
                (generate_password_hash(new_password), user["id"]),
            )
            updated = cur.fetchone()

    g.current_user = updated
    return jsonify({"ok": True, "user": user_to_api(updated)})


@app.route("/api/users")
def list_users():
    auth_error = require_admin()
    if auth_error:
        return auth_error

    ensure_schema()
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
        return jsonify({"error": "Role musí být admin nebo employee."}), 400
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
                    VALUES (%s, %s, %s, %s, TRUE, TRUE, %s)
                    RETURNING *
                    """,
                    (username, display_name or username, generate_password_hash(password), role, creator["id"]),
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
            return jsonify({"error": "Role musí být admin nebo employee."}), 400
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
                    must_change_password = TRUE,
                    updated_at = NOW()
                WHERE id = %s
                RETURNING *
                """,
                (generate_password_hash(password), user_id),
            )
            user = cur.fetchone()
            if user:
                cur.execute("DELETE FROM user_sessions WHERE user_id = %s", (user_id,))

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
    text = searchable_text(" ".join([shipping, dpd_flag, shop_code]))
    is_sk_order = (
        shop_code.endswith("_sk")
        or "packeta.sk" in text
        or "odberne miesto" in text
        or "kuri" in text
        or "slovensk" in text
    )

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
    is_packeta_courier = "kuri" in text and "adres" in text

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
        "latestUpload": row["latest_upload"].isoformat() if row.get("latest_upload") else None,
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


def default_settings():
    return {
        "mapy": {
            "apiKey": os.environ.get("MAPY_API_KEY", ""),
        },
        "packeta": {
            "apiUrl": os.environ.get("PACKETA_API_URL", "https://www.zasilkovna.cz/api/rest"),
            "apiPassword": os.environ.get("PACKETA_API_PASSWORD", ""),
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


def read_settings(include_secrets=False):
    ensure_schema()
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT value FROM app_settings WHERE key = 'expedition'")
            row = cur.fetchone()

    settings = deep_merge_settings(default_settings(), row["value"] if row else {})
    if include_secrets:
        return settings

    public_settings = json.loads(json.dumps(settings))
    for section, field in (("mapy", "apiKey"), ("packeta", "apiPassword"), ("dpd", "apiKey")):
        value = public_settings.get(section, {}).get(field, "")
        public_settings[section][f"has{field[0].upper()}{field[1:]}"] = bool(value)
        public_settings[section][field] = ""
    return public_settings


def merge_secret_field(next_section, current_section, field):
    if field not in next_section or next_section.get(field) == "":
        next_section[field] = current_section.get(field, "")
    elif next_section.get(field) == "__CLEAR__":
        next_section[field] = ""


def save_settings_payload(payload):
    current = read_settings(include_secrets=True)
    incoming = payload if isinstance(payload, dict) else {}
    next_settings = deep_merge_settings(current, incoming)
    merge_secret_field(next_settings["mapy"], current["mapy"], "apiKey")
    merge_secret_field(next_settings["packeta"], current["packeta"], "apiPassword")
    merge_secret_field(next_settings["dpd"], current["dpd"], "apiKey")
    next_settings["dpd"]["apiBaseUrl"] = clean_text(next_settings["dpd"].get("apiBaseUrl")).rstrip("/")

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
    delivery = delivery_info_from_row(row)
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


def packeta_skip_reason(row):
    delivery = delivery_info_from_row(row)
    status_text = " ".join(
        clean_text(row.get(key))
        for key in ("completionStatus", "packetaStatus", "labelPrinted", "note", "shippingMethod")
    )
    if not clean_text(row.get("orderNumber")):
        return "chybi cislo objednavky"
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
    return ""


def packeta_dry_run_packet(row):
    route = packeta_route(row)
    currency = shipment_currency(row)
    value = clean_text(row.get("amount")) or ("29" if currency == "EUR" else "0")
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
    ):
        if attrs[key] or key in ("company", "cod"):
            xml_parts.append(f"<{key}>{packeta_text(attrs[key])}</{key}>")
    xml_parts.extend(["</packetAttributes>", "</createPacket>"])

    warnings = []
    if not attrs["phone"]:
        warnings.append("chybi telefon")
    if not attrs["email"]:
        warnings.append("chybi e-mail")
    if not attrs["street"] and route["service"] != "pickup_point":
        warnings.append("kuryr bez ulice")
    if not attrs["weight"]:
        warnings.append("chybi vaha")

    return {
        "rowNumber": row.get("rowNumber"),
        "orderNumber": attrs["number"],
        "customer": " ".join(part for part in (attrs["name"], attrs["surname"]) if part),
        "shippingMethod": clean_text(row.get("shippingMethod")),
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


@app.route("/api/expedition-days")
def list_expedition_days():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    include_deleted = request.args.get("includeDeleted") == "1"
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
    include_deleted = request.args.get("includeDeleted") == "1"
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
    include_deleted = request.args.get("includeDeleted") == "1"
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    ed.*,
                    COUNT(d.id) FILTER (WHERE d.status = 'active') AS active_batches,
                    COUNT(d.id) AS all_batches,
                    COALESCE(SUM(d.rows_count) FILTER (WHERE d.status = 'active'), 0) AS rows_count,
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
    include_deleted = request.args.get("includeDeleted") == "1"
    with db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    ed.*,
                    COUNT(d.id) FILTER (WHERE d.status = 'active') AS active_batches,
                    COUNT(d.id) AS all_batches,
                    COALESCE(SUM(d.rows_count) FILTER (WHERE d.status = 'active'), 0) AS rows_count,
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


def packeta_api_url():
    return read_settings(include_secrets=True)["packeta"].get("apiUrl") or "https://www.zasilkovna.cz/api/rest"


def packeta_validation_xml(request_xml, password):
    xml = request_xml.replace("<createPacket>", "<packetAttributesValid>", 1)
    xml = xml.replace("</createPacket>", "</packetAttributesValid>", 1)
    xml = xml.replace("DRY_RUN_PASSWORD_OMITTED", packeta_text(password), 1)
    xml = xml.replace(
        "\n  <packetCourierNumber>\n    <packetId>1234567890</packetId>\n  </packetCourierNumber>",
        "",
    )
    return xml


def packeta_response_status(response_text):
    compact = clean_text(response_text).lower().replace(" ", "").replace("\n", "").replace("\r", "")
    if "<status>ok</status>" in compact:
        return "ok"
    if "<status>fault</status>" in compact:
        return "fault"
    if "<status>error</status>" in compact:
        return "error"
    return "unknown"


def packeta_post_validation_xml(validation_xml):
    timeout = int_from_text(os.environ.get("PACKETA_API_TIMEOUT")) or 20
    request_data = validation_xml.encode("utf-8")
    packeta_request = urllib.request.Request(
        packeta_api_url(),
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


def dpd_api_url():
    return read_settings(include_secrets=True)["dpd"].get("apiBaseUrl", "").rstrip("/")


def dpd_api_token():
    return read_settings(include_secrets=True)["dpd"].get("apiKey", "")


def dpd_country(row):
    shop_code = clean_text(row.get("shopCode") or row.get("shop_code")).lower()
    if shop_code.endswith("_sk") or delivery_info_from_row(row).get("isSk"):
        return "SK"
    return "CZ"


def shipment_currency(row):
    shop_code = clean_text(row.get("shopCode") or row.get("shop_code")).lower()
    delivery = delivery_info_from_row(row)
    if shop_code.endswith("_sk") or delivery.get("isSk") or dpd_country(row) == "SK":
        return "EUR"
    return "CZK"


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
    shipment = {
        "reference": clean_text(row.get("orderNumber")),
        "orderId": clean_text(row.get("orderId")),
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
        "note": clean_text(row.get("note")),
        "source": {
            "rowNumber": row.get("rowNumber"),
            "shippingMethod": clean_text(row.get("shippingMethod")),
            "datasetRowId": row.get("id"),
        },
    }
    warnings = []
    if not shipment["address"]["validated"] and delivery["service"] == "dpd_courier":
        warnings.append("Adresa neni oznacena jako overena.")
    if not shipment["cashOnDelivery"]["amount"]:
        warnings.append("Bez dobirky.")
    return {
        "rowNumber": row.get("rowNumber"),
        "orderNumber": row.get("orderNumber"),
        "customer": dpd_recipient_name(row),
        "shippingMethod": row.get("shippingMethod"),
        "service": delivery["service"],
        "serviceLabel": delivery["serviceLabel"],
        "warnings": warnings,
        "payload": shipment,
    }


def dpd_request_headers():
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    token = dpd_api_token()
    if token:
        headers["x-api-key"] = token
    return headers


def dpd_post_payload(payload):
    settings = read_settings(include_secrets=True)["dpd"]
    if not settings.get("sendEnabled"):
        return {
            "httpStatus": 0,
            "ok": False,
            "responseText": "",
            "error": "DPD odesílání není povolené v Nastavení",
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
        headers=dpd_request_headers(),
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
    if not parts["zipCode"]:
        missing.append("PSČ")

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

    password = read_settings(include_secrets=True)["packeta"].get("apiPassword", "")
    if not password:
        return jsonify({"error": "PACKETA_API_PASSWORD is not configured"}), 400

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
        validation_xml = packeta_validation_xml(packet["requestXml"], password)
        result = packeta_post_validation_xml(validation_xml)
        results.append(
            {
                "rowNumber": packet.get("rowNumber"),
                "orderNumber": packet.get("orderNumber"),
                "customer": packet.get("customer"),
                "shippingMethod": packet.get("shippingMethod"),
                "service": packet.get("service"),
                "addressId": packet.get("addressId"),
                "eshop": packet.get("eshop"),
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


@app.route("/api/dpd/dry-run")
def dpd_dry_run():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    dataset_id = request.args.get("datasetId") or request.args.get("id")
    dataset_date = request.args.get("date")
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
        shipments.append(dpd_payload(row))

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
        shipments.append(dpd_payload(row))

    selected = shipments[:limit]
    dpd_settings = read_settings(include_secrets=True)["dpd"]
    api_payload = {
        "mode": data.get("mode") or dpd_settings.get("mode") or "test",
        "source": "expedice-railway",
        "dataset": dataset_summary(dataset),
        "shipments": [item["payload"] for item in selected],
    }
    api_result = dpd_post_payload(api_payload)

    return jsonify(
        {
            "ok": api_result["ok"],
            "carrier": "dpd",
            "endpointConfigured": bool(dpd_api_url()),
            "sendEnabled": read_settings(include_secrets=True)["dpd"].get("sendEnabled", False),
            "dataset": dataset_summary(dataset),
            "shipmentsCount": len(shipments),
            "sentCount": len(selected) if api_result["ok"] else 0,
            "notSentCount": max(0, len(shipments) - len(selected)),
            "skippedCount": len(skipped),
            "result": api_result,
            "shipments": selected,
            "skipped": skipped,
        }
    )


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
    saved = save_settings_payload(payload.get("settings") or payload)
    public_settings = json.loads(json.dumps(saved))
    for section, field in (("mapy", "apiKey"), ("packeta", "apiPassword"), ("dpd", "apiKey")):
        value = public_settings.get(section, {}).get(field, "")
        public_settings[section][f"has{field[0].upper()}{field[1:]}"] = bool(value)
        public_settings[section][field] = ""
    return jsonify({"ok": True, "settings": public_settings})


@app.route("/api/completion/datasets")
def list_completion_datasets():
    auth_error = require_download_token_if_configured()
    if auth_error:
        return auth_error

    ensure_schema()
    include_deleted = request.args.get("includeDeleted") == "1"
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
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE completion_rows
                        SET address_validation_status = %s,
                            address_validation_message = %s,
                            address_validation_query = %s,
                            address_validation_checked_at = NOW(),
                            address_validation_result = %s
                        WHERE id = %s
                        """,
                        ("error", precheck_error, query, Json(result_payload), row_id),
                    )
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
            row_id = int_from_text(data.get("rowId"))
            if row_id:
                ensure_schema()
                with db_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE completion_rows
                            SET address_validation_status = %s,
                                address_validation_message = %s,
                                address_validation_query = %s,
                                address_validation_checked_at = NOW(),
                                address_validation_result = %s
                            WHERE id = %s
                            """,
                            (status, message, query, Json(result_payload), row_id),
                        )
            return jsonify(
                {
                    "ok": True,
                    "valid": valid,
                    "status": status,
                    "message": message,
                    "query": query,
                    "country": mapy_country(data),
                    "items": items,
                    "rawCount": len(items),
                }
            )
    except urllib.error.HTTPError as exc:
        response_text = exc.read().decode("utf-8", "replace")
        return jsonify({"error": response_text or clean_text(exc.reason) or "Mapy.com API error"}), exc.code
    except urllib.error.URLError as exc:
        return jsonify({"error": clean_text(getattr(exc, "reason", exc)) or "Mapy.com request failed"}), 502
    except json.JSONDecodeError:
        return jsonify({"error": "Mapy.com returned invalid JSON"}), 502


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
