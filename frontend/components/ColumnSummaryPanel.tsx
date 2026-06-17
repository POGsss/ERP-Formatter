import type { ColumnSummaryItem } from "../types";

interface ColumnSummaryPanelProps {
  columnSummary: ColumnSummaryItem[];
}

const badgeClasses: Record<ColumnSummaryItem["status"], string> = {
  mapped: "bg-black text-white ring-black",
  computed: "bg-zinc-200 text-black ring-zinc-300",
  hardcoded: "bg-zinc-100 text-black ring-zinc-300",
  defaulted: "bg-white text-black ring-zinc-500",
};

export function ColumnSummaryPanel({ columnSummary }: ColumnSummaryPanelProps) {
  return (
    <details className="rounded-md border border-zinc-200 bg-white">
      <summary className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 text-sm font-semibold text-black">
        <span>Column Summary</span>
        <span className="text-xs font-medium text-zinc-500">
          {columnSummary.length} columns
        </span>
      </summary>

      <div className="border-t border-zinc-200">
        <div className="grid grid-cols-[minmax(150px,1fr)_auto_minmax(180px,1.3fr)] gap-3 border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase text-zinc-500">
          <span>Column</span>
          <span>Status</span>
          <span>Source</span>
        </div>

        <div className="divide-y divide-zinc-100">
          {columnSummary.map((item) => (
            <div
              key={item.column}
              className="grid grid-cols-[minmax(150px,1fr)_auto_minmax(180px,1.3fr)] items-center gap-3 px-4 py-2 text-sm"
            >
              <span className="font-medium text-black">{item.column}</span>
              <span
                className={`inline-flex min-w-24 items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${badgeClasses[item.status]}`}
                title={item.description}
              >
                {item.status}
              </span>
              <span className="break-words text-zinc-600" title={item.note}>
                {item.source}
                {item.note ? (
                  <span className="ml-2 font-medium text-black">{item.note}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
