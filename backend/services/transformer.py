from contextlib import closing
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
import warnings as py_warnings

import pandas as pd


OUTPUT_COLUMNS = [
    "SI Number",
    "Invoice Date",
    "Product Code",
    "Quantity",
    "Unit Price",
    "Amount",
    "Term Amount",
    "Customer Code",
    "Doc Class",
    "Currency Code",
    "Remarks",
]

FALLBACK_COLUMN_DEFAULTS = {
    "SI Number": {
        "default_value": "(generated from date)",
        "value_type": "formula",
        "description": "Auto-generated as DDMMYYYY from Invoice Date.",
    },
    "Invoice Date": {
        "default_value": "(from POS Date)",
        "value_type": "date",
        "description": "Direct from POS Date column.",
    },
    "Product Code": {
        "default_value": "NA",
        "value_type": "string",
        "description": "ERP internal product code - set this once.",
    },
    "Quantity": {
        "default_value": "1",
        "value_type": "int",
        "description": "Daily batch = 1 unit always.",
    },
    "Unit Price": {
        "default_value": "(formula)",
        "value_type": "formula",
        "description": "Net Sales less VAT and VAT Adjustment divided by Quantity.",
    },
    "Amount": {
        "default_value": "(formula)",
        "value_type": "formula",
        "description": "Net Sales less VAT and VAT Adjustment.",
    },
    "Term Amount": {
        "default_value": "(formula)",
        "value_type": "formula",
        "description": "VAT + VAT Adjustment.",
    },
    "Customer Code": {
        "default_value": "NA",
        "value_type": "string",
        "description": "ERP customer ID - set this once.",
    },
    "Doc Class": {
        "default_value": "NA",
        "value_type": "string",
        "description": "ERP document class code - set this once.",
    },
    "Currency Code": {
        "default_value": "PHP",
        "value_type": "string",
        "description": "Always PHP for POS transactions.",
    },
    "Remarks": {
        "default_value": "(from POS Remarks)",
        "value_type": "string",
        "description": "Direct from POS Remarks column.",
    },
}

NATIVE_SENTINEL_DEFAULTS = {
    "Invoice Date": "(from POS Date)",
    "Remarks": "(from POS Remarks)",
}

NATIVE_COLUMN_SUMMARY = {
    "SI Number": {
        "source": "POS Date -> DDMMYYYY (for example 05/01/2026 -> 05012026)",
        "status": "computed",
    },
    "Invoice Date": {
        "source": 'input_df["Date"]',
        "status": "mapped",
    },
    "Unit Price": {
        "source": (
            '(input_df["Net Sales"] - '
            'input_df["VAT"] - '
            'input_df["VAT Adjustment"]) / Quantity'
        ),
        "status": "computed",
    },
    "Amount": {
        "source": (
            'input_df["Net Sales"] - '
            'input_df["VAT"] - '
            'input_df["VAT Adjustment"]'
        ),
        "status": "computed",
    },
    "Term Amount": {
        "source": 'input_df["VAT"] + input_df["VAT Adjustment"]',
        "status": "computed",
    },
    "Remarks": {
        "source": 'input_df["Remarks"]',
        "status": "mapped",
    },
}

CONSTANT_COLUMN_STATUS = {
    "Product Code": "defaulted",
    "Quantity": "hardcoded",
    "Customer Code": "defaulted",
    "Doc Class": "defaulted",
    "Currency Code": "hardcoded",
}

SOURCE_ALIASES = {
    "Date": ("Date",),
    "Net Sales": ("Net Sales",),
    "VATABLE Sales": ("VATABLE Sales", "Vatable Sales"),
    "VAT Exempt Sales": ("VAT Exempt Sales", "VAT Exempt"),
    "Discount PWD": ("Discount PWD", "Discount Pwd"),
    "Discount Other": ("Discount Other",),
    "VAT": ("VAT", "Vat"),
    "VAT Adjustment": ("VAT Adjustment", "Vat Adjustment"),
    "Remarks": ("Remarks",),
}


@dataclass
class TransformResult:
    output_df: pd.DataFrame
    row_count: int
    error_count: int
    warnings: list[str]
    errors: list[str]
    column_summary: list[dict]


@dataclass(frozen=True)
class ColumnDefaultConfig:
    column_name: str
    default_value: str
    value_type: str
    description: str


@dataclass(frozen=True)
class DateInfo:
    invoice_date: str
    si_number: str


class DataTransformer:
    """Apply the fixed Mosaic POS to FACT ERP.NG Sale Invoice mapping."""

    def transform(self, input_df: pd.DataFrame) -> TransformResult:
        defaults = _load_column_defaults()
        records: list[dict[str, Any]] = []
        errors: list[str] = []
        warnings = self._default_warnings(defaults)

        for output_row_index, (_, row) in enumerate(input_df.iterrows(), start=1):
            pos_date_info = self._parse_invoice_date_for_row(
                row,
                output_row_index,
                warnings,
            )
            invoice_date = self._invoice_date_value(row, pos_date_info, defaults)
            si_date_info = _try_parse_date_info(invoice_date) or pos_date_info

            records.append(
                {
                    "SI Number": self._column_value(
                        "SI Number",
                        row,
                        pos_date_info,
                        si_date_info,
                        defaults,
                    ),
                    "Invoice Date": invoice_date,
                    "Product Code": self._column_value(
                        "Product Code",
                        row,
                        pos_date_info,
                        si_date_info,
                        defaults,
                    ),
                    "Quantity": self._column_value(
                        "Quantity",
                        row,
                        pos_date_info,
                        si_date_info,
                        defaults,
                    ),
                    "Unit Price": self._column_value(
                        "Unit Price",
                        row,
                        pos_date_info,
                        si_date_info,
                        defaults,
                        errors,
                        output_row_index,
                    ),
                    "Amount": self._column_value(
                        "Amount",
                        row,
                        pos_date_info,
                        si_date_info,
                        defaults,
                    ),
                    "Term Amount": self._column_value(
                        "Term Amount",
                        row,
                        pos_date_info,
                        si_date_info,
                        defaults,
                    ),
                    "Customer Code": self._column_value(
                        "Customer Code",
                        row,
                        pos_date_info,
                        si_date_info,
                        defaults,
                    ),
                    "Doc Class": self._column_value(
                        "Doc Class",
                        row,
                        pos_date_info,
                        si_date_info,
                        defaults,
                    ),
                    "Currency Code": self._column_value(
                        "Currency Code",
                        row,
                        pos_date_info,
                        si_date_info,
                        defaults,
                    ),
                    "Remarks": self._column_value(
                        "Remarks",
                        row,
                        pos_date_info,
                        si_date_info,
                        defaults,
                    ),
                }
            )

        output_df = pd.DataFrame(records, columns=OUTPUT_COLUMNS)

        return TransformResult(
            output_df=output_df,
            row_count=len(output_df),
            error_count=len(errors),
            warnings=_deduplicate_warnings(warnings),
            errors=errors,
            column_summary=self._build_column_summary(defaults),
        )

    def _parse_invoice_date_for_row(
        self,
        row: pd.Series,
        output_row_index: int,
        warnings: list[str],
    ) -> DateInfo:
        value = _source_value(row, "Date")
        parsed_date = _try_parse_date_info(value)
        if parsed_date is None:
            warnings.append(
                f"Row {output_row_index}: Date missing or invalid; used today's date"
            )
            return _today_info()
        return parsed_date

    def _invoice_date_value(
        self,
        row: pd.Series,
        pos_date_info: DateInfo,
        defaults: dict[str, ColumnDefaultConfig],
    ) -> Any:
        column = "Invoice Date"
        config = defaults[column]
        if _uses_native_logic(column, config):
            return pos_date_info.invoice_date
        return _coerce_default_value(
            config.default_value,
            config.value_type,
            FALLBACK_COLUMN_DEFAULTS[column]["default_value"],
        )

    def _column_value(
        self,
        column: str,
        row: pd.Series,
        pos_date_info: DateInfo,
        si_date_info: DateInfo,
        defaults: dict[str, ColumnDefaultConfig],
        errors: list[str] | None = None,
        output_row_index: int | None = None,
    ) -> Any:
        config = defaults[column]
        if not _uses_native_logic(column, config):
            return _coerce_default_value(
                config.default_value,
                config.value_type,
                FALLBACK_COLUMN_DEFAULTS[column]["default_value"],
            )

        if column == "SI Number":
            return si_date_info.si_number
        if column == "Invoice Date":
            return pos_date_info.invoice_date
        if column == "Unit Price":
            net_sales = _numeric_from_row(row, "Net Sales")
            total_vat = (
                _numeric_from_row(row, "VAT")
                + _numeric_from_row(row, "VAT Adjustment")
            )
            calculated_amount = net_sales - total_vat
            qty_value, qty_valid = _try_parse_float(_source_value(row, "Quantity"))
            quantity = qty_value if (qty_valid and qty_value > 0) else 1.0
            return _round_money(calculated_amount / quantity)
        if column == "Amount":
            net_sales = _numeric_from_row(row, "Net Sales")
            total_vat = (
                _numeric_from_row(row, "VAT")
                + _numeric_from_row(row, "VAT Adjustment")
            )
            return _round_money(net_sales - total_vat)
        if column == "Term Amount":
            return _round_money(
                _numeric_from_row(row, "VAT")
                + _numeric_from_row(row, "VAT Adjustment")
            )
        if column == "Remarks":
            return _clean_remarks(_source_value(row, "Remarks"))

        return _coerce_default_value(
            config.default_value,
            config.value_type,
            FALLBACK_COLUMN_DEFAULTS[column]["default_value"],
        )

    def _default_warnings(
        self,
        defaults: dict[str, ColumnDefaultConfig],
    ) -> list[str]:
        warnings: list[str] = []
        for item in self._build_column_summary(defaults):
            if item["status"] != "defaulted":
                continue
            value = defaults[item["column"]].default_value
            warnings.append(
                f"{item['column']} defaulted to {_display_default_value(value)}"
            )
        return warnings

    def _build_column_summary(
        self,
        defaults: dict[str, ColumnDefaultConfig],
    ) -> list[dict]:
        summary: list[dict[str, Any]] = []

        for column in OUTPUT_COLUMNS:
            config = defaults[column]
            if _uses_native_logic(column, config):
                item = {
                    "column": column,
                    "source": NATIVE_COLUMN_SUMMARY[column]["source"],
                    "status": NATIVE_COLUMN_SUMMARY[column]["status"],
                    "value_type": config.value_type,
                    "description": config.description,
                }
                if "required" in NATIVE_COLUMN_SUMMARY[column]:
                    item["required"] = NATIVE_COLUMN_SUMMARY[column]["required"]
                summary.append(item)
                continue

            summary.append(
                {
                    "column": column,
                    "source": (
                        "Admin default -> "
                        f"{_display_default_value(config.default_value)}"
                    ),
                    "status": CONSTANT_COLUMN_STATUS.get(column, "defaulted"),
                    "value_type": config.value_type,
                    "description": config.description,
                    "note": "Overridden in admin settings",
                }
            )

        return summary


def strip_commas_to_float(val) -> float:
    """Remove commas and convert to float. Returns 0.0 if None/NaN/fail."""
    value, _ = _try_parse_float(val)
    return value


def parse_date_flexible(val) -> str:
    """Parse supported date formats to 'DD/MM/YYYY'. Returns today's date if fail."""
    parsed_date = _try_parse_date_info(val)
    if parsed_date is None:
        return _today_info().invoice_date
    return parsed_date.invoice_date


def _load_column_defaults() -> dict[str, ColumnDefaultConfig]:
    defaults = _fallback_defaults()

    try:
        from database import get_column_defaults, get_db

        with closing(get_db()) as conn:
            rows = get_column_defaults(conn)
    except Exception:
        return defaults

    for row in rows:
        column_name = str(row.get("column_name") or "")
        if column_name not in defaults:
            continue

        fallback = FALLBACK_COLUMN_DEFAULTS[column_name]
        value_type = _normalize_value_type(
            row.get("value_type"),
            str(fallback["value_type"]),
        )
        default_value = str(row.get("default_value") or "")
        if (
            column_name == "SI Number"
            and value_type == "string"
            and default_value == "NA"
        ):
            value_type = str(fallback["value_type"])
            default_value = str(fallback["default_value"])

        defaults[column_name] = ColumnDefaultConfig(
            column_name=column_name,
            default_value=default_value,
            value_type=value_type,
            description=str(row.get("description") or fallback["description"]),
        )

    return defaults


def _fallback_defaults() -> dict[str, ColumnDefaultConfig]:
    return {
        column_name: ColumnDefaultConfig(
            column_name=column_name,
            default_value=str(item["default_value"]),
            value_type=str(item["value_type"]),
            description=str(item["description"]),
        )
        for column_name, item in FALLBACK_COLUMN_DEFAULTS.items()
    }


def _normalize_value_type(value: Any, fallback: str) -> str:
    value_type = str(value or "").strip().lower()
    if value_type in {"string", "int", "float", "date", "formula"}:
        return value_type
    return fallback


def _uses_native_logic(column: str, config: ColumnDefaultConfig) -> bool:
    if column not in NATIVE_COLUMN_SUMMARY:
        return False
    if config.value_type == "formula":
        return True
    return (
        column in NATIVE_SENTINEL_DEFAULTS
        and config.default_value == NATIVE_SENTINEL_DEFAULTS[column]
    )


def _coerce_default_value(value: Any, value_type: str, fallback: Any) -> Any:
    if value_type == "int":
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return _coerce_default_value(fallback, value_type, 0)
    if value_type == "float":
        try:
            return float(str(value).strip())
        except (TypeError, ValueError):
            return _coerce_default_value(fallback, value_type, 0.0)
    if value_type == "date":
        parsed_date = _try_parse_date_info(value)
        if parsed_date is not None:
            return parsed_date.invoice_date
        return "" if value is None else str(value)
    return "" if value is None else str(value)


def _display_default_value(value: Any) -> str:
    return str(value)


def _numeric_from_row(row: pd.Series, source_column: str) -> float:
    value = _source_value(row, source_column)
    parsed_value, _ = _try_parse_float(value)
    return parsed_value


def _round_money(value: float) -> float:
    return round(value, 2)


def _source_value(row: pd.Series, source_column: str) -> Any:
    aliases = SOURCE_ALIASES.get(source_column, (source_column,))
    for alias in aliases:
        if alias in row:
            return row.get(alias)

    normalized_aliases = {alias.strip().lower() for alias in aliases}
    for column in row.index:
        if str(column).strip().lower() in normalized_aliases:
            return row.get(column)

    return None


def _try_parse_float(val: Any) -> tuple[float, bool]:
    if _is_missing(val):
        return 0.0, False

    cleaned_value = str(val).strip().replace(",", "")
    if cleaned_value == "":
        return 0.0, False

    try:
        return float(cleaned_value), True
    except (TypeError, ValueError):
        return 0.0, False


def _try_parse_date_info(val: Any) -> DateInfo | None:
    if _is_missing(val):
        return None

    if isinstance(val, pd.Timestamp):
        return _date_info_from_datetime(val.to_pydatetime())

    if isinstance(val, datetime):
        return _date_info_from_datetime(val)

    text_value = str(val).strip()
    if text_value == "":
        return None

    parsed_from_parts = _try_parse_date_parts(text_value)
    if parsed_from_parts is not None:
        return parsed_from_parts

    try:
        with py_warnings.catch_warnings():
            py_warnings.simplefilter("ignore", UserWarning)
            parsed = pd.to_datetime(text_value, dayfirst=True, errors="raise")
        if _is_missing(parsed):
            return None
        return _date_info_from_datetime(parsed.to_pydatetime())
    except (TypeError, ValueError):
        return None


def _try_parse_date_parts(text_value: str) -> DateInfo | None:
    normalized = text_value.replace("-", "/")
    parts = normalized.split("/")
    if len(parts) != 3 or not all(part.strip().isdigit() for part in parts):
        return None

    first, second, third = [int(part.strip()) for part in parts]
    try:
        if len(parts[0].strip()) == 4:
            return _date_info_from_datetime(datetime(first, second, third))

        year = third + 2000 if third < 100 else third
        return _date_info_from_datetime(datetime(year, second, first))
    except ValueError:
        return None


def _date_info_from_datetime(value: datetime) -> DateInfo:
    return DateInfo(
        invoice_date=value.strftime("%d/%m/%Y"),
        si_number=value.strftime("%d%m%Y"),
    )


def _clean_remarks(value: Any) -> str:
    if _is_missing(value):
        return ""
    return str(value).strip()


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def _deduplicate_warnings(warnings: list[str]) -> list[str]:
    counts: dict[str, int] = {}
    ordered: list[str] = []

    for warning in warnings:
        if warning not in counts:
            ordered.append(warning)
            counts[warning] = 0
        counts[warning] += 1

    return [
        f"{warning} ({counts[warning]} rows)" if counts[warning] > 1 else warning
        for warning in ordered
    ]


def _today_info() -> DateInfo:
    return _date_info_from_datetime(datetime.today())


def _resolve_sample_path() -> Path:
    project_root_path = Path("uploads/input.xlsx")
    if project_root_path.exists():
        return project_root_path
    return Path(__file__).resolve().parents[2] / "uploads" / "input.xlsx"


if __name__ == "__main__":
    try:
        from services.file_reader import FileReader
    except ModuleNotFoundError:
        from file_reader import FileReader

    reader = FileReader()
    read_result = reader.read(str(_resolve_sample_path()))
    transform_result = DataTransformer().transform(read_result["dataframe"])

    print("output_df:")
    print(transform_result.output_df)
    print("column_summary:")
    print(transform_result.column_summary)
    print("warnings:")
    print(transform_result.warnings)
    print("errors:")
    print(transform_result.errors)
