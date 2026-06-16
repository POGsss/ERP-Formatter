"use client";

import { useRef, useState } from "react";

interface DropZoneProps {
  onFileSelect: (file: File) => void;
  maxSizeMB: number;
  allowedTypes: string[];
  label?: string;
}

type ValidationState = "empty" | "valid" | "invalid";

function formatFileSize(size: number): string {
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isAllowedType(file: File, allowedTypes: string[]): boolean {
  const fileName = file.name.toLowerCase();
  const fileType = file.type.toLowerCase();

  return allowedTypes.some((type) => {
    const normalizedType = type.toLowerCase().trim();

    if (normalizedType.startsWith(".")) {
      return fileName.endsWith(normalizedType);
    }

    return fileType === normalizedType;
  });
}

export function DropZone({
  onFileSelect,
  maxSizeMB,
  allowedTypes,
  label = "Drop POS file here or browse",
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string>("");
  const [validationState, setValidationState] =
    useState<ValidationState>("empty");
  const [isDragging, setIsDragging] = useState(false);

  const maxBytes = maxSizeMB * 1024 * 1024;
  const acceptValue = allowedTypes.join(",");

  const validateAndSelect = (file: File) => {
    setSelectedFile(file);
    onFileSelect(file);

    if (!isAllowedType(file, allowedTypes)) {
      setError(`File type must be one of: ${allowedTypes.join(", ")}`);
      setValidationState("invalid");
      return;
    }

    if (file.size > maxBytes) {
      setError(`File size must be ${maxSizeMB} MB or less.`);
      setValidationState("invalid");
      return;
    }

    setError("");
    setValidationState("valid");
  };

  const borderClass =
    validationState === "valid"
      ? "border-emerald-500 bg-emerald-50"
      : validationState === "invalid"
        ? "border-red-500 bg-red-50"
        : isDragging
          ? "border-blue-500 bg-blue-50"
          : "border-slate-300 bg-white";

  return (
    <div>
      <button
        type="button"
        className={`flex min-h-40 w-full flex-col items-center justify-center rounded-md border-2 border-dashed px-6 py-8 text-center transition ${borderClass}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);

          const file = event.dataTransfer.files.item(0);
          if (file) {
            validateAndSelect(file);
          }
        }}
      >
        <span className="text-base font-semibold text-slate-900">
          {label}
        </span>
        <span className="mt-2 text-sm text-slate-600">
          Accepted: {allowedTypes.join(", ")} up to {maxSizeMB} MB
        </span>

        {selectedFile ? (
          <span className="mt-4 rounded-md bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm ring-1 ring-slate-200">
            {selectedFile.name} ({formatFileSize(selectedFile.size)})
          </span>
        ) : null}
      </button>

      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={acceptValue}
        onChange={(event) => {
          const file = event.target.files?.item(0);
          if (file) {
            validateAndSelect(file);
          }
        }}
      />

      {error ? (
        <p className="mt-2 text-sm font-medium text-red-700">{error}</p>
      ) : null}
    </div>
  );
}
