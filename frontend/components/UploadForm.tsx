"use client";

import { FormEvent, useState } from "react";
import { DropZone } from "./DropZone";
import type { UploadResult } from "../types";

interface UploadFormProps {
  onUploadComplete: (result: UploadResult) => void;
}

const MAX_FILE_SIZE_MB = 10;
const ALLOWED_TYPES = [".xlsx", ".xls", ".csv"];

function todayInputValue(): string {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
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
    return "Upload failed. Please try again.";
  }

  return "Upload failed. Please try again.";
}

export function UploadForm({ onUploadComplete }: UploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceSystem, setSourceSystem] = useState("Mosaic POS");
  const [transactionDate, setTransactionDate] = useState(todayInputValue());
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");

  const handleFileSelect = (selectedFile: File) => {
    setError("");

    if (!isAllowedFile(selectedFile)) {
      setFile(null);
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setFile(null);
      return;
    }

    setFile(selectedFile);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("source_system", sourceSystem.trim() || "Unknown");
    if (transactionDate) {
      formData.append("transaction_date", transactionDate);
    }

    setIsUploading(true);
    setError("");

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
      onUploadComplete(result);
    } catch {
      setError("Upload failed. Check that the backend server is running.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <DropZone
        allowedTypes={ALLOWED_TYPES}
        maxSizeMB={MAX_FILE_SIZE_MB}
        onFileSelect={handleFileSelect}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">
            Source system
          </span>
          <input
            type="text"
            value={sourceSystem}
            onChange={(event) => setSourceSystem(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            placeholder="Mosaic POS"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">
            Transaction date
          </span>
          <input
            type="date"
            value={transactionDate}
            onChange={(event) => setTransactionDate(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!file || isUploading}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
      >
        {isUploading ? (
          <>
            <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Processing
          </>
        ) : (
          "Upload and Format"
        )}
      </button>
    </form>
  );
}
