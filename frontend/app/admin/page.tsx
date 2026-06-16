"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface AdminStats {
  uploads_today: number;
  uploads_this_month: number;
  errors_today: number;
  total_rows_processed: number;
}

interface AdminUpload {
  id: number;
  filename: string;
  original_name: string;
  source_system: string;
  transaction_date: string;
  uploaded_at: string;
  status: string;
  row_count: number;
  error_count: number;
  output_file: string | null;
  error_report: string | null;
  uploader_ip: string;
  download_url: string | null;
  error_report_url: string | null;
}

interface UploadsResponse {
  uploads: AdminUpload[];
  total: number;
  limit: number;
  offset: number;
}

const DEFAULT_STATS: AdminStats = {
  uploads_today: 0,
  uploads_this_month: 0,
  errors_today: 0,
  total_rows_processed: 0,
};

const PAGE_SIZE = 50;

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      detail?: string;
      error?: string;
    };

    return payload.detail || payload.error || "Request failed.";
  } catch {
    return "Request failed.";
  }
}

function formatDateTime(value: string): string {
  if (!value) {
    return "Not recorded";
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function statusClasses(status: string): string {
  if (status === "done") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "error") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  return "border-amber-200 bg-amber-50 text-amber-700";
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats>(DEFAULT_STATS);
  const [uploads, setUploads] = useState<AdminUpload[]>([]);
  const [totalUploads, setTotalUploads] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [reprocessingId, setReprocessingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadAdminData = useCallback(async (showRefreshState = false) => {
    if (showRefreshState) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError("");

    try {
      const [statsResponse, uploadsResponse] = await Promise.all([
        fetch("/api/admin/stats", { cache: "no-store" }),
        fetch(`/api/admin/uploads?limit=${PAGE_SIZE}&offset=0`, {
          cache: "no-store",
        }),
      ]);

      if (!statsResponse.ok) {
        setError(await getErrorMessage(statsResponse));
        return;
      }

      if (!uploadsResponse.ok) {
        setError(await getErrorMessage(uploadsResponse));
        return;
      }

      const statsPayload = (await statsResponse.json()) as AdminStats;
      const uploadsPayload = (await uploadsResponse.json()) as UploadsResponse;

      setStats(statsPayload);
      setUploads(uploadsPayload.uploads ?? []);
      setTotalUploads(uploadsPayload.total ?? 0);
    } catch {
      setError("Admin data failed to load. Check that the backend server is running.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  const handleReprocess = async (uploadId: number) => {
    if (reprocessingId !== null) {
      return;
    }

    setReprocessingId(uploadId);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `/api/admin/uploads/${uploadId}/reprocess`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        setError(await getErrorMessage(response));
        return;
      }

      setNotice("Upload reprocessed. A new output file is ready.");
      await loadAdminData(true);
    } catch {
      setError("Reprocess failed. Check that the backend server is running.");
    } finally {
      setReprocessingId(null);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal text-slate-950">
              Admin Dashboard
            </h1>
            <p className="mt-2 text-base text-slate-600">
              Upload history, processing stats, and file recovery.
            </p>
          </div>
          <Link
            href="/admin/settings"
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Defaults Settings
          </Link>
        </div>
      </header>

      <section className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              label="Uploads Today"
              value={formatNumber(stats.uploads_today)}
            />
            <StatsCard
              label="This Month"
              value={formatNumber(stats.uploads_this_month)}
            />
            <StatsCard
              label="Errors Today"
              value={formatNumber(stats.errors_today)}
            />
            <StatsCard
              label="Rows Processed"
              value={formatNumber(stats.total_rows_processed)}
            />
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">
                Upload History
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Showing {uploads.length} of {totalUploads} uploads.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadAdminData(true)}
              disabled={isLoading || isRefreshing}
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              {isRefreshing ? "Refreshing" : "Refresh"}
            </button>
          </div>

          {error ? (
            <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {error}
            </p>
          ) : null}

          {notice ? (
            <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
              {notice}
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-normal text-slate-600">
                <tr>
                  <th className="px-4 py-3">Date/Time</th>
                  <th className="px-4 py-3">Original Filename</th>
                  <th className="px-4 py-3">Source System</th>
                  <th className="px-4 py-3">Rows</th>
                  <th className="px-4 py-3">Errors</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {isLoading ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      Loading upload history
                    </td>
                  </tr>
                ) : uploads.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      No uploads yet.
                    </td>
                  </tr>
                ) : (
                  uploads.map((upload) => (
                    <tr key={upload.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {formatDateTime(upload.uploaded_at)}
                      </td>
                      <td className="min-w-48 px-4 py-3 font-medium text-slate-950">
                        {upload.original_name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {upload.source_system || "Unknown"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {formatNumber(upload.row_count)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {formatNumber(upload.error_count)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${statusClasses(
                            upload.status,
                          )}`}
                        >
                          {upload.status || "unknown"}
                        </span>
                      </td>
                      <td className="min-w-56 px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {upload.download_url ? (
                            <a
                              href={upload.download_url}
                              download
                              className="inline-flex min-h-9 items-center justify-center rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-800"
                            >
                              Re-download
                            </a>
                          ) : (
                            <span className="inline-flex min-h-9 items-center justify-center rounded-md border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-400">
                              No output
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleReprocess(upload.id)}
                            disabled={reprocessingId !== null}
                            className="inline-flex min-h-9 items-center justify-center rounded-md border border-blue-700 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400"
                          >
                            {reprocessingId === upload.id
                              ? "Reprocessing"
                              : "Reprocess"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatsCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950">
        {value}
      </p>
    </article>
  );
}
