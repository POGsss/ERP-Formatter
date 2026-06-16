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
      className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between"
    >
      <p className="text-sm font-semibold text-slate-900">
        ✓ {rowCount} rows processed — {warningCount} warnings — {errorCount}{" "}
        errors
      </p>

      <div className="flex flex-wrap gap-3">
        <a
          href={downloadUrl}
          download
          className="inline-flex min-h-10 items-center justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800"
        >
          Download ERP File
        </a>

        {errorReportUrl ? (
          <a
            href={errorReportUrl}
            download
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-blue-700 bg-white px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
          >
            Download Error Report
          </a>
        ) : null}
      </div>
    </section>
  );
}
