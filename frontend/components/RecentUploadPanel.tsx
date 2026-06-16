import { ActionButton } from "./ui";

export interface RecentUploadItem {
  id: number;
  original_name: string;
  source_system: string;
  transaction_date: string;
  uploaded_at: string;
  status: string;
  row_count: number;
  error_count: number;
  download_url: string | null;
  error_report_url?: string | null;
}

interface RecentUploadPanelProps {
  uploads: RecentUploadItem[];
  isLoading: boolean;
  reprocessingId: number | null;
  onReprocess: (uploadId: number) => void;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatDateTime(value: string): string {
  if (!value) {
    return "Just now";
  }

  const parsed = new Date(value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function RecentUploadPanel({
  uploads,
  isLoading,
  reprocessingId,
  onReprocess,
}: RecentUploadPanelProps) {
  return (
    <section className="min-h-[500px] rounded-lg border border-zinc-300 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-700">Recent Upload</h2>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-[70px] rounded-lg bg-zinc-200" />
          ))
        ) : uploads.length === 0 ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-dashed border-zinc-200 bg-white text-sm font-medium text-zinc-500">
            No processed files yet.
          </div>
        ) : (
          uploads.map((upload) => (
            <article
              key={upload.id}
              className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-black">
                    {upload.original_name}
                  </h3>
                  <StatusBadge status={upload.status} />
                </div>
                <p className="mt-1 text-xs font-medium text-zinc-600">
                  {formatDateTime(upload.uploaded_at)} - {upload.source_system || "Unknown"}
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  {formatNumber(upload.row_count)} rows - {formatNumber(upload.error_count)} errors
                </p>
              </div>
              <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                {upload.download_url ? (
                  <ActionButton
                    href={upload.download_url}
                    download
                    className="min-h-9 px-3 py-1.5 text-xs"
                  >
                    Download
                  </ActionButton>
                ) : (
                  <span className="inline-flex min-h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-500">
                    No output
                  </span>
                )}
                <ActionButton
                  variant="secondary"
                  onClick={() => onReprocess(upload.id)}
                  disabled={reprocessingId !== null}
                  className="min-h-9 px-3 py-1.5 text-xs"
                >
                  {reprocessingId === upload.id ? "Processing" : "Reprocess"}
                </ActionButton>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "done"
      ? "bg-emerald-100 text-emerald-700"
      : status === "error"
        ? "bg-red-100 text-red-700"
        : "bg-amber-100 text-amber-700";

  return (
    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${classes}`}>
      {status || "unknown"}
    </span>
  );
}
