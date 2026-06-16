import { ActionButton, SkeletonLine } from "./ui";

type UploadMode = "standard" | "template";

interface UploadSummaryPanelProps {
  disabled: boolean;
  formId: string;
  label: string;
  mode: UploadMode;
  summary: { label: string; value: string }[] | null;
}

export function UploadSummaryPanel({
  disabled,
  formId,
  label,
  mode,
  summary,
}: UploadSummaryPanelProps) {
  return (
    <aside className="rounded-lg border border-zinc-300 bg-white p-5">
      {summary ? (
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-black">Ready to process</p>
            <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600">
              {mode === "template" ? "Template" : "Standard"}
            </span>
          </div>
          <div className="grid gap-2">
            {summary.map((item) => (
              <div
                key={item.label}
                className="grid grid-cols-[76px_minmax(0,1fr)] gap-3 text-sm"
              >
                <span className="font-medium text-zinc-500">{item.label}</span>
                <span className="truncate font-medium text-black">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2 pb-1">
          <SkeletonLine className="h-5 w-40" />
          <SkeletonLine className="h-3 w-56" />
          <SkeletonLine className="h-3 w-44" />
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
