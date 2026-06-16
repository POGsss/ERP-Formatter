"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
  const [stats, setStats] = useState<AdminStats>(DEFAULT_STATS);
  const [recentUploads, setRecentUploads] = useState<RecentUploadItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [reprocessingId, setReprocessingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [posColumns, setPosColumns] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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

  const selectedFileSummary = useMemo(() => {
    if (!file) {
      return null;
    }

    return [
      { label: "File", value: file.name },
      { label: "Size", value: formatFileSize(file.size) },
    ];
  }, [file]);

  const resetTemplateState = () => {
    setPosColumns([]);
    setSuggestions([]);
  };

  const handleModeChange = (nextMode: UploadMode) => {
    setMode(nextMode);
    setError("");
    setNotice("");
    resetTemplateState();
  };

  const handleFileSelect = (selectedFile: File) => {
    setError("");
    setNotice("");
    resetTemplateState();

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

    if (!isAllowedFile(selectedFile) || selectedFile.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setTemplateFile(null);
      return;
    }

    setTemplateFile(selectedFile);
  };

  const handleUploadComplete = async (result: UploadResult) => {
    setActiveResult(result);
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
    setNotice("Processed output is ready in Mapping Preview.");
    await loadWorkspaceData();
  };

  const handleStandardProcess = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!file || isProcessing) {
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

  const handleReprocess = async (uploadId: number) => {
    if (reprocessingId !== null) {
      return;
    }

    setReprocessingId(uploadId);
    setError("");
    setNotice("");

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
      setNotice("Reprocessed output is ready in Mapping Preview.");
      await loadWorkspaceData();
    } catch {
      setError("Reprocess failed. Check that the backend server is running.");
    } finally {
      setReprocessingId(null);
    }
  };

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

        <section className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="space-y-5">
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

              <DropZone
                allowedTypes={ALLOWED_TYPES}
                maxSizeMB={MAX_FILE_SIZE_MB}
                onFileSelect={handleFileSelect}
              />

              {mode === "template" ? (
                <div className="mt-4">
                  <DropZone
                    allowedTypes={ALLOWED_TYPES}
                    label="Upload ERP output template"
                    maxSizeMB={MAX_FILE_SIZE_MB}
                    onFileSelect={handleTemplateFileSelect}
                  />
                </div>
              ) : null}
            </form>

            <UploadSummaryPanel
              formId={UPLOAD_FORM_ID}
              mode={mode}
              summary={selectedFileSummary}
              disabled={
                !file ||
                isProcessing ||
                isAnalyzing ||
                (mode === "template" && !templateFile)
              }
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
            reprocessingId={reprocessingId}
            onReprocess={handleReprocess}
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
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-black">Mapping Preview</h2>
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
              totalRows={activeResult.row_count}
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
