"use client";

import { FormEvent, useState } from "react";
import { DropZone } from "./DropZone";
import type { UploadResult } from "../types";
import { ActionButton, Message } from "./ui";

interface UploadFormProps {
  onUploadComplete: (result: UploadResult) => void;
}

const MAX_FILE_SIZE_MB = 10;
const ALLOWED_TYPES = [".xlsx", ".xls", ".csv"];
const DEFAULT_SOURCE_SYSTEM = "Mosaic POS";

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
    formData.append("source_system", DEFAULT_SOURCE_SYSTEM);
    formData.append("transaction_date", todayInputValue());

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

      {error ? (
        <Message tone="error">{error}</Message>
      ) : null}

      <ActionButton
        type="submit"
        disabled={!file || isUploading}
      >
        {isUploading ? "Processing" : "Upload and Format"}
      </ActionButton>
    </form>
  );
}
