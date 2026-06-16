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
) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT *
        FROM uploads
        ORDER BY uploaded_at DESC, id DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [dict(row) for row in rows]


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
