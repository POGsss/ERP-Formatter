import type { ColumnSummaryItem } from "../types";
import { TableFrame, TableHeaderCell } from "./ui";

interface PreviewTableProps {
  preview: Record<string, any>[];
  columnSummary: ColumnSummaryItem[];
  totalRows?: number;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function isDefaultedValue(value: unknown): boolean {
  return value === "NA" || value === 0 || value === "0";
}

export function PreviewTable({
  preview,
  columnSummary,
  totalRows,
}: PreviewTableProps) {
  const summaryByColumn = new Map(
    columnSummary.map((item) => [item.column, item.status]),
  );
  const previewColumns = preview.length > 0 ? Object.keys(preview[0]) : [];
  const columns = [
    ...columnSummary.map((item) => item.column),
    ...previewColumns.filter((column) => !summaryByColumn.has(column)),
  ];
  const shownRows = preview.length;
  const rowTotal = totalRows ?? shownRows;

  return (
    <section aria-labelledby="preview-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2
            id="preview-title"
            className="text-base font-semibold text-black"
          >
            Output Preview
          </h2>
          <p className="text-sm text-zinc-600">
            Showing {shownRows} of {rowTotal} rows
          </p>
        </div>
      </div>

      <TableFrame>
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                {columns.map((column) => {
                  const status = summaryByColumn.get(column);
                  const isDefaulted = status === "defaulted";

                  return (
                    <TableHeaderCell key={column}>
                      <span className={isDefaulted ? "text-zinc-300" : ""}>
                        {column}
                      </span>
                    </TableHeaderCell>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {preview.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-10 text-center text-sm font-medium text-zinc-500"
                    colSpan={Math.max(columns.length, 1)}
                  >
                    No preview rows returned.
                  </td>
                </tr>
              ) : (
                preview.map((row, rowIndex) => (
                  <tr key={rowIndex} className="bg-white hover:bg-zinc-50">
                    {columns.map((column) => {
                      const value = row[column];
                      const isDefaultedColumn =
                        summaryByColumn.get(column) === "defaulted";
                      const highlightCell =
                        isDefaultedColumn && isDefaultedValue(value);

                      return (
                        <td
                          key={`${rowIndex}-${column}`}
                          className={`whitespace-nowrap border-b border-r border-zinc-100 px-3 py-2 text-zinc-800 last:border-r-0 ${
                            highlightCell ? "font-semibold text-black" : ""
                          }`}
                        >
                          {displayValue(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
      </TableFrame>
    </section>
  );
}
