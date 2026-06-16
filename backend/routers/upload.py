import json
from contextlib import closing
from datetime import date
from pathlib import Path
from typing import Any
from uuid import uuid4

import pandas as pd
from fastapi import APIRouter, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from config import ALLOWED_EXTENSIONS, MAX_FILE_SIZE_MB, OUTPUT_DIR, UPLOAD_DIR
from database import (
    count_uploads,
    get_db,
    get_recent_uploads,
    insert_audit,
    insert_upload,
    update_upload,
)
from services.file_reader import FileReader
from services.file_writer import FileWriter
from services.transformer import DataTransformer


router = APIRouter()

DOWNLOAD_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)
DOWNLOAD_EXTENSIONS = {".xlsx", ".xls", ".csv"}


@router.post("/upload")
async def upload_pos_file(
    request: Request,
    file: UploadFile | None = File(None),
    source_system: str = Form("Unknown"),
    transaction_date: str | None = Form(None),
):
    original_filename = _original_filename(file)
    stored_filename = _stored_filename(original_filename)
    transaction_date_value = _transaction_date_value(transaction_date)
    uploader_ip = request.client.host if request.client else None

    try:
        with closing(get_db()) as conn:
            upload_id = insert_upload(
                conn,
                {
                    "filename": stored_filename,
                    "original_name": original_filename,
                    "source_system": source_system or "Unknown",
                    "transaction_date": transaction_date_value,
                    "status": "processing",
                    "uploader_ip": uploader_ip,
                },
            )

            if file is None:
                return _validation_failure(
                    conn,
                    upload_id,
                    "missing_file",
                    "A file is required.",
                )

            normalized_date = _parse_transaction_date(transaction_date)
            if normalized_date is None:
                return _validation_failure(
                    conn,
                    upload_id,
                    "invalid_transaction_date",
                    "transaction_date must be an ISO date in YYYY-MM-DD format.",
                )

            extension = _file_extension(original_filename)
            if extension not in _allowed_extensions():
                return _validation_failure(
                    conn,
                    upload_id,
                    "invalid_file_type",
                    (
                        "File extension must be one of: "
                        f"{', '.join(sorted(_allowed_extensions()))}."
                    ),
                )

            try:
                content = await file.read((MAX_FILE_SIZE_MB * 1024 * 1024) + 1)
            except Exception as exc:
                return _server_failure(
                    conn,
                    upload_id,
                    "file_read_failed",
                    f"Unable to read uploaded file: {exc}",
                    original_filename,
                )

            if len(content) > MAX_FILE_SIZE_MB * 1024 * 1024:
                return _validation_failure(
                    conn,
                    upload_id,
                    "file_too_large",
                    f"File size must be {MAX_FILE_SIZE_MB} MB or less.",
                )

            saved_path = Path(UPLOAD_DIR) / stored_filename
            try:
                saved_path.write_bytes(content)
            except OSError as exc:
                return _server_failure(
                    conn,
                    upload_id,
                    "file_save_failed",
                    f"Unable to save uploaded file: {exc}",
                    original_filename,
                )

            try:
                read_result = FileReader().read(str(saved_path))
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
                    "pipeline_error",
                    detail,
                    warnings=[],
                    errors=[detail],
                )
                return JSONResponse(
                    status_code=500,
                    content=_upload_error_payload(
                        upload_id,
                        original_filename,
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
                    "transaction_date": normalized_date,
                    "output_file": output_filename,
                    "error_report": error_filename,
                    "row_count": transform_result.row_count,
                    "error_count": transform_result.error_count,
                },
            )
            _insert_audit(
                conn,
                upload_id,
                "upload_completed",
                "Upload processed successfully.",
                warnings=transform_result.warnings,
                errors=transform_result.errors,
            )

            return {
                "upload_id": upload_id,
                "status": "done",
                "original_filename": original_filename,
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
        return JSONResponse(
            status_code=500,
            content={
                "error": "server_error",
                "detail": f"{type(exc).__name__}: {exc}",
            },
        )
    finally:
        if file is not None:
            await file.close()


@router.get("/download/{filename:path}")
async def download_output_file(filename: str):
    if not _safe_download_filename(filename):
        return JSONResponse(
            status_code=400,
            content={
                "error": "invalid_filename",
                "detail": "Filename is not allowed.",
            },
        )

    output_dir = Path(OUTPUT_DIR).resolve()
    file_path = (output_dir / filename).resolve()
    if file_path.parent != output_dir:
        return JSONResponse(
            status_code=400,
            content={
                "error": "invalid_filename",
                "detail": "Filename is not allowed.",
            },
        )
    if not file_path.is_file():
        return JSONResponse(
            status_code=404,
            content={
                "error": "file_not_found",
                "detail": "Output file was not found.",
            },
        )

    return FileResponse(
        path=str(file_path),
        filename=filename,
        media_type=DOWNLOAD_MEDIA_TYPE,
    )


@router.get("/uploads")
async def list_uploads(
    limit: int = Query(20),
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
        return JSONResponse(
            status_code=500,
            content={
                "error": "server_error",
                "detail": f"{type(exc).__name__}: {exc}",
            },
        )

    return {
        "uploads": [_upload_history_item(row) for row in rows],
        "total": total,
    }


def _original_filename(file: UploadFile | None) -> str:
    if file is None or not file.filename:
        return "missing"
    return file.filename.replace("\\", "/").rsplit("/", 1)[-1]


def _stored_filename(original_filename: str) -> str:
    suffix = Path(original_filename).suffix.lower()
    return f"{uuid4()}{suffix}"


def _transaction_date_value(transaction_date: str | None) -> str:
    if transaction_date is None or transaction_date.strip() == "":
        return date.today().isoformat()
    return transaction_date.strip()


def _parse_transaction_date(transaction_date: str | None) -> str | None:
    value = _transaction_date_value(transaction_date)
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        return None


def _file_extension(filename: str) -> str:
    return Path(filename).suffix.lower().lstrip(".")


def _allowed_extensions() -> set[str]:
    return {extension.lower().lstrip(".") for extension in ALLOWED_EXTENSIONS}


def _validation_failure(
    conn,
    upload_id: int,
    error: str,
    detail: str,
) -> JSONResponse:
    update_upload(conn, upload_id, {"status": "error", "error_count": 1})
    _insert_audit(
        conn,
        upload_id,
        "validation_error",
        detail,
        warnings=[],
        errors=[detail],
    )
    return JSONResponse(
        status_code=400,
        content={
            "error": error,
            "detail": detail,
        },
    )


def _server_failure(
    conn,
    upload_id: int,
    error: str,
    detail: str,
    original_filename: str,
) -> JSONResponse:
    update_upload(conn, upload_id, {"status": "error", "error_count": 1})
    _insert_audit(
        conn,
        upload_id,
        error,
        detail,
        warnings=[],
        errors=[detail],
    )
    return JSONResponse(
        status_code=500,
        content=_upload_error_payload(upload_id, original_filename, error, detail),
    )


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


def _optional_filename(path_value: Any) -> str | None:
    if not path_value:
        return None
    return Path(str(path_value)).name


def _preview_records(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    preview_df = dataframe.head(10).where(pd.notna(dataframe.head(10)), None)
    return [
        {str(key): _json_safe(value) for key, value in record.items()}
        for record in preview_df.to_dict(orient="records")
    ]


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(value, "item"):
        return value.item()
    return value


def _safe_download_filename(filename: str) -> bool:
    if ".." in filename or "/" in filename or "\\" in filename:
        return False
    return Path(filename).suffix.lower() in DOWNLOAD_EXTENSIONS


def _upload_history_item(row: dict[str, Any]) -> dict[str, Any]:
    output_file = row.get("output_file")
    return {
        "id": row["id"],
        "original_name": row["original_name"],
        "source_system": row.get("source_system") or "",
        "transaction_date": row.get("transaction_date") or "",
        "uploaded_at": row.get("uploaded_at") or "",
        "status": row.get("status") or "",
        "row_count": row.get("row_count") or 0,
        "error_count": row.get("error_count") or 0,
        "download_url": f"/api/download/{output_file}" if output_file else None,
    }
