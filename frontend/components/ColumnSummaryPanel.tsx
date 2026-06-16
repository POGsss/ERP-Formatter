import type { ColumnSummaryItem } from "../types";

interface ColumnSummaryPanelProps {
  columnSummary: ColumnSummaryItem[];
}

const badgeClasses: Record<ColumnSummaryItem["status"], string> = {
  mapped: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  computed: "bg-blue-100 text-blue-800 ring-blue-200",
  hardcoded: "bg-blue-100 text-blue-800 ring-blue-200",
  defaulted: "bg-yellow-100 text-yellow-900 ring-yellow-200",
};

function statusLabel(status: ColumnSummaryItem["status"]): string {
  if (status === "defaulted") {
    return "⚠ defaulted";
  }

  return status;
}

export function ColumnSummaryPanel({ columnSummary }: ColumnSummaryPanelProps) {
  return (
    <details className="rounded-md border border-slate-200 bg-white">
      <summary className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 text-sm font-semibold text-slate-950">
        <span>Column Summary</span>
        <span className="text-xs font-medium text-slate-500">
          {columnSummary.length} columns
        </span>
      </summary>

      <div className="border-t border-slate-200">
        <div className="grid grid-cols-[minmax(150px,1fr)_auto_minmax(180px,1.3fr)] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase text-slate-500">
          <span>Column</span>
          <span>Status</span>
          <span>Source</span>
        </div>

        <div className="divide-y divide-slate-100">
          {columnSummary.map((item) => (
            <div
              key={item.column}
              className="grid grid-cols-[minmax(150px,1fr)_auto_minmax(180px,1.3fr)] items-center gap-3 px-4 py-2 text-sm"
            >
              <span className="font-medium text-slate-900">{item.column}</span>
              <span
                className={`inline-flex min-w-24 items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${badgeClasses[item.status]}`}
              >
                {statusLabel(item.status)}
              </span>
              <span className="break-words text-slate-600">{item.source}</span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
