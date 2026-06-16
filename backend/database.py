import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from config import DATABASE_URL


UPLOAD_COLUMNS = {
    "filename",
    "original_name",
    "source_system",
    "transaction_date",
    "uploaded_at",
    "status",
    "row_count",
    "error_count",
    "output_file",
    "error_report",
    "uploader_ip",
}

AUDIT_COLUMNS = {
    "upload_id",
    "event",
    "detail",
    "warnings",
    "errors",
    "created_at",
}

SEEDED_COLUMN_DEFAULTS = [
    {
        "column_name": "Customer",
        "default_value": "NA",
        "value_type": "string",
        "description": "Default customer value used when POS has no customer data.",
    },
    {
        "column_name": "Product",
        "default_value": "NA",
        "value_type": "string",
        "description": "Default product value used when POS has no product data.",
    },
    {
        "column_name": "Doc Class",
        "default_value": "NA",
        "value_type": "string",
        "description": "Default ERP document class.",
    },
    {
        "column_name": "Customer Code",
        "default_value": "NA",
        "value_type": "string",
        "description": "Default ERP customer code.",
    },
    {
        "column_name": "Product Name",
        "default_value": "NA",
        "value_type": "string",
        "description": "Default ERP product name.",
    },
    {
        "column_name": "Account Type",
        "default_value": "NA",
        "value_type": "string",
        "description": "Default ERP account type.",
    },
    {
        "column_name": "Bank Code",
        "default_value": "NA",
        "value_type": "string",
        "description": "Default ERP bank code.",
    },
    {
        "column_name": "SI Number",
        "default_value": "NA",
        "value_type": "string",
        "description": "Default ERP sales invoice number.",
    },
    {
        "column_name": "Order Number",
        "default_value": "NA",
        "value_type": "string",
        "description": "Default ERP order number.",
    },
    {
        "column_name": "Class",
        "default_value": "0",
        "value_type": "int",
        "description": "Default ERP class value.",
    },
    {
        "column_name": "Order Date",
        "default_value": "NA",
        "value_type": "string",
        "description": "Default ERP order date value.",
    },
    {
        "column_name": "Active",
        "default_value": "1",
        "value_type": "int",
        "description": "Default active flag for ERP imports.",
    },
]


def get_db() -> sqlite3.Connection:
    db_path = Path(DATABASE_URL)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    with closing(get_db()) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS uploads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                original_name TEXT NOT NULL,
                source_system TEXT,
                transaction_date TEXT,
                uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'pending',
                row_count INTEGER DEFAULT 0,
                error_count INTEGER DEFAULT 0,
                output_file TEXT,
                error_report TEXT,
                uploader_ip TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                upload_id INTEGER REFERENCES uploads(id),
                event TEXT NOT NULL,
                detail TEXT,
                warnings TEXT,
                errors TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS column_defaults (
                column_name TEXT PRIMARY KEY,
                default_value TEXT NOT NULL,
                value_type TEXT NOT NULL,
                description TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        _seed_column_defaults(connection)
        connection.commit()


def insert_upload(conn: sqlite3.Connection, data: dict[str, Any]) -> int:
    _validate_columns(data, UPLOAD_COLUMNS)
    _require_columns(data, {"filename", "original_name"})

    columns = list(data.keys())
    placeholders = ", ".join("?" for _ in columns)
    column_names = ", ".join(columns)
    values = [data[column] for column in columns]

    cursor = conn.execute(
        f"INSERT INTO uploads ({column_names}) VALUES ({placeholders})",
        values,
    )
    conn.commit()
    return int(cursor.lastrowid)


def update_upload(
    conn: sqlite3.Connection,
    upload_id: int,
    data: dict[str, Any],
) -> None:
    _validate_columns(data, UPLOAD_COLUMNS)
    if not data:
        return

    assignments = ", ".join(f"{column} = ?" for column in data)
    values = [*data.values(), upload_id]

    conn.execute(
        f"UPDATE uploads SET {assignments} WHERE id = ?",
        values,
    )
    conn.commit()


def insert_audit(conn: sqlite3.Connection, data: dict[str, Any]) -> None:
    _validate_columns(data, AUDIT_COLUMNS)
    _require_columns(data, {"event"})

    columns = list(data.keys())
    placeholders = ", ".join("?" for _ in columns)
    column_names = ", ".join(columns)
    values = [data[column] for column in columns]

    conn.execute(
        f"INSERT INTO audit_log ({column_names}) VALUES ({placeholders})",
        values,
    )
    conn.commit()


def get_upload(conn: sqlite3.Connection, upload_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM uploads WHERE id = ?",
        (upload_id,),
    ).fetchone()
    return _row_to_dict(row)


def get_recent_uploads(
    conn: sqlite3.Connection,
    limit: int = 20,
    offset: int = 0,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT *
        FROM uploads
        ORDER BY uploaded_at DESC, id DESC
        LIMIT ? OFFSET ?
        """,
        (limit, offset),
    ).fetchall()
    return [dict(row) for row in rows]


def count_uploads(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT COUNT(*) AS total FROM uploads").fetchone()
    return int(row["total"])


def get_column_defaults(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT column_name, default_value, value_type, description, updated_at
        FROM column_defaults
        ORDER BY
            CASE column_name
                WHEN 'Customer' THEN 1
                WHEN 'Product' THEN 2
                WHEN 'Doc Class' THEN 3
                WHEN 'Customer Code' THEN 4
                WHEN 'Product Name' THEN 5
                WHEN 'Account Type' THEN 6
                WHEN 'Bank Code' THEN 7
                WHEN 'SI Number' THEN 8
                WHEN 'Order Number' THEN 9
                WHEN 'Class' THEN 10
                WHEN 'Order Date' THEN 11
                WHEN 'Active' THEN 12
                ELSE 99
            END,
            column_name
        """
    ).fetchall()
    return [dict(row) for row in rows]


def get_column_default(
    conn: sqlite3.Connection,
    column_name: str,
) -> dict[str, Any] | None:
    row = conn.execute(
        """
        SELECT column_name, default_value, value_type, description, updated_at
        FROM column_defaults
        WHERE column_name = ?
        """,
        (column_name,),
    ).fetchone()
    return _row_to_dict(row)


def update_column_default(
    conn: sqlite3.Connection,
    column_name: str,
    default_value: str,
) -> dict[str, Any] | None:
    conn.execute(
        """
        UPDATE column_defaults
        SET default_value = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE column_name = ?
        """,
        (default_value, column_name),
    )
    conn.commit()
    return get_column_default(conn, column_name)


def _validate_columns(data: dict[str, Any], allowed_columns: set[str]) -> None:
    unknown_columns = set(data) - allowed_columns
    if unknown_columns:
        columns = ", ".join(sorted(unknown_columns))
        raise ValueError(f"Unknown database column(s): {columns}")


def _require_columns(data: dict[str, Any], required_columns: set[str]) -> None:
    missing_columns = required_columns - set(data)
    if missing_columns:
        columns = ", ".join(sorted(missing_columns))
        raise ValueError(f"Missing required database column(s): {columns}")


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return dict(row)


def _seed_column_defaults(conn: sqlite3.Connection) -> None:
    for item in SEEDED_COLUMN_DEFAULTS:
        conn.execute(
            """
            INSERT OR IGNORE INTO column_defaults (
                column_name,
                default_value,
                value_type,
                description
            )
            VALUES (?, ?, ?, ?)
            """,
            (
                item["column_name"],
                item["default_value"],
                item["value_type"],
                item["description"],
            ),
        )
