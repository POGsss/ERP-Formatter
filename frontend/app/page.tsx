"use client";

import { FormEvent, useState } from "react";
import { ColumnSummaryPanel } from "../components/ColumnSummaryPanel";
import { DownloadPanel } from "../components/DownloadPanel";
import { DropZone } from "../components/DropZone";
import { MappingReviewTable } from "../components/MappingReviewTable";
import { PreviewTable } from "../components/PreviewTable";
import { UploadForm } from "../components/UploadForm";
import type { MappingItem, SuggestionItem, UploadResult } from "../types";

const MAX_FILE_SIZE_MB = 10;
const ALLOWED_TYPES = [".xlsx", ".xls", ".csv"];

type UploadMode = "standard" | "custom";

interface SuggestionResult {
  mode: "suggestion";
  template_columns: string[];
  pos_columns: string[];
  suggestions: SuggestionItem[];
}

function isAllowedFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  return ALLOWED_TYPES.some((type) => fileName.endsWith(type));
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

export default function HomePage() {
  const [mode, setMode] = useState<UploadMode>("standard");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  const changeMode = (nextMode: UploadMode) => {
    setMode(nextMode);
    setUploadResult(null);
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <h1 className="text-3xl font-semibold tracking-normal text-slate-950">
            ERP Excel Formatter
          </h1>
          <p className="mt-2 text-base text-slate-600">
            Mosaic POS - ERP Import
          </p>
        </div>
      </header>

      <section className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-slate-950">Upload</h2>
            <p className="mt-1 text-sm text-slate-600">
              Add the POS export, label the source, and format it for ERP import.
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <div
              role="radiogroup"
              aria-label="Upload mode"
              className="mb-5 inline-flex rounded-md border border-slate-300 bg-slate-100 p-1"
            >
              <button
                type="button"
                role="radio"
                aria-checked={mode === "standard"}
                onClick={() => changeMode("standard")}
                className={`inline-flex min-h-10 items-center rounded px-4 py-2 text-sm font-semibold transition ${
                  mode === "standard"
                    ? "bg-white text-blue-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-950"
                }`}
              >
                <span
                  className={`mr-2 h-2.5 w-2.5 rounded-full ${
                    mode === "standard" ? "bg-blue-700" : "bg-slate-300"
                  }`}
                  aria-hidden="true"
                />
                Standard Mode
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === "custom"}
                onClick={() => changeMode("custom")}
                className={`inline-flex min-h-10 items-center rounded px-4 py-2 text-sm font-semibold transition ${
                  mode === "custom"
                    ? "bg-white text-blue-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-950"
                }`}
              >
                <span
                  className={`mr-2 h-2.5 w-2.5 rounded-full ${
                    mode === "custom" ? "bg-blue-700" : "bg-slate-300"
                  }`}
                  aria-hidden="true"
                />
                Custom Template Mode
              </button>
            </div>

            {mode === "standard" ? (
              <UploadForm onUploadComplete={setUploadResult} />
            ) : (
              <CustomTemplateForm
                onResetResult={() => setUploadResult(null)}
                onUploadComplete={setUploadResult}
              />
            )}
          </div>
        </div>
      </section>

      {uploadResult ? (
        <section className="bg-white">
          <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Results</h2>
              <p className="mt-1 text-sm text-slate-600">
                Review the generated ERP columns before downloading the file.
              </p>
            </div>

            <ColumnSummaryPanel columnSummary={uploadResult.column_summary} />
            <PreviewTable
              columnSummary={uploadResult.column_summary}
              preview={uploadResult.preview}
              totalRows={uploadResult.row_count}
            />
            <DownloadPanel
              downloadUrl={uploadResult.download_url}
              errorCount={uploadResult.error_count}
              errorReportUrl={uploadResult.error_report_url}
              rowCount={uploadResult.row_count}
              warningCount={uploadResult.warnings.length}
            />
          </div>
        </section>
      ) : null}

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-5 text-sm text-slate-600">
          Defaulted columns (yellow) require manual entry in the ERP after import.
        </div>
      </footer>
    </div>
  );
}

interface CustomTemplateFormProps {
  onResetResult: () => void;
  onUploadComplete: (result: UploadResult) => void;
}

function CustomTemplateForm({
  onResetResult,
  onUploadComplete,
}: CustomTemplateFormProps) {
  const [posFile, setPosFile] = useState<File | null>(null);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [posColumns, setPosColumns] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState("");

  const clearMappingState = () => {
    setPosColumns([]);
    setSuggestions([]);
    onResetResult();
  };

  const handlePosFileSelect = (selectedFile: File) => {
    setError("");
    clearMappingState();

    if (!isAllowedFile(selectedFile)) {
      setPosFile(null);
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setPosFile(null);
      return;
    }

    setPosFile(selectedFile);
  };

  const handleTemplateFileSelect = (selectedFile: File) => {
    setError("");
    clearMappingState();

    if (!isAllowedFile(selectedFile)) {
      setTemplateFile(null);
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setTemplateFile(null);
      return;
    }

    setTemplateFile(selectedFile);
  };

  const handleAnalyzeMapping = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!posFile || !templateFile) {
      return;
    }

    const formData = new FormData();
    formData.append("pos_file", posFile);
    formData.append("template_file", templateFile);

    setIsAnalyzing(true);
    setError("");
    clearMappingState();

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
    } catch {
      setError("Mapping analysis failed. Check that the backend server is running.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirmMapping = async (mapping: MappingItem[]) => {
    if (!posFile || isApplying) {
      return;
    }

    const formData = new FormData();
    formData.append("pos_file", posFile);
    formData.append("confirmed_mapping", JSON.stringify(mapping));

    setIsApplying(true);
    setError("");
    onResetResult();

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
      onUploadComplete(result);
    } catch {
      setError("Template transform failed. Check that the backend server is running.");
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="space-y-5">
      <form className="space-y-5" onSubmit={handleAnalyzeMapping}>
        <div className="grid gap-4 md:grid-cols-2">
          <DropZone
            allowedTypes={ALLOWED_TYPES}
            maxSizeMB={MAX_FILE_SIZE_MB}
            onFileSelect={handlePosFileSelect}
          />
          <DropZone
            allowedTypes={ALLOWED_TYPES}
            label="Upload ERP output template"
            maxSizeMB={MAX_FILE_SIZE_MB}
            onFileSelect={handleTemplateFileSelect}
          />
        </div>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!posFile || !templateFile || isAnalyzing}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
        >
          {isAnalyzing ? (
            <>
              <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Analyzing
            </>
          ) : (
            "Analyze Mapping"
          )}
        </button>
      </form>

      {suggestions.length > 0 ? (
        <div className="border-t border-slate-200 pt-5">
          <MappingReviewTable
            isConfirming={isApplying}
            onConfirm={handleConfirmMapping}
            posColumns={posColumns}
            suggestions={suggestions}
          />
        </div>
      ) : null}
    </div>
  );
}
