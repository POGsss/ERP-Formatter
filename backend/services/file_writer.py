from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

try:
    from .transformer import TransformResult
except ImportError:
    try:
        from services.transformer import TransformResult
    except ModuleNotFoundError:
        from transformer import TransformResult


MAIN_SHEET_NAME = "ERP Import"
SUMMARY_SHEET_NAME = "Column Summary"

NUMBER_COLUMNS = {
    "Quantity",
    "Price",
    "Total Amount",
    "Vat Payable",
    "Class",
    "Active",
}
DATE_COLUMNS = {"Date", "Order Date"}

HEADER_FILL = PatternFill(fill_type="solid", fgColor="2E75B6")
HEADER_FONT = Font(bold=True, color="FFFFFF", size=11)
HEADER_ALIGNMENT = Alignment(horizontal="center")

WHITE_FILL = PatternFill(fill_type="solid", fgColor="FFFFFF")
GRAY_FILL = PatternFill(fill_type="solid", fgColor="F2F2F2")
DEFAULTED_FILL = PatternFill(fill_type="solid", fgColor="FFFACD")

SUMMARY_STATUS_FILLS = {
    "mapped": PatternFill(fill_type="solid", fgColor="C6EFCE"),
    "hardcoded": PatternFill(fill_type="solid", fgColor="BDD7EE"),
    "defaulted": PatternFill(fill_type="solid", fgColor="FFEB9C"),
}
ERROR_FILL = PatternFill(fill_type="solid", fgColor="FFC7CE")


class FileWriter:
    def write(
        self,
        result: TransformResult,
        output_dir: str,
        template_name: str = "erp-output",
    ) -> dict[str, str | None]:
        """
        Writes the output Excel file.
        Returns:
        {
          "output_path": str,
          "output_filename": str,
          "summary_path": str | None
        }
        """
        del template_name

        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_filename = f"erp_output_{timestamp}.xlsx"
        full_output_path = output_path / output_filename

        workbook = Workbook()
        main_sheet = workbook.active
        main_sheet.title = MAIN_SHEET_NAME

        defaulted_columns = _columns_by_status(result.column_summary, "defaulted")
        self._write_main_sheet(main_sheet, result.output_df, defaulted_columns)
        self._write_column_summary_sheet(workbook, result.column_summary)

        workbook.save(full_output_path)

        error_report_path = None
        if result.error_count > 0:
            error_report_path = output_path / f"erp_errors_{timestamp}.xlsx"
            self._write_error_report(result.errors, error_report_path)

        return {
            "output_path": str(full_output_path),
            "output_filename": output_filename,
            "summary_path": str(error_report_path) if error_report_path else None,
        }

    def _write_main_sheet(
        self,
        sheet,
        dataframe: pd.DataFrame,
        defaulted_columns: set[str],
    ) -> None:
        sheet.sheet_view.showGridLines = False
        sheet.freeze_panes = "A2"

        for column_index, column_name in enumerate(dataframe.columns, start=1):
            cell = sheet.cell(row=1, column=column_index, value=column_name)
            cell.font = HEADER_FONT
            cell.fill = HEADER_FILL
            cell.alignment = HEADER_ALIGNMENT

        for row_index, row in enumerate(dataframe.itertuples(index=False), start=2):
            row_fill = WHITE_FILL if row_index % 2 == 0 else GRAY_FILL
            for column_index, value in enumerate(row, start=1):
                column_name = str(dataframe.columns[column_index - 1])
                cell = sheet.cell(
                    row=row_index,
                    column=column_index,
                    value=_excel_value(value, column_name),
                )
                cell.fill = (
                    DEFAULTED_FILL if column_name in defaulted_columns else row_fill
                )

                if column_name in NUMBER_COLUMNS:
                    cell.number_format = "#,##0.00"
                elif column_name in DATE_COLUMNS:
                    cell.number_format = "@"

        _auto_fit_columns(sheet)

    def _write_column_summary_sheet(
        self,
        workbook: Workbook,
        column_summary: list[dict],
    ) -> None:
        sheet = workbook.create_sheet(SUMMARY_SHEET_NAME)
        sheet.sheet_view.showGridLines = False
        sheet.freeze_panes = "A2"

        headers = ["ERP Column", "Source", "Status", "Notes"]
        for column_index, header in enumerate(headers, start=1):
            cell = sheet.cell(row=1, column=column_index, value=header)
            cell.font = HEADER_FONT
            cell.fill = HEADER_FILL
            cell.alignment = HEADER_ALIGNMENT

        for row_index, item in enumerate(column_summary, start=2):
            status = str(item.get("status", "")).lower()
            source = str(item.get("source", ""))
            values = [
                item.get("column", ""),
                source,
                status,
                _summary_notes(item),
            ]
            fill = SUMMARY_STATUS_FILLS.get(status, WHITE_FILL)

            for column_index, value in enumerate(values, start=1):
                cell = sheet.cell(row=row_index, column=column_index, value=value)
                cell.fill = fill

        _auto_fit_columns(sheet)

    def _write_error_report(self, errors: list[Any], output_path: Path) -> None:
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Errors"
        sheet.sheet_view.showGridLines = False
        sheet.freeze_panes = "A2"

        headers = [
            "Row Number",
            "ERP Column",
            "Error Message",
            "Original POS Value",
        ]
        for column_index, header in enumerate(headers, start=1):
            cell = sheet.cell(row=1, column=column_index, value=header)
            cell.font = HEADER_FONT
            cell.fill = ERROR_FILL
            cell.alignment = HEADER_ALIGNMENT

        for row_index, error in enumerate(errors, start=2):
            parsed_error = _parse_error(error)
            values = [
                parsed_error["row_number"],
                parsed_error["erp_column"],
                parsed_error["error_message"],
                parsed_error["original_pos_value"],
            ]
            for column_index, value in enumerate(values, start=1):
                cell = sheet.cell(row=row_index, column=column_index, value=value)
                cell.fill = ERROR_FILL

        _auto_fit_columns(sheet)
        workbook.save(output_path)


def _columns_by_status(column_summary: list[dict], status: str) -> set[str]:
    return {
        str(item.get("column", ""))
        for item in column_summary
        if str(item.get("status", "")).lower() == status
    }


def _excel_value(value: Any, column_name: str) -> Any:
    if column_name in DATE_COLUMNS:
        return "" if _is_missing(value) else str(value)
    if _is_missing(value):
        return ""
    return value


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def _summary_notes(item: dict) -> str:
    status = str(item.get("status", "")).lower()
    source = str(item.get("source", ""))

    if status == "mapped":
        return f"Mapped from POS: {_extract_input_column(source)}"
    if status == "hardcoded":
        return f"Hardcoded value: {_extract_value(source)}"
    if status == "defaulted":
        return f"No POS source - defaulted to {_extract_value(source)}"
    return source


def _extract_input_column(source: str) -> str:
    if '["' in source and '"]' in source:
        return source.split('["', 1)[1].split('"]', 1)[0]
    return source


def _extract_value(source: str) -> str:
    for separator in ("->", "Hardcoded"):
        if separator in source:
            return source.split(separator, 1)[1].strip()
    return source


def _parse_error(error: Any) -> dict[str, Any]:
    if isinstance(error, dict):
        return {
            "row_number": error.get("row_number") or error.get("row") or "",
            "erp_column": error.get("erp_column") or error.get("column") or "",
            "error_message": error.get("error_message") or error.get("message") or "",
            "original_pos_value": error.get("original_pos_value")
            or error.get("original_value")
            or "",
        }

    message = str(error)
    row_number = ""
    erp_column = ""

    if message.startswith("Row "):
        row_part, _, rest = message.partition(":")
        row_number = row_part.replace("Row", "").strip()
        message = rest.strip() or message

    if " set to " in message:
        before_default, _, _ = message.partition(" set to ")
        _, _, possible_column = before_default.partition(";")
        erp_column = possible_column.strip()

    return {
        "row_number": row_number,
        "erp_column": erp_column,
        "error_message": str(error),
        "original_pos_value": "",
    }


def _auto_fit_columns(sheet) -> None:
    for column_cells in sheet.columns:
        column_letter = get_column_letter(column_cells[0].column)
        max_length = 0
        for cell in column_cells:
            if cell.value is None:
                continue
            max_length = max(max_length, len(str(cell.value)))

        sheet.column_dimensions[column_letter].width = min(max(max_length + 4, 10), 45)


def _resolve_project_path(relative_path: str) -> Path:
    project_root_path = Path(relative_path)
    if project_root_path.exists():
        return project_root_path
    return Path(__file__).resolve().parents[2] / relative_path


if __name__ == "__main__":
    try:
        from .file_reader import FileReader
        from .transformer import DataTransformer
    except ImportError:
        try:
            from services.file_reader import FileReader
            from services.transformer import DataTransformer
        except ModuleNotFoundError:
            from file_reader import FileReader
            from transformer import DataTransformer

    reader = FileReader()
    read_result = reader.read(str(_resolve_project_path("uploads/input.xlsx")))
    transform_result = DataTransformer().transform(read_result["dataframe"])

    write_result = FileWriter().write(
        transform_result,
        str(_resolve_project_path("outputs")),
    )

    print("output_path:", write_result["output_path"])
    print("output_filename:", write_result["output_filename"])
    print("summary_path:", write_result["summary_path"])
