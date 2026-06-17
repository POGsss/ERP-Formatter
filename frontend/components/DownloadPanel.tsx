import { ActionButton } from "./ui";

interface DownloadPanelProps {
  downloadUrl: string;
  errorReportUrl: string | null;
  rowCount: number;
  errorCount: number;
  warningCount: number;
}

export function DownloadPanel({
  downloadUrl,
  errorReportUrl,
  rowCount,
  errorCount,
  warningCount,
}: DownloadPanelProps) {
  return (
    <section
      aria-label="Download files"
      className="flex flex-col gap-4 rounded-md border border-zinc-200 bg-white p-4 md:flex-row md:items-center md:justify-between"
    >
      <p className="text-sm font-semibold text-black">
        {rowCount} rows processed, {warningCount} warnings, {errorCount} errors
      </p>

      <div className="flex flex-wrap gap-3">
        <ActionButton href={downloadUrl} download>
          Download ERP File
        </ActionButton>

        {errorReportUrl ? (
          <ActionButton href={errorReportUrl} download variant="secondary">
            Download Error Report
          </ActionButton>
        ) : null}
      </div>
    </section>
  );
}
