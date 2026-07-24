"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DropZone } from "../components/DropZone";
import { PreviewTable } from "../components/PreviewTable";
import {
  RecentUploadPanel,
  type RecentUploadItem,
} from "../components/RecentUploadPanel";
import { UploadSummaryPanel } from "../components/UploadSummaryPanel";
import {
  ActionButton,
  AppShell,
  EmptyState,
  Message,
  Panel,
  StatCard,
} from "../components/ui";
import type { Template, UploadResult } from "../types";

const MAX_FILE_SIZE_MB = 10;
const ALLOWED_TYPES = [".xlsx", ".xls", ".csv"];
const PAGE_SIZE = 6;
const DEFAULT_SOURCE_SYSTEM = "Mosaic POS";
const DEFAULT_TEMPLATE_KEY = "old_pos";
const UPLOAD_FORM_ID = "erp-upload-form";

const FALLBACK_TEMPLATES: Template[] = [
  {
    key: "old_pos",
    label: "Old POS Template",
    description: "Processes the standard POS export into the 12-column ERP format.",
    is_default: true,
  },
  {
    key: "new_pos",
    label: "New POS Template",
    description: "Processes payment-method breakdown exports into per-payment ERP rows.",
    is_default: false,
  },
];

type UploadMode = "process" | "template";

interface AdminStats {
  uploads_today: number;
  uploads_this_month: number;
  errors_today: number;
  total_rows_processed: number;
}

interface UploadsResponse {
  uploads: RecentUploadItem[];
  total: number;
}

const DEFAULT_STATS: AdminStats = {
  uploads_today: 0,
  uploads_this_month: 0,
  errors_today: 0,
  total_rows_processed: 0,
};

function todayInputValue(): string {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
}

function isAllowedFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  return ALLOWED_TYPES.some((type) => fileName.endsWith(type));
}

function formatFileSize(size: number): string {
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      detail?: string;
      error?: string;
      errors?: string[];
    };

    if (payload.detail) {
      return payload.detail;
    }

    if (payload.errors?.length) {
      return payload.errors.join(" ");
    }

    if (payload.error) {
      return payload.error;
    }
  } catch {
    return "Request failed. Please try again.";
  }

  return "Request failed. Please try again.";
}

function uploadResultToRecent(
  result: UploadResult,
  fallbackName: string,
  sourceSystem: string,
  transactionDate: string,
  template: string,
): RecentUploadItem {
  return {
    id: result.upload_id,
    original_name: result.original_filename || fallbackName,
    source_system: sourceSystem,
    template,
    transaction_date: transactionDate,
    uploaded_at: new Date().toISOString(),
    status: result.status,
    row_count: result.row_count,
    error_count: result.error_count,
    download_url: result.download_url,
    error_report_url: result.error_report_url,
  };
}

export default function HomePage() {
  const [mode, setMode] = useState<UploadMode>("process");
  const [file, setFile] = useState<File | null>(null);
  const [templates, setTemplates] = useState<Template[]>(FALLBACK_TEMPLATES);
  const [selectedTemplate, setSelectedTemplate] = useState(DEFAULT_TEMPLATE_KEY);
  const [activeResult, setActiveResult] = useState<UploadResult | null>(null);
  const [selectedUpload, setSelectedUpload] = useState<RecentUploadItem | null>(null);
  const uploadColumnRef = useRef<HTMLDivElement | null>(null);
  const [stats, setStats] = useState<AdminStats>(DEFAULT_STATS);
  const [recentUploads, setRecentUploads] = useState<RecentUploadItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [reprocessingId, setReprocessingId] = useState<number | null>(null);
  const [deletingUploadId, setDeletingUploadId] = useState<number | null>(null);
  const [dropZoneResetKey, setDropZoneResetKey] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [processColumnHeight, setProcessColumnHeight] = useState<number | null>(null);

  const loadWorkspaceData = useCallback(async () => {
    setIsLoadingHistory(true);
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
      setRecentUploads(uploadsPayload.uploads ?? []);
    } catch {
      setError("Workspace data failed to load. Check that the backend server is running.");
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const response = await fetch("/api/templates", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Template request failed");
      }

      const payload = (await response.json()) as Template[];
      const availableTemplates = payload.length > 0 ? payload : FALLBACK_TEMPLATES;
      setTemplates(availableTemplates);
      setSelectedTemplate(
        availableTemplates.find((template) => template.is_default)?.key ??
          availableTemplates[0]?.key ??
          DEFAULT_TEMPLATE_KEY,
      );
    } catch {
      setTemplates(FALLBACK_TEMPLATES);
      setSelectedTemplate(
        FALLBACK_TEMPLATES.find((template) => template.is_default)?.key ??
          DEFAULT_TEMPLATE_KEY,
      );
    }
  }, []);

  useEffect(() => {
    void loadWorkspaceData();
    void loadTemplates();
  }, [loadTemplates, loadWorkspaceData]);

  const activeTemplate = useMemo(
    () =>
      templates.find((template) => template.key === selectedTemplate) ??
      FALLBACK_TEMPLATES[0],
    [selectedTemplate, templates],
  );

  const templateLabels = useMemo(
    () => Object.fromEntries(templates.map((template) => [template.key, template.label])),
    [templates],
  );

  const selectedItemSummary = useMemo(() => {
    if (selectedUpload) {
      return [
        { label: "File", value: selectedUpload.original_name },
        { label: "Source", value: selectedUpload.source_system || "Unknown" },
        { label: "Rows", value: formatNumber(selectedUpload.row_count) },
      ];
    }

    if (file) {
      return [
        { label: "File", value: file.name },
        { label: "Size", value: formatFileSize(file.size) },
      ];
    }

    return null;
  }, [file, selectedUpload]);

  useEffect(() => {
    const uploadColumn = uploadColumnRef.current;
    if (!uploadColumn) {
      return;
    }

    const updateProcessColumnHeight = () => {
      if (mode === "process") {
        setProcessColumnHeight(uploadColumn.offsetHeight);
      }
    };

    updateProcessColumnHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateProcessColumnHeight);
      return () => window.removeEventListener("resize", updateProcessColumnHeight);
    }

    const observer = new ResizeObserver(updateProcessColumnHeight);
    observer.observe(uploadColumn);
    return () => observer.disconnect();
  }, [mode, selectedItemSummary]);

  const handleModeChange = (nextMode: UploadMode) => {
    setMode(nextMode);
    setSelectedUpload(null);
    setError("");
    setNotice("");
  };

  const handleFileSelect = (selectedFile: File) => {
    setError("");
    setNotice("");
    setSelectedUpload(null);

    if (!isAllowedFile(selectedFile) || selectedFile.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setFile(null);
      return;
    }

    setFile(selectedFile);
  };

  const handleUploadComplete = async (result: UploadResult) => {
    setActiveResult(result);
    setSelectedUpload(null);
    setRecentUploads((currentUploads) => [
      uploadResultToRecent(
        result,
        file?.name ?? `Upload ${result.upload_id}`,
        DEFAULT_SOURCE_SYSTEM,
        todayInputValue(),
        selectedTemplate,
      ),
      ...currentUploads.filter((upload) => upload.id !== result.upload_id),
    ].slice(0, PAGE_SIZE));
    setStats((currentStats) => ({
      uploads_today: currentStats.uploads_today + 1,
      uploads_this_month: currentStats.uploads_this_month + 1,
      errors_today: currentStats.errors_today + result.error_count,
      total_rows_processed: currentStats.total_rows_processed + result.row_count,
    }));
    setNotice("Processed output is ready in Output Preview.");
    await loadWorkspaceData();
  };

  const handleProcess = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isProcessing) {
      return;
    }

    if (selectedUpload) {
      await handleSelectedUploadProcess(selectedUpload.id);
      return;
    }

    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("source_system", DEFAULT_SOURCE_SYSTEM);
    formData.append("transaction_date", todayInputValue());
    formData.append("template", selectedTemplate);

    setIsProcessing(true);
    setError("");
    setNotice("");
    setActiveResult(null);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        setError(await getErrorMessage(response));
        return;
      }

      const result = (await response.json()) as UploadResult;
      await handleUploadComplete(result);
    } catch {
      setError("Upload failed. Check that the backend server is running.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSelectRecentUpload = (upload: RecentUploadItem) => {
    setSelectedUpload(upload);
    setFile(null);
    setDropZoneResetKey((currentKey) => currentKey + 1);
    setError("");
    setNotice("");
  };

  const handleSelectedUploadProcess = async (uploadId: number) => {
    if (reprocessingId !== null) {
      return;
    }

    setIsProcessing(true);
    setReprocessingId(uploadId);
    setError("");
    setNotice("");
    setActiveResult(null);

    try {
      const response = await fetch(`/api/admin/uploads/${uploadId}/reprocess`, {
        method: "POST",
      });

      if (!response.ok) {
        setError(await getErrorMessage(response));
        return;
      }

      const result = (await response.json()) as UploadResult;
      setActiveResult(result);
      setSelectedUpload((currentUpload) =>
        currentUpload?.id === uploadId
          ? {
              ...currentUpload,
              status: result.status,
              row_count: result.row_count,
              error_count: result.error_count,
              download_url: result.download_url,
              error_report_url: result.error_report_url,
            }
          : currentUpload,
      );
      setNotice("Processed output is ready in Output Preview.");
      await loadWorkspaceData();
    } catch {
      setError("Process failed. Check that the backend server is running.");
    } finally {
      setReprocessingId(null);
      setIsProcessing(false);
    }
  };

  const handleDeleteRecentUpload = async (upload: RecentUploadItem) => {
    if (deletingUploadId !== null || isProcessing) {
      return;
    }

    const shouldDelete = window.confirm(
      `Delete "${upload.original_name}" and its stored files?`,
    );
    if (!shouldDelete) {
      return;
    }

    setDeletingUploadId(upload.id);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`/api/admin/uploads/${upload.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        setError(await getErrorMessage(response));
        return;
      }

      setRecentUploads((currentUploads) =>
        currentUploads.filter((currentUpload) => currentUpload.id !== upload.id),
      );
      setSelectedUpload((currentUpload) =>
        currentUpload?.id === upload.id ? null : currentUpload,
      );
      setActiveResult((currentResult) =>
        currentResult?.upload_id === upload.id ? null : currentResult,
      );
      setNotice("Recent upload deleted.");
      await loadWorkspaceData();
    } catch {
      setError("Delete failed. Check that the backend server is running.");
    } finally {
      setDeletingUploadId(null);
    }
  };

  const isProcessDisabled =
    isProcessing || deletingUploadId !== null || (!file && !selectedUpload);
  const summaryTitle = selectedUpload ? "Selected item" : "Ready to process";
  const effectiveTemplateLabel = selectedUpload
    ? templateLabels[selectedUpload.template] ?? selectedUpload.template ?? activeTemplate.label
    : activeTemplate.label;
  const previewRowCount = activeResult?.preview.length ?? 0;
  const previewTotalRows = activeResult?.row_count ?? 0;

  return (
    <AppShell title="ERP Formatter" actionHref="/settings" actionLabel="Settings">
        <section
          aria-label="Workspace stats"
          className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          <StatCard label="Uploads Today" value={formatNumber(stats.uploads_today)} />
          <StatCard label="This Month" value={formatNumber(stats.uploads_this_month)} />
          <StatCard label="Errors Today" value={formatNumber(stats.errors_today)} />
          <StatCard
            label="Rows Processed"
            value={formatNumber(stats.total_rows_processed)}
          />
        </section>

        {(error || notice) ? (
          <section className="grid gap-3">
            {error ? (
              <Message tone="error">{error}</Message>
            ) : null}
            {notice ? (
              <Message tone="success">{notice}</Message>
            ) : null}
          </section>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start">
          <div
            ref={uploadColumnRef}
            className={mode === "process" ? "space-y-5 self-start" : "self-start"}
          >
            <form
              id={UPLOAD_FORM_ID}
              onSubmit={handleProcess}
              className={`rounded-lg border border-zinc-300 bg-white p-5 ${
                mode === "template" ? "flex flex-col" : ""
              }`}
              style={
                mode === "template" && processColumnHeight
                  ? { height: processColumnHeight }
                  : undefined
              }
            >
              <div
                role="radiogroup"
                aria-label="Workspace mode"
                className="mb-5 inline-flex self-start rounded-lg bg-zinc-200 p-0"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === "process"}
                  onClick={() => handleModeChange("process")}
                  className={`min-h-9 rounded-lg px-5 text-sm font-medium transition ${
                    mode === "process"
                      ? "bg-white text-black shadow-sm ring-1 ring-zinc-300"
                      : "text-zinc-700 hover:text-black"
                  }`}
                >
                  Process
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === "template"}
                  onClick={() => handleModeChange("template")}
                  className={`min-h-9 rounded-lg px-5 text-sm font-medium transition ${
                    mode === "template"
                      ? "bg-white text-black shadow-sm ring-1 ring-zinc-300"
                      : "text-zinc-700 hover:text-black"
                  }`}
                >
                  Template
                </button>
              </div>

              {mode === "template" ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="mb-4">
                    <h2 className="text-base font-semibold text-black">Choose a template</h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      Select the output format used on the Process tab.
                    </p>
                  </div>
                  <div role="radiogroup" aria-label="Templates" className="grid gap-3">
                    {templates.map((template) => {
                      const isActive = template.key === selectedTemplate;
                      return (
                        <button
                          key={template.key}
                          type="button"
                          role="radio"
                          aria-checked={isActive}
                          onClick={() => setSelectedTemplate(template.key)}
                          className={`w-full rounded-lg border p-4 text-left transition ${
                            isActive
                              ? "border-black bg-zinc-50 ring-1 ring-black"
                              : "border-zinc-200 bg-white hover:border-zinc-400"
                          }`}
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-black">
                              {template.label}
                            </span>
                            {isActive ? (
                              <span className="rounded-md bg-black px-2 py-1 text-xs font-semibold text-white">
                                Active
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-2 block text-sm leading-5 text-zinc-600">
                            {template.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="h-72">
                  <DropZone
                    key={`pos-process-${dropZoneResetKey}`}
                    allowedTypes={ALLOWED_TYPES}
                    buttonClassName="h-full"
                    className="h-full"
                    maxSizeMB={MAX_FILE_SIZE_MB}
                    onFileSelect={handleFileSelect}
                  />
                </div>
              )}
            </form>

            {mode === "process" ? (
              <UploadSummaryPanel
                formId={UPLOAD_FORM_ID}
                summary={selectedItemSummary}
                summaryTitle={summaryTitle}
                templateLabel={effectiveTemplateLabel}
                disabled={isProcessDisabled}
                label={isProcessing ? "Processing" : "Process"}
              />
            ) : null}
          </div>

          <RecentUploadPanel
            uploads={recentUploads}
            isLoading={isLoadingHistory}
            isActionDisabled={isProcessing || deletingUploadId !== null}
            deletingUploadId={deletingUploadId}
            height={processColumnHeight}
            processingUploadId={reprocessingId}
            selectedUploadId={selectedUpload?.id ?? null}
            templateLabels={templateLabels}
            onDelete={handleDeleteRecentUpload}
            onSelect={handleSelectRecentUpload}
          />
        </section>

        <Panel>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-black">Output Preview</h2>
              <p className="mt-1 text-sm text-zinc-600">
                Showing {previewRowCount} of {previewTotalRows} rows
              </p>
            </div>
            {activeResult?.download_url ? (
              <ActionButton
                href={activeResult.download_url}
                download
              >
                Download
              </ActionButton>
            ) : (
              <ActionButton variant="muted">
                Download
              </ActionButton>
            )}
          </div>

          {activeResult ? (
            <PreviewTable
              columnSummary={activeResult.column_summary}
              preview={activeResult.preview}
            />
          ) : (
            <EmptyState>
              Process a file to preview the generated XLSX output.
            </EmptyState>
          )}
        </Panel>
    </AppShell>
  );
}
