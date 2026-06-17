import { ActionButton } from "./ui";

interface UploadSummaryPanelProps {
  badgeLabel: string;
  disabled: boolean;
  formId: string;
  label: string;
  summary: { label: string; value: string }[] | null;
  summaryTitle: string;
}

export function UploadSummaryPanel({
  badgeLabel,
  disabled,
  formId,
  label,
  summary,
  summaryTitle,
}: UploadSummaryPanelProps) {
  return (
    <aside className="rounded-lg border border-zinc-300 bg-white p-5">
      {summary ? (
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-black">{summaryTitle}</p>
            <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600">
              {badgeLabel}
            </span>
          </div>
          <div className="grid gap-2">
            {summary.map((item) => (
              <div
                key={item.label}
                className="grid grid-cols-[42px_minmax(0,1fr)] gap-3 text-sm"
              >
                <span className="font-medium text-zinc-500">{item.label}:</span>
                <span className="truncate font-medium text-black">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-200 bg-white px-4 py-5">
          <p className="text-sm font-semibold text-black">No item selected</p>
        </div>
      )}
      <ActionButton
        type="submit"
        form={formId}
        disabled={disabled}
        className="mt-5 w-full"
      >
        {label}
      </ActionButton>
    </aside>
  );
}
