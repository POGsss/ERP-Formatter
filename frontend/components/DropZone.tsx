"use client";

import { useRef, useState } from "react";

interface DropZoneProps {
  onFileSelect: (file: File) => void;
  maxSizeMB: number;
  allowedTypes: string[];
  buttonClassName?: string;
  className?: string;
  compact?: boolean;
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
  buttonClassName = "",
  className = "",
  compact = false,
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
  const isPrimaryDropZone = !compact && label === "Drop POS file here or browse";

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
      ? "border-black bg-white"
      : validationState === "invalid"
        ? "border-zinc-500 bg-zinc-100"
        : isDragging
          ? "border-black bg-zinc-50"
          : "border-zinc-300 bg-white";

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        className={`flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-6 text-center transition ${
          compact
            ? "min-h-0 overflow-hidden py-3"
            : isPrimaryDropZone
              ? "min-h-72 py-10"
              : "min-h-32 py-6"
        } ${borderClass} ${buttonClassName}`}
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
        <span
          aria-hidden="true"
          className={`flex items-center justify-center rounded-full border border-zinc-300 text-zinc-400 ${
            compact ? "mb-2 h-8 w-8" : "mb-3 h-10 w-10"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className={compact ? "h-5 w-5" : "h-6 w-6"}
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          >
            <path d="M12 16V4" />
            <path d="m7 9 5-5 5 5" />
            <path d="M20 16.5v1.75A1.75 1.75 0 0 1 18.25 20H5.75A1.75 1.75 0 0 1 4 18.25V16.5" />
          </svg>
        </span>
        <span className={`${compact ? "text-xs" : "text-sm"} font-semibold text-black`}>
          {label}
        </span>
        <span className={`${compact ? "mt-1" : "mt-2"} text-xs font-medium text-zinc-500`}>
          Accepted: {allowedTypes.join(", ")} up to {maxSizeMB} MB
        </span>

        {selectedFile ? (
          <span
            className={`max-w-full truncate rounded-lg bg-zinc-100 font-medium text-black ring-1 ring-zinc-200 ${
              compact ? "mt-2 px-2 py-1 text-xs" : "mt-4 px-3 py-2 text-sm"
            }`}
          >
            {selectedFile.name} ({formatFileSize(selectedFile.size)})
          </span>
        ) : null}

        {compact && error ? (
          <span className="mt-1 max-w-full truncate text-xs font-medium text-zinc-700">
            {error}
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

      {!compact && error ? (
        <p className="mt-2 text-sm font-medium text-zinc-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
