import json
from contextlib import closing
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from uuid import uuid4

import pandas as pd
from fastapi import APIRouter, File, Query, Request, UploadFile, Form
from fastapi.responses import JSONResponse

from config import ALLOWED_EXTENSIONS, MAX_FILE_SIZE_MB, OUTPUT_DIR, UPLOAD_DIR
from database import get_db, insert_audit, insert_upload, update_upload
from services.file_reader import FileReader
from services.file_writer import FileWriter
from services.transformer import TransformResult

from .upload import _optional_filename, _preview_records


router = APIRouter()

MATCH_THRESHOLD = 0.4
TYPE_MATCH_BONUS = 0.05
FUZZY_SCORE_MULTIPLIER = 0.9


@router.post("/transform/with-template")
async def transform_with_template(
    request: Request,
    pos_file: UploadFile | None = File(None),
    template_file: UploadFile | None = File(None),
    confirmed_mapping: str | None = Form(None),
):
    if _has_confirmed_mapping(confirmed_mapping):
        try:
            return await _transform_with_confirmed_mapping(
                request=request,
                pos_file=pos_file,
                confirmed_mapping=confirmed_mapping or "",
            )
        finally:
            await _close_uploads(template_file)

    try:
        pos_path, _ = await _save_upload_file(pos_file, label="pos")
        template_path, _ = await _save_upload_file(template_file, label="template")

        reader = FileReader()
        pos_result = reader.read(str(pos_path))
        template_result = reader.read(str(template_path))

        pos_df = pos_result["dataframe"]
        template_df = template_result["dataframe"]
        return {
            "mode": "suggestion",
            "template_columns": [str(column) for column in template_df.columns],
            "pos_columns": [str(column) for column in pos_df.columns],
            "suggestions": _suggest_mappings(pos_df, template_df),
        }
    except ValueError as exc:
        return JSONResponse(
            status_code=400,
            content={
                "error": "validation_error",
                "detail": str(exc),
            },
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={
                "error": "template_suggestion_failed",
                "detail": f"{type(exc).__name__}: {exc}",
            },
        )
    finally:
        await _close_uploads(pos_file, template_file)


@router.get("/transform/with-template/columns")
async def template_columns(filepath: str = Query(...)):
    try:
        template_path = _resolve_uploaded_file(filepath)
        result = FileReader().read(str(template_path))
    except FileNotFoundError:
        return JSONResponse(
            status_code=404,
            content={
                "error": "file_not_found",
                "detail": "Template file was not found.",
            },
        )
    except ValueError as exc:
        return JSONResponse(
            status_code=400,
            content={
                "error": "invalid_template_file",
                "detail": str(exc),
            },
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={
                "error": "template_columns_failed",
                "detail": f"{type(exc).__name__}: {exc}",
            },
        )

    return {"columns": [str(column) for column in result["column_names"]]}


async def _transform_with_confirmed_mapping(
    request: Request,
    pos_file: UploadFile | None,
    confirmed_mapping: str,
):
    original_filename = _original_filename(pos_file)
    stored_filename = _stored_filename(original_filename)
    uploader_ip = request.client.host if request.client else None

    try:
        with closing(get_db()) as conn:
            upload_id = insert_upload(
                conn,
                {
                    "filename": stored_filename,
                    "original_name": original_filename,
                    "source_system": "Custom Template",
                    "transaction_date": datetime.today().date().isoformat(),
                    "status": "processing",
                    "uploader_ip": uploader_ip,
                },
            )

            if pos_file is None:
                return _validation_failure(
                    conn,
                    upload_id,
                    "missing_file",
                    "A POS file is required.",
                )

            try:
                saved_path, _ = await _save_upload_file(
                    pos_file,
                    label="pos",
                    stored_filename=stored_filename,
                )
                mapping = _parse_confirmed_mapping(confirmed_mapping)
                read_result = FileReader().read(str(saved_path))
                transform_result = _apply_confirmed_mapping(
                    read_result["dataframe"],
                    mapping,
                )
                write_result = FileWriter().write(transform_result, OUTPUT_DIR)
            except ValueError as exc:
                detail = str(exc)
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
                    "validation_error",
                    detail,
                    warnings=[],
                    errors=[detail],
                )
                return JSONResponse(
                    status_code=400,
                    content=_upload_error_payload(
                        upload_id,
                        original_filename,
                        "validation_error",
                        detail,
                    ),
                )
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
                    "output_file": output_filename,
                    "error_report": error_filename,
                    "row_count": transform_result.row_count,
                    "error_count": transform_result.error_count,
                },
            )
            _insert_audit(
                conn,
                upload_id,
                "template_upload_completed",
                "Custom template mapping processed successfully.",
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
        await _close_uploads(pos_file)


async def _save_upload_file(
    file: UploadFile | None,
    label: str,
    stored_filename: str | None = None,
) -> tuple[Path, str]:
    if file is None:
        raise ValueError(f"A {label} file is required.")

    original_filename = _original_filename(file)
    extension = _file_extension(original_filename)
    if extension not in _allowed_extensions():
        raise ValueError(
            "File extension must be one of: "
            f"{', '.join(sorted(_allowed_extensions()))}."
        )

    try:
        content = await file.read((MAX_FILE_SIZE_MB * 1024 * 1024) + 1)
    except Exception as exc:
        raise ValueError(f"Unable to read uploaded {label} file: {exc}") from exc

    if len(content) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise ValueError(f"File size must be {MAX_FILE_SIZE_MB} MB or less.")

    upload_dir = Path(UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = stored_filename or _stored_filename(original_filename, label=label)
    saved_path = upload_dir / filename
    try:
        saved_path.write_bytes(content)
    except OSError as exc:
        raise ValueError(f"Unable to save uploaded {label} file: {exc}") from exc

    return saved_path, original_filename


def _suggest_mappings(pos_df: pd.DataFrame, template_df: pd.DataFrame) -> list[dict]:
    pos_columns = [str(column) for column in pos_df.columns]
    template_columns = [str(column) for column in template_df.columns]
    pos_types = {
        column: _infer_column_type(pos_df[column])
        for column in pos_columns
    }
    template_types = {
        column: _infer_column_type(template_df[column])
        for column in template_columns
    }

    suggestions: list[dict[str, Any]] = []
    for output_col in template_columns:
        best_input_col: str | None = None
        best_score = 0.0
        best_reason = "no POS columns available"

        for input_col in pos_columns:
            score, reason = _score_column_pair(
                output_col,
                input_col,
                template_types[output_col],
                pos_types[input_col],
            )
            if score > best_score:
                best_input_col = input_col
                best_score = score
                best_reason = reason

        if best_score < MATCH_THRESHOLD:
            suggestions.append(
                {
                    "output_col": output_col,
                    "suggested_input_col": None,
                    "confidence": round(best_score, 4),
                    "match_reason": _no_match_reason(best_input_col, best_score),
                }
            )
            continue

        suggestions.append(
            {
                "output_col": output_col,
                "suggested_input_col": best_input_col,
                "confidence": round(best_score, 4),
                "match_reason": best_reason,
            }
        )

    return suggestions


def _score_column_pair(
    output_col: str,
    input_col: str,
    output_type: str,
    input_type: str,
) -> tuple[float, str]:
    output_name = _normalize_column_name(output_col)
    input_name = _normalize_column_name(input_col)

    if output_name.lower() == input_name.lower():
        return 1.0, "exact name match"

    base_score = SequenceMatcher(None, output_name.lower(), input_name.lower()).ratio()
    score = min(base_score * FUZZY_SCORE_MULTIPLIER, FUZZY_SCORE_MULTIPLIER)
    reasons = [f"fuzzy name match ({score:.2f})"]

    if output_type != "unknown" and output_type == input_type:
        score += TYPE_MATCH_BONUS
        reasons.append(f"{output_type} data type match bonus")

    return min(score, 1.0), "; ".join(reasons)


def _apply_confirmed_mapping(
    input_df: pd.DataFrame,
    mapping: list[dict[str, Any]],
) -> TransformResult:
    output_data: dict[str, list[Any]] = {}
    column_summary: list[dict[str, str]] = []
    warnings: list[str] = []
    errors: list[str] = []

    for item in mapping:
        output_col = _required_string(item, "output_col")
        source = str(item.get("source", "direct")).strip().lower()

        if output_col in output_data:
            raise ValueError(f"Duplicate output column in mapping: {output_col}")

        if source == "direct":
            input_col = _required_string(item, "input_col")
            if input_col not in input_df.columns:
                raise ValueError(
                    f'Mapping for "{output_col}" references missing POS column '
                    f'"{input_col}".'
                )

            transform = item.get("transform")
            output_data[output_col] = _transform_series(
                input_df[input_col],
                transform,
                output_col,
                input_col,
                errors,
                warnings,
            )
            source_note = f'input_df["{input_col}"]'
            if transform:
                source_note = f"{source_note} | transform: {transform}"
            column_summary.append(
                {
                    "column": output_col,
                    "source": source_note,
                    "status": "mapped",
                }
            )
            continue

        if source == "hardcoded":
            value = item.get("value", "")
            output_data[output_col] = [value] * len(input_df)
            column_summary.append(
                {
                    "column": output_col,
                    "source": f"Hardcoded {value}",
                    "status": "hardcoded",
                }
            )
            continue

        raise ValueError(
            f'Mapping for "{output_col}" has unsupported source "{source}".'
        )

    output_df = pd.DataFrame(output_data, columns=list(output_data))

    return TransformResult(
        output_df=output_df,
        row_count=len(output_df),
        error_count=len(errors),
        warnings=_deduplicate_messages(warnings),
        errors=errors,
        column_summary=column_summary,
    )


def _transform_series(
    series: pd.Series,
    transform: Any,
    output_col: str,
    input_col: str,
    errors: list[str],
    warnings: list[str],
) -> list[Any]:
    transform_name = "" if transform is None else str(transform).strip()
    if transform_name == "":
        return [_empty_to_blank(value) for value in series.tolist()]

    normalized_transform = transform_name.lower()
    values: list[Any] = []

    for row_number, value in enumerate(series.tolist(), start=1):
        if normalized_transform in {"strip_commas_to_float", "number", "float"}:
            parsed_value, is_valid = _try_parse_float(value)
            if not is_valid:
                errors.append(
                    f"Row {row_number}: {input_col} is empty or invalid; "
                    f"{output_col} set to 0.0"
                )
            values.append(parsed_value)
            continue

        if normalized_transform in {
            "date_reformat",
            "parse_date_flexible",
            "date",
        }:
            parsed_date = _try_parse_date(value)
            if parsed_date is None:
                warnings.append(
                    f"{output_col} date parse failed; used today's date"
                )
                values.append(_today_string())
            else:
                values.append(parsed_date)
            continue

        if normalized_transform in {
            "cast_to_string",
            "cast_to_string_strip",
            "string_strip",
            "strip",
            "text",
        }:
            values.append("" if _is_missing(value) else str(value).strip())
            continue

        raise ValueError(
            f'Mapping for "{output_col}" uses unsupported transform '
            f'"{transform_name}".'
        )

    return values


def _parse_confirmed_mapping(value: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError(f"confirmed_mapping must be valid JSON: {exc.msg}") from exc

    if not isinstance(parsed, list):
        raise ValueError("confirmed_mapping must be a JSON array.")

    for index, item in enumerate(parsed, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Mapping item {index} must be an object.")
        _required_string(item, "output_col")

    return parsed


def _infer_column_type(series: pd.Series) -> str:
    non_empty_values = [
        value
        for value in series.tolist()
        if not _is_missing(value)
    ]
    if not non_empty_values:
        return "unknown"

    numeric_values = pd.to_numeric(pd.Series(non_empty_values), errors="coerce")
    numeric_count = int(numeric_values.notna().sum())
    if numeric_count / len(non_empty_values) >= 0.8:
        return "numeric"

    return "string"


def _try_parse_float(value: Any) -> tuple[float, bool]:
    if _is_missing(value):
        return 0.0, False

    cleaned_value = str(value).strip().replace(",", "")
    if cleaned_value == "":
        return 0.0, False

    try:
        return float(cleaned_value), True
    except (TypeError, ValueError):
        return 0.0, False


def _try_parse_date(value: Any) -> str | None:
    if _is_missing(value):
        return None

    if isinstance(value, pd.Timestamp):
        return value.strftime("%m/%d/%Y")

    if isinstance(value, datetime):
        return value.strftime("%m/%d/%Y")

    text_value = str(value).strip()
    if text_value == "":
        return None

    for date_format in ("%m/%d/%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text_value, date_format).strftime("%m/%d/%Y")
        except ValueError:
            continue

    try:
        parsed = pd.to_datetime(text_value, errors="raise")
        if _is_missing(parsed):
            return None
        return parsed.strftime("%m/%d/%Y")
    except (TypeError, ValueError):
        return None


def _resolve_uploaded_file(filepath: str) -> Path:
    upload_dir = Path(UPLOAD_DIR).resolve()
    provided_path = Path(filepath)
    candidate = provided_path if provided_path.is_absolute() else upload_dir / filepath
    resolved = candidate.resolve()

    try:
        resolved.relative_to(upload_dir)
    except ValueError as exc:
        raise ValueError("filepath must point to a file inside the uploads directory.") from exc

    if not resolved.is_file():
        raise FileNotFoundError(filepath)

    return resolved


def _required_string(item: dict[str, Any], key: str) -> str:
    value = item.get(key)
    if value is None or str(value).strip() == "":
        raise ValueError(f'Mapping item is missing required field "{key}".')
    return str(value).strip()


def _has_confirmed_mapping(value: str | None) -> bool:
    return value is not None and value.strip() != ""


def _normalize_column_name(value: str) -> str:
    return " ".join(str(value).strip().split())


def _no_match_reason(best_input_col: str | None, best_score: float) -> str:
    if best_input_col is None:
        return "no POS columns available"
    return f"no confident match; best candidate scored {best_score:.2f}"


def _empty_to_blank(value: Any) -> Any:
    return "" if _is_missing(value) else value


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def _deduplicate_messages(messages: list[str]) -> list[str]:
    counts: dict[str, int] = {}
    ordered: list[str] = []

    for message in messages:
        if message not in counts:
            ordered.append(message)
            counts[message] = 0
        counts[message] += 1

    return [
        f"{message} ({counts[message]} rows)" if counts[message] > 1 else message
        for message in ordered
    ]


def _today_string() -> str:
    return datetime.today().strftime("%m/%d/%Y")


def _original_filename(file: UploadFile | None) -> str:
    if file is None or not file.filename:
        return "missing"
    return file.filename.replace("\\", "/").rsplit("/", 1)[-1]


def _stored_filename(original_filename: str, label: str = "pos") -> str:
    suffix = Path(original_filename).suffix.lower()
    return f"{uuid4()}_{label}{suffix}"


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


async def _close_uploads(*files: UploadFile | None) -> None:
    for file in files:
        if file is not None:
            await file.close()
