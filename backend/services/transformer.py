from contextlib import closing
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd


OUTPUT_COLUMNS = [
    "Customer",
    "Product",
    "Quantity",
    "Price",
    "Date",
    "Doc Class",
    "Customer Code",
    "Product Name",
    "Account Type",
    "Total Amount",
    "Vat Payable",
    "Bank Code",
    "Remarks",
    "SI Number",
    "Order Number",
    "Class",
    "Order Date",
    "Active",
]

FALLBACK_COLUMN_DEFAULTS = {
    "Customer": {"default_value": "NA", "value_type": "string"},
    "Product": {"default_value": "NA", "value_type": "string"},
    "Doc Class": {"default_value": "NA", "value_type": "string"},
    "Customer Code": {"default_value": "NA", "value_type": "string"},
    "Product Name": {"default_value": "NA", "value_type": "string"},
    "Account Type": {"default_value": "NA", "value_type": "string"},
    "Bank Code": {"default_value": "NA", "value_type": "string"},
    "SI Number": {"default_value": "NA", "value_type": "string"},
    "Order Number": {"default_value": "NA", "value_type": "string"},
    "Class": {"default_value": "0", "value_type": "int"},
    "Order Date": {"default_value": "NA", "value_type": "string"},
    "Active": {"default_value": "1", "value_type": "int"},
}


@dataclass
class TransformResult:
    output_df: pd.DataFrame
    row_count: int
    error_count: int
    warnings: list[str]
    errors: list[str]
    column_summary: list[dict]


class DataTransformer:
    """Apply the fixed Mosaic POS to ERP mapping."""

    def transform(self, input_df: pd.DataFrame) -> TransformResult:
        defaults = _load_column_defaults()
        records: list[dict[str, Any]] = []
        warnings = [
            f"{column_name} defaulted to {_display_default_value(default_value)}"
            for column_name, default_value in defaults.items()
        ]
        errors: list[str] = []

        for output_row_index, (_, row) in enumerate(input_df.iterrows(), start=1):
            record = self._default_record(defaults)

            record["Date"] = self._parse_date_for_row(row, output_row_index, warnings)
            record["Total Amount"] = self._parse_float_for_row(
                row,
                source_column="Gross Sales",
                output_column="Total Amount",
                output_row_index=output_row_index,
                errors=errors,
            )
            record["Vat Payable"] = self._parse_float_for_row(
                row,
                source_column="VAT",
                output_column="Vat Payable",
                output_row_index=output_row_index,
                errors=errors,
            )
            record["Price"] = self._parse_float_for_row(
                row,
                source_column="Net Sales",
                output_column="Price",
                output_row_index=output_row_index,
                errors=errors,
            )
            record["Remarks"] = self._clean_remarks(row.get("Remarks", ""))

            records.append(record)

        output_df = pd.DataFrame(records, columns=OUTPUT_COLUMNS)

        return TransformResult(
            output_df=output_df,
            row_count=len(output_df),
            error_count=len(errors),
            warnings=_deduplicate_warnings(warnings),
            errors=errors,
            column_summary=self._build_column_summary(defaults),
        )

    def _default_record(self, defaults: dict[str, Any]) -> dict[str, Any]:
        return {
            "Customer": defaults["Customer"],
            "Product": defaults["Product"],
            "Quantity": 1,
            "Price": 0.0,
            "Date": _today_string(),
            "Doc Class": defaults["Doc Class"],
            "Customer Code": defaults["Customer Code"],
            "Product Name": defaults["Product Name"],
            "Account Type": defaults["Account Type"],
            "Total Amount": 0.0,
            "Vat Payable": 0.0,
            "Bank Code": defaults["Bank Code"],
            "Remarks": "",
            "SI Number": defaults["SI Number"],
            "Order Number": defaults["Order Number"],
            "Class": defaults["Class"],
            "Order Date": defaults["Order Date"],
            "Active": defaults["Active"],
        }

    def _parse_date_for_row(
        self,
        row: pd.Series,
        output_row_index: int,
        warnings: list[str],
    ) -> str:
        if "Date" not in row:
            warnings.append("Date missing; used today's date")
            return _today_string()

        parsed_date = _try_parse_date(row["Date"])
        if parsed_date is None:
            warnings.append("Date parse failed; used today's date")
            return _today_string()

        return parsed_date

    def _parse_float_for_row(
        self,
        row: pd.Series,
        source_column: str,
        output_column: str,
        output_row_index: int,
        errors: list[str],
    ) -> float:
        if source_column not in row:
            errors.append(
                f"Row {output_row_index}: Missing {source_column}; "
                f"{output_column} set to 0.0"
            )
            return 0.0

        value, is_valid = _try_parse_float(row[source_column])
        if not is_valid:
            errors.append(
                f"Row {output_row_index}: {source_column} is empty or invalid; "
                f"{output_column} set to 0.0"
            )

        return value

    def _clean_remarks(self, value: Any) -> str:
        if _is_missing(value):
            return ""
        return str(value).strip()

    def _build_column_summary(self, defaults: dict[str, Any]) -> list[dict]:
        summary_by_column = {
            "Customer": {
                "source": f"None -> {_display_default_value(defaults['Customer'])}",
                "status": "defaulted",
            },
            "Product": {
                "source": f"None -> {_display_default_value(defaults['Product'])}",
                "status": "defaulted",
            },
            "Quantity": {"source": "Hardcoded 1", "status": "hardcoded"},
            "Price": {"source": 'input_df["Net Sales"]', "status": "mapped"},
            "Date": {"source": 'input_df["Date"]', "status": "mapped"},
            "Doc Class": {
                "source": f"None -> {_display_default_value(defaults['Doc Class'])}",
                "status": "defaulted",
            },
            "Customer Code": {
                "source": (
                    "None -> "
                    f"{_display_default_value(defaults['Customer Code'])}"
                ),
                "status": "defaulted",
            },
            "Product Name": {
                "source": (
                    "None -> "
                    f"{_display_default_value(defaults['Product Name'])}"
                ),
                "status": "defaulted",
            },
            "Account Type": {
                "source": (
                    "None -> "
                    f"{_display_default_value(defaults['Account Type'])}"
                ),
                "status": "defaulted",
            },
            "Total Amount": {"source": 'input_df["Gross Sales"]', "status": "mapped"},
            "Vat Payable": {"source": 'input_df["VAT"]', "status": "mapped"},
            "Bank Code": {
                "source": f"None -> {_display_default_value(defaults['Bank Code'])}",
                "status": "defaulted",
            },
            "Remarks": {"source": 'input_df["Remarks"]', "status": "mapped"},
            "SI Number": {
                "source": f"None -> {_display_default_value(defaults['SI Number'])}",
                "status": "defaulted",
            },
            "Order Number": {
                "source": (
                    "None -> "
                    f"{_display_default_value(defaults['Order Number'])}"
                ),
                "status": "defaulted",
            },
            "Class": {
                "source": f"None -> {_display_default_value(defaults['Class'])}",
                "status": "defaulted",
            },
            "Order Date": {
                "source": f"None -> {_display_default_value(defaults['Order Date'])}",
                "status": "defaulted",
            },
            "Active": {
                "source": f"None -> {_display_default_value(defaults['Active'])}",
                "status": "defaulted",
            },
        }

        return [
            {
                "column": column,
                "source": summary_by_column[column]["source"],
                "status": summary_by_column[column]["status"],
            }
            for column in OUTPUT_COLUMNS
        ]


def strip_commas_to_float(val) -> float:
    """Removes commas, converts to float. Returns 0.0 if None/NaN/fail."""
    value, _ = _try_parse_float(val)
    return value


def parse_date_flexible(val) -> str:
    """Parses supported date formats to 'MM/DD/YYYY'. Returns today's date if fail."""
    parsed_date = _try_parse_date(val)
    if parsed_date is None:
        return _today_string()
    return parsed_date


def _load_column_defaults() -> dict[str, Any]:
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

        value_type = str(
            row.get("value_type")
            or FALLBACK_COLUMN_DEFAULTS[column_name]["value_type"]
        )
        defaults[column_name] = _coerce_default_value(
            row.get("default_value"),
            value_type,
            defaults[column_name],
        )

    return defaults


def _fallback_defaults() -> dict[str, Any]:
    return {
        column_name: _coerce_default_value(
            item["default_value"],
            item["value_type"],
            item["default_value"],
        )
        for column_name, item in FALLBACK_COLUMN_DEFAULTS.items()
    }


def _coerce_default_value(value: Any, value_type: str, fallback: Any) -> Any:
    if value_type == "int":
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return fallback
    if value_type == "float":
        try:
            return float(str(value).strip())
        except (TypeError, ValueError):
            return fallback
    return "" if value is None else str(value)


def _display_default_value(value: Any) -> str:
    return str(value)


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


def _try_parse_date(val: Any) -> str | None:
    if _is_missing(val):
        return None

    if isinstance(val, pd.Timestamp):
        return val.strftime("%m/%d/%Y")

    if isinstance(val, datetime):
        return val.strftime("%m/%d/%Y")

    text_value = str(val).strip()
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


def _today_string() -> str:
    return datetime.today().strftime("%m/%d/%Y")


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
