import json
from contextlib import closing
from datetime import date, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from config import OUTPUT_DIR, UPLOAD_DIR
from database import (
    count_uploads,
    delete_upload,
    get_column_default,
    get_column_defaults,
    get_db,
    get_recent_uploads,
    get_upload,
    insert_audit,
    update_column_default,
    update_upload,
)
from services.file_reader import FileReader
from services.file_writer import FileWriter
from services.transformer import DataTransformer

from .upload import _optional_filename, _preview_records


router = APIRouter(prefix="/admin")

VALID_DEFAULT_TYPES = {"string", "int", "float", "date", "formula"}


class DefaultUpdateRequest(BaseModel):
    value: str | None = None
    default_value: str | None = None
    value_type: str | None = None


@router.get("/stats")
async def admin_stats():
    today_prefix = date.today().isoformat()
    month_prefix = today_prefix[:7]

    try:
        with closing(get_db()) as conn:
            uploads_today = _count_uploads_like(conn, today_prefix)
            uploads_this_month = _count_uploads_like(conn, month_prefix)
            errors_today = _sum_errors_like(conn, today_prefix)
            total_rows_processed = _sum_total_rows(conn)
    except Exception as exc:
        return _server_error(exc)

    return {
        "uploads_today": uploads_today,
        "uploads_this_month": uploads_this_month,
        "errors_today": errors_today,
        "total_rows_processed": total_rows_processed,
    }


@router.get("/uploads")
async def admin_uploads(
    limit: int = Query(50),
    offset: int = Query(0),
):
    if limit < 0 or offset < 0:
        return JSONResponse(
            status_code=400,
            content={
                "error": "invalid_pagination",
                "detail": "limit and offset must be zero or greater.",
            },
        )

    try:
        with closing(get_db()) as conn:
            rows = get_recent_uploads(conn, limit=limit, offset=offset)
            total = count_uploads(conn)
    except Exception as exc:
        return _server_error(exc)

    return {
        "uploads": [_admin_upload_history_item(row) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.delete("/uploads/{upload_id}")
async def delete_admin_upload(upload_id: int):
    try:
        with closing(get_db()) as conn:
            upload = get_upload(conn, upload_id)
            if upload is None:
                return JSONResponse(
                    status_code=404,
                    content={
                        "error": "upload_not_found",
                        "detail": "Upload was not found.",
                    },
                )

            try:
                _delete_upload_artifacts(upload, include_source=True)
            except ValueError as exc:
                return JSONResponse(
                    status_code=400,
                    content={
                        "error": "invalid_upload_file",
                        "detail": str(exc),
                    },
                )
            except OSError as exc:
                return JSONResponse(
                    status_code=500,
                    content={
                        "error": "file_delete_failed",
                        "detail": f"Unable to delete upload files: {exc}",
                    },
                )

            delete_upload(conn, upload_id)
    except Exception as exc:
        return _server_error(exc)

    return {"status": "deleted", "upload_id": upload_id}


@router.post("/uploads/{upload_id}/reprocess")
async def reprocess_upload(upload_id: int):
    try:
        with closing(get_db()) as conn:
            upload = get_upload(conn, upload_id)
            if upload is None:
                return JSONResponse(
                    status_code=404,
                    content={
                        "error": "upload_not_found",
                        "detail": "Upload was not found.",
                    },
                )

            try:
                source_path = _resolve_source_file(str(upload["filename"]))
            except FileNotFoundError:
                return JSONResponse(
                    status_code=404,
                    content={
                        "error": "source_file_not_found",
                        "detail": "The originally uploaded file was not found.",
                    },
                )
            except ValueError as exc:
                return JSONResponse(
                    status_code=400,
                    content={
                        "error": "invalid_source_file",
                        "detail": str(exc),
                    },
                )

            update_upload(
                conn,
                upload_id,
                {
                    "status": "processing",
                    "error_count": 0,
                    "output_file": None,
                    "error_report": None,
                },
            )

            try:
                _delete_upload_artifacts(upload, include_source=False)
                read_result = FileReader().read(str(source_path))
                transform_result = DataTransformer().transform(read_result["dataframe"])
                write_result = FileWriter().write(transform_result, OUTPUT_DIR)
            except Exception as exc:
                detail = f"{type(exc).__name__}: {exc}"
                update_upload(
                    conn,
                    upload_id,
                    {
                        "status": "error",
                        "row_count": 0,
                        "error_count": 1,
                    },
                )
                _insert_audit(
                    conn,
                    upload_id,
                    "reprocess_pipeline_error",
                    detail,
                    warnings=[],
                    errors=[detail],
                )
                return JSONResponse(
                    status_code=500,
                    content=_upload_error_payload(
                        upload_id,
                        str(upload["original_name"]),
                        "pipeline_error",
                        detail,
                    ),
                )

            output_filename = str(write_result["output_filename"])
            error_filename = _optional_filename(write_result.get("summary_path"))

            update_upload(
                conn,
                upload_id,
                {
                    "status": "done",
                    "output_file": output_filename,
                    "error_report": error_filename,
                    "row_count": transform_result.row_count,
                    "error_count": transform_result.error_count,
                },
            )
            _insert_audit(
                conn,
                upload_id,
                "upload_reprocessed",
                "Upload reprocessed successfully.",
                warnings=transform_result.warnings,
                errors=transform_result.errors,
            )

            return {
                "upload_id": upload_id,
                "status": "done",
                "original_filename": upload["original_name"],
                "row_count": transform_result.row_count,
                "error_count": transform_result.error_count,
                "warnings": transform_result.warnings,
                "errors": transform_result.errors,
                "column_summary": transform_result.column_summary,
                "download_url": f"/api/download/{output_filename}",
                "error_report_url": (
                    f"/api/download/{error_filename}" if error_filename else None
                ),
                "preview": _preview_records(transform_result.output_df),
            }
    except Exception as exc:
        return _server_error(exc)


@router.get("/defaults")
async def list_defaults():
    try:
        with closing(get_db()) as conn:
            defaults = get_column_defaults(conn)
    except Exception as exc:
        return _server_error(exc)

    return {"defaults": defaults}


@router.put("/defaults/{column}")
async def update_default(column: str, request: DefaultUpdateRequest):
    try:
        with closing(get_db()) as conn:
            existing = get_column_default(conn, column)
            if existing is None:
                return JSONResponse(
                    status_code=404,
                    content={
                        "error": "default_not_found",
                        "detail": "Column default was not found.",
                    },
                )

            normalized_value_type = _normalize_default_type(
                request.value_type or str(existing["value_type"]),
            )
            requested_value = (
                request.value
                if request.value is not None
                else request.default_value
            )
            if requested_value is None:
                requested_value = str(existing["default_value"])

            normalized_value = _normalize_default_value(
                requested_value,
                normalized_value_type,
            )
            updated = update_column_default(
                conn,
                column,
                normalized_value,
                normalized_value_type,
            )
    except ValueError as exc:
        return JSONResponse(
            status_code=400,
            content={
                "error": "invalid_default_value",
                "detail": str(exc),
            },
        )
    except Exception as exc:
        return _server_error(exc)

    return {"default": updated}


def _count_uploads_like(conn, prefix: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS total FROM uploads WHERE uploaded_at LIKE ?",
        (f"{prefix}%",),
    ).fetchone()
    return int(row["total"])


def _sum_errors_like(conn, prefix: str) -> int:
    row = conn.execute(
        """
        SELECT COALESCE(SUM(error_count), 0) AS total
        FROM uploads
        WHERE uploaded_at LIKE ?
        """,
        (f"{prefix}%",),
    ).fetchone()
    return int(row["total"])


def _sum_total_rows(conn) -> int:
    row = conn.execute(
        "SELECT COALESCE(SUM(row_count), 0) AS total FROM uploads"
    ).fetchone()
    return int(row["total"])


def _admin_upload_history_item(row: dict[str, Any]) -> dict[str, Any]:
    output_file = row.get("output_file")
    error_report = row.get("error_report")
    return {
        "id": row["id"],
        "filename": row.get("filename") or "",
        "original_name": row["original_name"],
        "source_system": row.get("source_system") or "",
        "transaction_date": row.get("transaction_date") or "",
        "uploaded_at": row.get("uploaded_at") or "",
        "status": row.get("status") or "",
        "row_count": row.get("row_count") or 0,
        "error_count": row.get("error_count") or 0,
        "output_file": output_file,
        "error_report": error_report,
        "uploader_ip": row.get("uploader_ip") or "",
        "download_url": f"/api/download/{output_file}" if output_file else None,
        "error_report_url": f"/api/download/{error_report}" if error_report else None,
    }


def _resolve_source_file(filename: str) -> Path:
    if ".." in filename or "/" in filename or "\\" in filename:
        raise ValueError("Stored filename is not allowed.")

    upload_dir = Path(UPLOAD_DIR).resolve()
    source_path = (upload_dir / filename).resolve()
    if source_path.parent != upload_dir:
        raise ValueError("Stored filename is not allowed.")
    if not source_path.is_file():
        raise FileNotFoundError(filename)
    return source_path


def _delete_upload_artifacts(
    upload: dict[str, Any],
    *,
    include_source: bool,
) -> None:
    _delete_named_file(OUTPUT_DIR, upload.get("output_file"))
    _delete_named_file(OUTPUT_DIR, upload.get("error_report"))

    if include_source:
        _delete_named_file(UPLOAD_DIR, upload.get("filename"))


def _delete_named_file(directory: str, filename: Any) -> None:
    if not filename:
        return

    filename_value = str(filename)
    if ".." in filename_value or "/" in filename_value or "\\" in filename_value:
        raise ValueError("Stored filename is not allowed.")

    base_dir = Path(directory).resolve()
    file_path = (base_dir / filename_value).resolve()
    if file_path.parent != base_dir:
        raise ValueError("Stored filename is not allowed.")

    if file_path.is_file():
        file_path.unlink()


def _normalize_default_value(value: str, value_type: str) -> str:
    if value_type == "formula":
        return str(value)

    if value_type == "int":
        try:
            return str(int(str(value).strip()))
        except (TypeError, ValueError) as exc:
            raise ValueError("Default value must be an integer.") from exc

    if value_type == "float":
        try:
            return str(float(str(value).strip()))
        except (TypeError, ValueError) as exc:
            raise ValueError("Default value must be a number.") from exc

    if value_type == "date":
        text_value = str(value).strip()
        if text_value.startswith("(") and text_value.endswith(")"):
            return text_value
        if text_value == "":
            raise ValueError("Default value must be a date.")
        for date_format in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"):
            try:
                parsed = datetime.strptime(text_value, date_format)
                return parsed.strftime("%Y-%m-%d")
            except ValueError:
                continue
        raise ValueError("Default value must be a date.")

    return str(value)


def _normalize_default_type(value_type: str) -> str:
    normalized_type = str(value_type).strip().lower()
    if normalized_type not in VALID_DEFAULT_TYPES:
        raise ValueError(f'Unsupported value type "{value_type}".')
    return normalized_type


def _insert_audit(
    conn,
    upload_id: int,
    event: str,
    detail: str,
    warnings: list[str],
    errors: list[str],
) -> None:
    insert_audit(
        conn,
        {
            "upload_id": upload_id,
            "event": event,
            "detail": detail,
            "warnings": json.dumps(warnings),
            "errors": json.dumps(errors),
        },
    )


def _upload_error_payload(
    upload_id: int,
    original_filename: str,
    error: str,
    detail: str,
) -> dict[str, Any]:
    return {
        "error": error,
        "detail": detail,
        "upload_id": upload_id,
        "status": "error",
        "original_filename": original_filename,
        "row_count": 0,
        "error_count": 1,
        "warnings": [],
        "errors": [detail],
        "column_summary": [],
        "download_url": None,
        "error_report_url": None,
        "preview": [],
    }


def _server_error(exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "error": "server_error",
            "detail": f"{type(exc).__name__}: {exc}",
        },
    )
