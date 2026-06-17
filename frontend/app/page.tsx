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
import { MappingReviewTable } from "../components/MappingReviewTable";
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
import type { MappingItem, SuggestionItem, UploadResult } from "../types";

const MAX_FILE_SIZE_MB = 10;
const ALLOWED_TYPES = [".xlsx", ".xls", ".csv"];
const PAGE_SIZE = 6;
const DEFAULT_SOURCE_SYSTEM = "Mosaic POS";
const UPLOAD_FORM_ID = "erp-upload-form";

type UploadMode = "standard" | "template";

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

interface SuggestionResult {
  mode: "suggestion";
  template_columns: string[];
  pos_columns: string[];
  suggestions: SuggestionItem[];
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
): RecentUploadItem {
  return {
    id: result.upload_id,
    original_name:
      "original_filename" in result && typeof result.original_filename === "string"
        ? result.original_filename
        : fallbackName,
    source_system: sourceSystem,
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
  const [mode, setMode] = useState<UploadMode>("standard");
  const [file, setFile] = useState<File | null>(null);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [activeResult, setActiveResult] = useState<UploadResult | null>(null);
  const [selectedUpload, setSelectedUpload] = useState<RecentUploadItem | null>(null);
  const uploadColumnRef = useRef<HTMLDivElement | null>(null);
  const [stats, setStats] = useState<AdminStats>(DEFAULT_STATS);
  const [recentUploads, setRecentUploads] = useState<RecentUploadItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [reprocessingId, setReprocessingId] = useState<number | null>(null);
  const [dropZoneResetKey, setDropZoneResetKey] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [posColumns, setPosColumns] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadColumnHeight, setUploadColumnHeight] = useState<number | null>(null);

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

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

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

    const updateUploadColumnHeight = () => {
      setUploadColumnHeight(uploadColumn.offsetHeight);
    };

    updateUploadColumnHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateUploadColumnHeight);
      return () => window.removeEventListener("resize", updateUploadColumnHeight);
    }

    const observer = new ResizeObserver(updateUploadColumnHeight);
    observer.observe(uploadColumn);
    return () => observer.disconnect();
  }, [mode, selectedItemSummary]);

  const resetTemplateState = () => {
    setPosColumns([]);
    setSuggestions([]);
  };

  const handleModeChange = (nextMode: UploadMode) => {
    setMode(nextMode);
    setSelectedUpload(null);
    setError("");
    setNotice("");
    resetTemplateState();
  };

  const handleFileSelect = (selectedFile: File) => {
    setError("");
    setNotice("");
    resetTemplateState();
    setSelectedUpload(null);

    if (!isAllowedFile(selectedFile) || selectedFile.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setFile(null);
      return;
    }

    setFile(selectedFile);
  };

  const handleTemplateFileSelect = (selectedFile: File) => {
    setError("");
    setNotice("");
    resetTemplateState();
    setSelectedUpload(null);

    if (!isAllowedFile(selectedFile) || selectedFile.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setTemplateFile(null);
      return;
    }

    setTemplateFile(selectedFile);
  };

  const handleUploadComplete = async (result: UploadResult) => {
    setActiveResult(result);
    setSelectedUpload(null);
    setRecentUploads((currentUploads) => [
      uploadResultToRecent(
        result,
        file?.name ?? `Upload ${result.upload_id}`,
        mode === "template" ? "Custom Template" : DEFAULT_SOURCE_SYSTEM,
        todayInputValue(),
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

  const handleStandardProcess = async (event: FormEvent<HTMLFormElement>) => {
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

  const handleAnalyzeMapping = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!file || !templateFile || isAnalyzing) {
      return;
    }

    const formData = new FormData();
    formData.append("pos_file", file);
    formData.append("template_file", templateFile);

    setIsAnalyzing(true);
    setError("");
    setNotice("");
    resetTemplateState();

    try {
      const response = await fetch("/api/transform/with-template", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        setError(await getErrorMessage(response));
        return;
      }

      const result = (await response.json()) as SuggestionResult;
      setPosColumns(result.pos_columns ?? []);
      setSuggestions(result.suggestions ?? []);
      setNotice("Mapping suggestions are ready for review.");
    } catch {
      setError("Mapping analysis failed. Check that the backend server is running.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirmMapping = async (mapping: MappingItem[]) => {
    if (!file || isProcessing) {
      return;
    }

    const formData = new FormData();
    formData.append("pos_file", file);
    formData.append("confirmed_mapping", JSON.stringify(mapping));

    setIsProcessing(true);
    setError("");
    setNotice("");
    setActiveResult(null);

    try {
      const response = await fetch("/api/transform/with-template", {
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
      setError("Template processing failed. Check that the backend server is running.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSelectRecentUpload = (upload: RecentUploadItem) => {
    setSelectedUpload(upload);
    setFile(null);
    setTemplateFile(null);
    setDropZoneResetKey((currentKey) => currentKey + 1);
    setError("");
    setNotice("");
    resetTemplateState();
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

  const isProcessDisabled =
    isProcessing ||
    isAnalyzing ||
    (mode === "standard"
      ? !file && !selectedUpload
      : !file || !templateFile);
  const summaryTitle = selectedUpload ? "Selected item" : "Ready to process";
  const summaryBadge = selectedUpload
    ? "Recent"
    : mode === "template"
      ? "Template"
      : "Standard";
  const previewRowCount = activeResult?.preview.length ?? 0;
  const previewTotalRows = activeResult?.row_count ?? 0;

  return (
    <AppShell title="ERP Formatter" actionHref="/settings" actionLabel="Default Settings">
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
          <div ref={uploadColumnRef} className="space-y-5 self-start">
            <form
              id={UPLOAD_FORM_ID}
              onSubmit={mode === "standard" ? handleStandardProcess : handleAnalyzeMapping}
              className="rounded-lg border border-zinc-300 bg-white p-5"
            >
              <div
                role="radiogroup"
                aria-label="Upload mode"
                className="mb-5 inline-flex rounded-lg bg-zinc-200 p-0"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === "standard"}
                  onClick={() => handleModeChange("standard")}
                  className={`min-h-9 rounded-lg px-5 text-sm font-medium transition ${
                    mode === "standard"
                      ? "bg-white text-black shadow-sm ring-1 ring-zinc-300"
                      : "text-zinc-700 hover:text-black"
                  }`}
                >
                  Standard
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

              <div className="h-72">
                {mode === "template" ? (
                  <div className="grid h-full grid-rows-2 gap-3">
                    <DropZone
                      key={`pos-template-${dropZoneResetKey}`}
                      allowedTypes={ALLOWED_TYPES}
                      buttonClassName="h-full px-4"
                      className="h-full min-h-0"
                      compact
                      label="Upload POS file"
                      maxSizeMB={MAX_FILE_SIZE_MB}
                      onFileSelect={handleFileSelect}
                    />
                    <DropZone
                      key={`template-${dropZoneResetKey}`}
                      allowedTypes={ALLOWED_TYPES}
                      buttonClassName="h-full px-4"
                      className="h-full min-h-0"
                      compact
                      label="Upload ERP output template"
                      maxSizeMB={MAX_FILE_SIZE_MB}
                      onFileSelect={handleTemplateFileSelect}
                    />
                  </div>
                ) : (
                  <DropZone
                    key={`pos-standard-${dropZoneResetKey}`}
                    allowedTypes={ALLOWED_TYPES}
                    buttonClassName="h-full"
                    className="h-full"
                    maxSizeMB={MAX_FILE_SIZE_MB}
                    onFileSelect={handleFileSelect}
                  />
                )}
              </div>
            </form>

            <UploadSummaryPanel
              badgeLabel={summaryBadge}
              formId={UPLOAD_FORM_ID}
              summary={selectedItemSummary}
              summaryTitle={summaryTitle}
              disabled={isProcessDisabled}
              label={
                isProcessing || isAnalyzing
                  ? mode === "template"
                    ? "Analyzing"
                    : "Processing"
                  : mode === "template"
                    ? "Analyze Mapping"
                    : "Process"
              }
            />
          </div>

          <RecentUploadPanel
            uploads={recentUploads}
            isLoading={isLoadingHistory}
            isActionDisabled={isProcessing || isAnalyzing}
            height={uploadColumnHeight}
            processingUploadId={reprocessingId}
            selectedUploadId={selectedUpload?.id ?? null}
            onSelect={handleSelectRecentUpload}
          />
        </section>

        {suggestions.length > 0 ? (
          <Panel>
            <MappingReviewTable
              isConfirming={isProcessing}
              onConfirm={handleConfirmMapping}
              posColumns={posColumns}
              suggestions={suggestions}
            />
          </Panel>
        ) : null}

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
