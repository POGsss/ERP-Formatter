from datetime import date, datetime
from math import isfinite
from pathlib import Path
from typing import Any

import pandas as pd

try:
    from .transformer import TransformResult
except ImportError:
    try:
        from services.transformer import TransformResult
    except ModuleNotFoundError:
        from transformer import TransformResult


OUTPUT_COLUMNS = [
    "SI Number",
    "Invoice Date",
    "Product Code",
    "Quantity",
    "Amount",
    "Sales Discount",
    "VAT Payable",
    "Customer Code",
    "Doc Class",
    "Currency Code",
    "Remarks",
]

INPUT_COLUMNS = [
    "Business Date",
    "Store",
    "Payment Method",
    "Gross Sale",
    "VAT Amount",
    "Gross Sale w/o VAT",
    "Discount Amount",
    "Net Sale",
]

PAYMENT_METHOD_MAPPING = {
    "Card(DEBIT)": {"customer_code": 72, "letter": "M"},
    "Card(MASTER)": {"customer_code": 72, "letter": "M"},
    "cash": {"customer_code": 68, "letter": "C"},
    "Other( E-Wallet )": {"customer_code": 72, "letter": "M"},
    "Other( FoodPanda )": {"customer_code": 70, "letter": "F"},
    "Other( GrabFood )": {"customer_code": 71, "letter": "G"},
    "Other( Pickup Coffee App )": {"customer_code": 69, "letter": "B"},
}

_NORMALIZED_PAYMENT_METHOD_MAPPING = {
    "".join(payment_method.split()).casefold(): details
    for payment_method, details in PAYMENT_METHOD_MAPPING.items()
}

COLUMN_SUMMARY = [
    {
        "column": "SI Number",
        "source": 'RR1 + payment-method letter + Business Date "MMDD"',
        "status": "computed",
    },
    {
        "column": "Invoice Date",
        "source": 'input_df["Business Date"] (fill-down)',
        "status": "mapped",
    },
    {
        "column": "Product Code",
        "source": "001",
        "status": "hardcoded",
    },
    {
        "column": "Quantity",
        "source": "0",
        "status": "hardcoded",
    },
    {
        "column": "Amount",
        "source": 'input_df["Gross Sale w/o VAT"]',
        "status": "mapped",
    },
    {
        "column": "Sales Discount",
        "source": 'input_df["Discount Amount"]',
        "status": "mapped",
    },
    {
        "column": "VAT Payable",
        "source": 'input_df["VAT Amount"]',
        "status": "mapped",
    },
    {
        "column": "Customer Code",
        "source": "Payment Method mapping",
        "status": "computed",
    },
    {
        "column": "Doc Class",
        "source": "RR1",
        "status": "hardcoded",
    },
    {
        "column": "Currency Code",
        "source": "PHP",
        "status": "hardcoded",
    },
    {
        "column": "Remarks",
        "source": "Empty string",
        "status": "hardcoded",
    },
]


class NewPosTransformer:
    """Transform a New POS payment breakdown into per-payment ERP rows."""

    def transform(self, input_df: pd.DataFrame) -> TransformResult:
        source_columns = _source_column_lookup(input_df)
        business_dates = _fill_down(
            _source_series(input_df, source_columns, "Business Date")
        )
        stores = _fill_down(_source_series(input_df, source_columns, "Store"))
        payment_methods = _source_series(
            input_df,
            source_columns,
            "Payment Method",
        )

        records: list[dict[str, Any]] = []
        warnings: list[str] = []
        errors: list[str] = []

        for row_position, (_, row) in enumerate(input_df.iterrows(), start=1):
            store = stores.iloc[row_position - 1]
            payment_method = payment_methods.iloc[row_position - 1]

            if _contains_total(store) or _is_missing(payment_method):
                continue

            business_date = _parse_business_date(
                business_dates.iloc[row_position - 1]
            )
            if business_date is None:
                business_date = _today()
                warnings.append(
                    f"Row {row_position}: Business Date missing or invalid; "
                    "used today's date"
                )

            payment_details = _payment_method_details(payment_method)
            if payment_details is None:
                customer_code = 0
                customer_letter = "X"
                warnings.append(
                    f"Row {row_position}: Payment Method "
                    f"{str(payment_method).strip()!r} is unknown; "
                    "used Customer Code 0 and letter X"
                )
            else:
                customer_code = payment_details["customer_code"]
                customer_letter = payment_details["letter"]

            amount = _money_from_row(
                row,
                source_columns,
                "Gross Sale w/o VAT",
                row_position,
                warnings,
            )
            sales_discount = _money_from_row(
                row,
                source_columns,
                "Discount Amount",
                row_position,
                warnings,
            )
            vat_payable = _money_from_row(
                row,
                source_columns,
                "VAT Amount",
                row_position,
                warnings,
            )

            records.append(
                {
                    "SI Number": (
                        f"RR1{customer_letter}{business_date.strftime('%m%d')}"
                    ),
                    "Invoice Date": business_date,
                    "Product Code": "001",
                    "Quantity": 0,
                    "Amount": amount,
                    "Sales Discount": sales_discount,
                    "VAT Payable": vat_payable,
                    "Customer Code": customer_code,
                    "Doc Class": "RR1",
                    "Currency Code": "PHP",
                    "Remarks": "",
                }
            )

        output_df = pd.DataFrame(records, columns=OUTPUT_COLUMNS)
        if not output_df.empty:
            output_df["Invoice Date"] = pd.to_datetime(output_df["Invoice Date"])

        return TransformResult(
            output_df=output_df,
            row_count=len(output_df),
            error_count=len(errors),
            warnings=warnings,
            errors=errors,
            column_summary=[dict(item) for item in COLUMN_SUMMARY],
        )


def _source_column_lookup(input_df: pd.DataFrame) -> dict[str, Any]:
    lookup: dict[str, Any] = {}
    for column in input_df.columns:
        normalized = _normalize_header(column)
        if normalized not in lookup:
            lookup[normalized] = column
    return lookup


def _source_series(
    input_df: pd.DataFrame,
    source_columns: dict[str, Any],
    source_column: str,
) -> pd.Series:
    actual_column = source_columns.get(_normalize_header(source_column))
    if actual_column is None:
        return pd.Series([None] * len(input_df), index=input_df.index, dtype=object)
    return input_df[actual_column]


def _source_value(
    row: pd.Series,
    source_columns: dict[str, Any],
    source_column: str,
) -> Any:
    actual_column = source_columns.get(_normalize_header(source_column))
    if actual_column is None:
        return None
    return row.get(actual_column)


def _fill_down(series: pd.Series) -> pd.Series:
    values = series.astype(object).map(
        lambda value: None if _is_missing(value) else value
    )
    return values.ffill()


def _normalize_header(value: Any) -> str:
    return " ".join(str(value).split()).casefold()


def _normalize_payment_method(value: Any) -> str:
    return "".join(str(value).split()).casefold()


def _payment_method_details(payment_method: Any) -> dict[str, int | str] | None:
    return _NORMALIZED_PAYMENT_METHOD_MAPPING.get(
        _normalize_payment_method(payment_method)
    )


def _contains_total(store: Any) -> bool:
    return not _is_missing(store) and "total" in str(store).casefold()


def _money_from_row(
    row: pd.Series,
    source_columns: dict[str, Any],
    source_column: str,
    row_position: int,
    warnings: list[str],
) -> float:
    original_value = _source_value(row, source_columns, source_column)
    value, is_valid = _try_parse_money(original_value)
    if not is_valid:
        warnings.append(
            f"Row {row_position}: {source_column} missing or non-numeric; used 0"
        )
    return value


def _try_parse_money(value: Any) -> tuple[float, bool]:
    if _is_missing(value):
        return 0.0, False

    text_value = (
        str(value)
        .replace("₱", "")
        .replace("â‚±", "")
        .replace(",", "")
    )
    text_value = "".join(text_value.split())
    if text_value == "":
        return 0.0, False

    try:
        parsed_value = float(text_value)
    except (TypeError, ValueError):
        return 0.0, False

    if not isfinite(parsed_value):
        return 0.0, False
    return parsed_value, True


def _parse_business_date(value: Any) -> datetime | None:
    if _is_missing(value):
        return None

    if isinstance(value, pd.Timestamp):
        return datetime(value.year, value.month, value.day)
    if isinstance(value, datetime):
        return datetime(value.year, value.month, value.day)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)

    text_value = str(value).strip()
    try:
        return datetime.strptime(text_value, "%m/%d/%Y")
    except (TypeError, ValueError):
        return None


def _today() -> datetime:
    value = datetime.today()
    return datetime(value.year, value.month, value.day)


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def _resolve_sample_path() -> Path:
    project_root_path = Path("uploads/input.xlsx")
    if project_root_path.exists():
        return project_root_path
    return Path(__file__).resolve().parents[2] / "uploads" / "input.xlsx"


if __name__ == "__main__":
    try:
        from .file_reader import FileReader
    except ImportError:
        try:
            from services.file_reader import FileReader
        except ModuleNotFoundError:
            from file_reader import FileReader

    reader = FileReader()
    read_result = reader.read(str(_resolve_sample_path()))
    transform_result = NewPosTransformer().transform(read_result["dataframe"])

    print("output_df:")
    print(transform_result.output_df)
    print("column_summary:")
    print(transform_result.column_summary)
    print("warnings:")
    print(transform_result.warnings)
    print("errors:")
    print(transform_result.errors)
