from pathlib import Path
from typing import Any

import pandas as pd
from pandas.errors import EmptyDataError


class FileReader:
    """Read POS export files into a clean DataFrame plus file metadata."""

    SUPPORTED_FILE_TYPES = {"xlsx", "xls", "csv"}
    MAX_HEADER_SCAN_ROW = 20

    def read(self, filepath: str) -> dict[str, Any]:
        """
        Returns:
        {
          "dataframe": pd.DataFrame,
          "header_row_index": int,
          "metadata": dict,
          "row_count": int,
          "column_names": list[str],
          "file_type": str
        }
        """
        path = Path(filepath)
        if not path.is_file():
            raise FileNotFoundError(filepath)

        file_type = path.suffix.lower().lstrip(".")
        if file_type not in self.SUPPORTED_FILE_TYPES:
            raise ValueError(f"Unsupported file type: {path.suffix.lower()}")

        raw_dataframe = self._read_raw(path, file_type)
        if raw_dataframe.empty or raw_dataframe.shape[1] == 0:
            raise ValueError("File is empty or has no readable data")

        header_row_index = self._detect_header_row(raw_dataframe)
        metadata = (
            self._parse_metadata(raw_dataframe, header_row_index)
            if header_row_index > 0
            else {}
        )
        dataframe = self._build_dataframe(raw_dataframe, header_row_index)
        column_names = list(dataframe.columns)

        return {
            "dataframe": dataframe,
            "header_row_index": header_row_index,
            "metadata": metadata,
            "row_count": len(dataframe),
            "column_names": column_names,
            "file_type": file_type,
        }

    def _read_raw(self, path: Path, file_type: str) -> pd.DataFrame:
        try:
            if file_type == "xlsx":
                return pd.read_excel(
                    path,
                    header=None,
                    engine="openpyxl",
                    dtype=object,
                    keep_default_na=False,
                )
            if file_type == "xls":
                return pd.read_excel(
                    path,
                    header=None,
                    engine="xlrd",
                    dtype=object,
                    keep_default_na=False,
                )
            return pd.read_csv(path, header=None, dtype=object, keep_default_na=False)
        except EmptyDataError as exc:
            raise ValueError("File is empty or has no readable data") from exc

    def _detect_header_row(self, raw_dataframe: pd.DataFrame) -> int:
        total_rows, total_columns = raw_dataframe.shape
        if total_rows < 2 or total_columns == 0:
            return 0

        last_candidate = min(self.MAX_HEADER_SCAN_ROW, total_rows - 2)
        for row_index in range(last_candidate + 1):
            header_fill = self._non_empty_string_ratio(
                raw_dataframe.iloc[row_index],
                total_columns,
            )
            next_row_fill = self._non_empty_ratio(
                raw_dataframe.iloc[row_index + 1],
                total_columns,
            )
            if header_fill >= 0.7 and next_row_fill >= 0.5:
                return row_index

        return 0

    def _parse_metadata(
        self,
        raw_dataframe: pd.DataFrame,
        header_row_index: int,
    ) -> dict[str, Any]:
        metadata: dict[str, Any] = {}

        for row_index in range(header_row_index):
            row = raw_dataframe.iloc[row_index]
            key = row.iloc[0] if len(row) > 0 else ""
            value = row.iloc[1] if len(row) > 1 else ""

            if self._is_empty(key) and self._is_empty(value):
                continue
            if self._is_empty(key):
                continue

            metadata_key = str(key).strip().rstrip(":").strip()
            metadata[metadata_key] = self._clean_metadata_value(value)

        return metadata

    def _build_dataframe(
        self,
        raw_dataframe: pd.DataFrame,
        header_row_index: int,
    ) -> pd.DataFrame:
        column_names = [
            self._clean_column_name(column)
            for column in raw_dataframe.iloc[header_row_index].tolist()
        ]
        dataframe = raw_dataframe.iloc[header_row_index + 1 :].copy()
        dataframe.columns = column_names
        dataframe = dataframe.reset_index(drop=True)
        return dataframe

    def _non_empty_string_ratio(self, row: pd.Series, total_columns: int) -> float:
        non_empty_strings = sum(
            isinstance(cell, str) and not self._is_empty(cell)
            for cell in row
        )
        return non_empty_strings / total_columns

    def _non_empty_ratio(self, row: pd.Series, total_columns: int) -> float:
        non_empty_cells = sum(not self._is_empty(cell) for cell in row)
        return non_empty_cells / total_columns

    def _is_empty(self, cell: Any) -> bool:
        if cell is None:
            return True
        if isinstance(cell, str):
            return cell.strip() == ""
        try:
            return bool(pd.isna(cell))
        except (TypeError, ValueError):
            return False

    def _clean_column_name(self, column: Any) -> str:
        if self._is_empty(column):
            return ""
        return str(column).strip()

    def _clean_metadata_value(self, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


if __name__ == "__main__":
    reader = FileReader()

    input_result = reader.read("uploads/input.xlsx")
    print("input.xlsx")
    print("header_row_index:", input_result["header_row_index"])
    print("metadata:", input_result["metadata"])
    print("column_names:", input_result["column_names"])
    print("row_count:", input_result["row_count"])

    output_result = reader.read("uploads/output.xls")
    print("output.xls")
    print("header_row_index:", output_result["header_row_index"])
    print("column_names:", output_result["column_names"])
    print("row_count:", output_result["row_count"])
