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
    "template",
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
        "column_name": "SI Number",
        "default_value": "(generated from date)",
        "value_type": "formula",
        "description": "Auto-generated as DDMMYYYY from Invoice Date.",
    },
    {
        "column_name": "Invoice Date",
        "default_value": "(from POS Date)",
        "value_type": "date",
        "description": "Direct from POS Date column.",
    },
    {
        "column_name": "Product Code",
        "default_value": "NA",
        "value_type": "string",
        "description": "ERP internal product code - set this once.",
    },
    {
        "column_name": "Quantity",
        "default_value": "1",
        "value_type": "int",
        "description": "Daily batch = 1 unit always.",
    },
    {
        "column_name": "Unit Price",
        "default_value": "(formula)",
        "value_type": "formula",
        "description": "(Net Sales - VAT - VAT Adjustment) / Quantity.",
    },
    {
        "column_name": "Amount",
        "default_value": "(formula)",
        "value_type": "formula",
        "description": "Net Sales - VAT - VAT Adjustment.",
    },
    {
        "column_name": "Term Amount",
        "default_value": "(formula)",
        "value_type": "formula",
        "description": "VAT + VAT Adjustment.",
    },
    {
        "column_name": "Term Code",
        "default_value": "V",
        "value_type": "string",
        "description": "ERP payment term code.",
    },
    {
        "column_name": "Customer Code",
        "default_value": "NA",
        "value_type": "string",
        "description": "ERP customer ID - set this once.",
    },
    {
        "column_name": "Doc Class",
        "default_value": "NA",
        "value_type": "string",
        "description": "ERP document class code - set this once.",
    },
    {
        "column_name": "Currency Code",
        "default_value": "PHP",
        "value_type": "string",
        "description": "Always PHP for POS transactions.",
    },
    {
        "column_name": "Remarks",
        "default_value": "(from POS Remarks)",
        "value_type": "string",
        "description": "Direct from POS Remarks column.",
    },
]

NEW_POS_SEEDED_COLUMN_DEFAULTS = [
    {
        "column_name": "SI Number",
        "default_value": "(generated from date/payment)",
        "value_type": "formula",
        "description": "RR1 + payment-method letter + Business Date MMDD.",
    },
    {
        "column_name": "Invoice Date",
        "default_value": "(from Business Date)",
        "value_type": "date",
        "description": "Business Date converted from DD/MM/YYYY to MM/DD/YYYY output.",
    },
    {
        "column_name": "Product Code",
        "default_value": "0001",
        "value_type": "string",
        "description": "ERP product code for New POS rows.",
    },
    {
        "column_name": "Quantity",
        "default_value": "0",
        "value_type": "int",
        "description": "Quantity written for each payment row.",
    },
    {
        "column_name": "Amount",
        "default_value": "(from Gross Sale w/o VAT)",
        "value_type": "formula",
        "description": "Gross Sale w/o VAT; MAYA QR methods are totalled.",
    },
    {
        "column_name": "Sales Discount",
        "default_value": "(from Discount Amount)",
        "value_type": "formula",
        "description": "Discount Amount; MAYA QR methods are totalled.",
    },
    {
        "column_name": "VAT Payable",
        "default_value": "(from VAT Amount)",
        "value_type": "formula",
        "description": "VAT Amount; MAYA QR methods are totalled.",
    },
    {
        "column_name": "Customer Code",
        "default_value": "(from Payment Method)",
        "value_type": "formula",
        "description": "Four-character text code selected from the payment-method mapping.",
    },
    {
        "column_name": "Doc Class",
        "default_value": "RR1",
        "value_type": "string",
        "description": "ERP document class for New POS rows.",
    },
    {
        "column_name": "Currency Code",
        "default_value": "PHP",
        "value_type": "string",
        "description": "Currency code for New POS rows.",
    },
    {
        "column_name": "Remarks",
        "default_value": "",
        "value_type": "string",
        "description": "Remarks written for New POS rows.",
    },
]

TEMPLATE_COLUMN_DEFAULTS = {
    "old_pos": SEEDED_COLUMN_DEFAULTS,
    "new_pos": NEW_POS_SEEDED_COLUMN_DEFAULTS,
}

SEEDED_COLUMN_NAMES = [item["column_name"] for item in SEEDED_COLUMN_DEFAULTS]
SEEDED_COLUMN_BY_NAME = {
    item["column_name"]: item for item in SEEDED_COLUMN_DEFAULTS
}
TEMPLATE_COLUMN_BY_NAME = {
    template: {item["column_name"]: item for item in items}
    for template, items in TEMPLATE_COLUMN_DEFAULTS.items()
}


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
                uploader_ip TEXT,
                template TEXT DEFAULT 'old_pos'
            )
            """
        )
        upload_column_names = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(uploads)").fetchall()
        }
        if "template" not in upload_column_names:
            connection.execute(
                "ALTER TABLE uploads ADD COLUMN template TEXT DEFAULT 'old_pos'"
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
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS template_column_defaults (
                template TEXT NOT NULL,
                column_name TEXT NOT NULL,
                default_value TEXT NOT NULL,
                value_type TEXT NOT NULL,
                description TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (template, column_name)
            )
            """
        )
        connection.execute(
            """
            INSERT OR IGNORE INTO template_column_defaults (
                template,
                column_name,
                default_value,
                value_type,
                description,
                updated_at
            )
            SELECT
                'old_pos',
                column_name,
                default_value,
                value_type,
                description,
                updated_at
            FROM column_defaults
            """
        )
        _seed_template_column_defaults(connection)
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


def delete_upload(conn: sqlite3.Connection, upload_id: int) -> bool:
    conn.execute("DELETE FROM audit_log WHERE upload_id = ?", (upload_id,))
    cursor = conn.execute("DELETE FROM uploads WHERE id = ?", (upload_id,))
    conn.commit()
    return cursor.rowcount > 0


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


def get_column_defaults(
    conn: sqlite3.Connection,
    template: str = "old_pos",
) -> list[dict[str, Any]]:
    seeds = _template_default_seeds(template)
    column_names = [item["column_name"] for item in seeds]
    placeholders = ", ".join("?" for _ in column_names)
    rows = conn.execute(
        f"""
        SELECT
            template,
            column_name,
            default_value,
            value_type,
            description,
            updated_at
        FROM template_column_defaults
        WHERE template = ? AND column_name IN ({placeholders})
        """,
        (template, *column_names),
    ).fetchall()
    rows_by_name = {row["column_name"]: dict(row) for row in rows}
    return [
        _with_template_seed_description(rows_by_name[column_name], template)
        for column_name in column_names
        if column_name in rows_by_name
    ]


def get_column_default(
    conn: sqlite3.Connection,
    column_name: str,
    template: str = "old_pos",
) -> dict[str, Any] | None:
    seeds_by_name = _template_default_seeds_by_name(template)
    row = conn.execute(
        """
        SELECT
            template,
            column_name,
            default_value,
            value_type,
            description,
            updated_at
        FROM template_column_defaults
        WHERE template = ? AND column_name = ?
        """,
        (template, column_name),
    ).fetchone()
    row_dict = _row_to_dict(row)
    if row_dict is None:
        return None
    if row_dict["column_name"] not in seeds_by_name:
        return None
    return _with_template_seed_description(row_dict, template)


def update_column_default(
    conn: sqlite3.Connection,
    column_name: str,
    default_value: str,
    value_type: str,
    template: str = "old_pos",
) -> dict[str, Any] | None:
    _template_default_seeds_by_name(template)
    conn.execute(
        """
        UPDATE template_column_defaults
        SET default_value = ?,
            value_type = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE template = ? AND column_name = ?
        """,
        (default_value, value_type, template, column_name),
    )
    conn.commit()
    return get_column_default(conn, column_name, template)


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


def _with_seed_description(row: dict[str, Any]) -> dict[str, Any]:
    seed = SEEDED_COLUMN_BY_NAME.get(str(row.get("column_name") or ""))
    if seed is None:
        return row

    row["description"] = seed["description"]
    row["value"] = row.get("default_value")
    return row


def _with_template_seed_description(
    row: dict[str, Any],
    template: str,
) -> dict[str, Any]:
    seed = _template_default_seeds_by_name(template).get(
        str(row.get("column_name") or "")
    )
    if seed is None:
        return row

    row["description"] = seed["description"]
    row["value"] = row.get("default_value")
    return row


def _template_default_seeds(template: str) -> list[dict[str, str]]:
    try:
        return TEMPLATE_COLUMN_DEFAULTS[template]
    except KeyError as exc:
        raise ValueError(f'Unknown template "{template}".') from exc


def _template_default_seeds_by_name(
    template: str,
) -> dict[str, dict[str, str]]:
    try:
        return TEMPLATE_COLUMN_BY_NAME[template]
    except KeyError as exc:
        raise ValueError(f'Unknown template "{template}".') from exc


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
        _upgrade_legacy_seed_default(conn, item)
        conn.execute(
            """
            UPDATE column_defaults
            SET description = ?
            WHERE column_name = ?
            """,
            (item["description"], item["column_name"]),
        )


def _seed_template_column_defaults(conn: sqlite3.Connection) -> None:
    for template, items in TEMPLATE_COLUMN_DEFAULTS.items():
        for item in items:
            conn.execute(
                """
                INSERT OR IGNORE INTO template_column_defaults (
                    template,
                    column_name,
                    default_value,
                    value_type,
                    description
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    template,
                    item["column_name"],
                    item["default_value"],
                    item["value_type"],
                    item["description"],
                ),
            )
            conn.execute(
                """
                UPDATE template_column_defaults
                SET description = ?
                WHERE template = ? AND column_name = ?
                """,
                (item["description"], template, item["column_name"]),
            )

    conn.execute(
        """
        UPDATE template_column_defaults
        SET default_value = '0001',
            updated_at = CURRENT_TIMESTAMP
        WHERE template = 'new_pos'
          AND column_name = 'Product Code'
          AND default_value = '001'
          AND value_type = 'string'
        """
    )


def _upgrade_legacy_seed_default(
    conn: sqlite3.Connection,
    seed_item: dict[str, str],
) -> None:
    if seed_item["column_name"] != "SI Number":
        return

    row = conn.execute(
        """
        SELECT default_value, value_type
        FROM column_defaults
        WHERE column_name = ?
        """,
        (seed_item["column_name"],),
    ).fetchone()
    if row is None:
        return

    if row["default_value"] == "NA" and row["value_type"] == "string":
        conn.execute(
            """
            UPDATE column_defaults
            SET default_value = ?,
                value_type = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE column_name = ?
            """,
            (
                seed_item["default_value"],
                seed_item["value_type"],
                seed_item["column_name"],
            ),
        )
