import type { ColumnSummaryItem } from "../types";
import { TableFrame, TableHeaderCell } from "./ui";

interface PreviewTableProps {
  preview: Record<string, any>[];
  columnSummary: ColumnSummaryItem[];
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
}: PreviewTableProps) {
  const summaryByColumn = new Map(
    columnSummary.map((item) => [item.column, item]),
  );
  const previewColumns = preview.length > 0 ? Object.keys(preview[0]) : [];
  const columns = [
    ...columnSummary.map((item) => item.column),
    ...previewColumns.filter((column) => !summaryByColumn.has(column)),
  ];

  return (
    <section aria-label="Output preview table">
      <TableFrame>
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                {columns.map((column) => {
                  const summary = summaryByColumn.get(column);
                  const status = summary?.status;
                  const isDefaulted = status === "defaulted";
                  const title = summary
                    ? [summary.source, summary.note].filter(Boolean).join(" - ")
                    : column;

                  return (
                    <TableHeaderCell key={column} title={title}>
                      <span className="flex items-center gap-2">
                        <span className={isDefaulted ? "text-zinc-300" : ""}>
                          {column}
                        </span>
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
                      const summary = summaryByColumn.get(column);
                      const isDefaultedColumn = summary?.status === "defaulted";
                      const highlightCell =
                        isDefaultedColumn && isDefaultedValue(value);

                      return (
                        <td
                          key={`${rowIndex}-${column}`}
                          className={`whitespace-nowrap border-b border-r border-zinc-100 px-3 py-2 text-zinc-800 last:border-r-0 ${
                            highlightCell ? "bg-zinc-50 font-semibold text-black" : ""
                          }`}
                          title={summary?.note || summary?.source || column}
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
