"use client";

import { useEffect, useState } from "react";
import type { MappingItem, SuggestionItem } from "../types";

interface MappingReviewTableProps {
  suggestions: SuggestionItem[];
  posColumns: string[];
  onConfirm: (mapping: MappingItem[]) => void;
  isConfirming?: boolean;
}

interface MappingDraft {
  inputCol: string;
  transform: string;
}

const TRANSFORM_OPTIONS = [
  { label: "None", value: "" },
  { label: "Text strip", value: "strip" },
  { label: "Number", value: "number" },
  { label: "Date", value: "date" },
];

function confidenceClasses(confidence: number): string {
  if (confidence >= 0.8) {
    return "bg-emerald-100 text-emerald-800 ring-emerald-200";
  }

  if (confidence >= 0.5) {
    return "bg-amber-100 text-amber-900 ring-amber-200";
  }

  return "bg-red-100 text-red-800 ring-red-200";
}

function buildInitialDrafts(
  suggestions: SuggestionItem[],
): Record<string, MappingDraft> {
  return suggestions.reduce<Record<string, MappingDraft>>(
    (drafts, suggestion) => {
      drafts[suggestion.output_col] = {
        inputCol: suggestion.suggested_input_col ?? "",
        transform: "",
      };
      return drafts;
    },
    {},
  );
}

export function MappingReviewTable({
  suggestions,
  posColumns,
  onConfirm,
  isConfirming = false,
}: MappingReviewTableProps) {
  const [drafts, setDrafts] = useState<Record<string, MappingDraft>>(() =>
    buildInitialDrafts(suggestions),
  );

  useEffect(() => {
    setDrafts(buildInitialDrafts(suggestions));
  }, [suggestions]);

  const updateDraft = (
    outputCol: string,
    field: keyof MappingDraft,
    value: string,
  ) => {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [outputCol]: {
        inputCol: currentDrafts[outputCol]?.inputCol ?? "",
        transform: currentDrafts[outputCol]?.transform ?? "",
        [field]: value,
      },
    }));
  };

  const handleConfirm = () => {
    const mapping = suggestions.map<MappingItem>((suggestion) => {
      const draft = drafts[suggestion.output_col] ?? {
        inputCol: "",
        transform: "",
      };

      if (!draft.inputCol) {
        return {
          output_col: suggestion.output_col,
          source: "hardcoded",
          value: "",
        };
      }

      return {
        output_col: suggestion.output_col,
        source: "direct",
        input_col: draft.inputCol,
        ...(draft.transform ? { transform: draft.transform } : {}),
      };
    });

    onConfirm(mapping);
  };

  return (
    <section aria-labelledby="mapping-review-title" className="space-y-4">
      <div>
        <h2
          id="mapping-review-title"
          className="text-base font-semibold text-black"
        >
          Mapping Review
        </h2>
        <p className="text-sm text-zinc-600">
          {suggestions.length} output columns
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-300 bg-white">
        <div className="max-h-[520px] overflow-auto">
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-100">
              <tr>
                <th
                  scope="col"
                  className="whitespace-nowrap border-b border-r border-zinc-300 px-3 py-2 font-semibold text-zinc-700"
                >
                  Output Column
                </th>
                <th
                  scope="col"
                  className="whitespace-nowrap border-b border-r border-zinc-300 px-3 py-2 font-semibold text-zinc-700"
                >
                  Suggested POS Column
                </th>
                <th
                  scope="col"
                  className="whitespace-nowrap border-b border-r border-zinc-300 px-3 py-2 font-semibold text-zinc-700"
                >
                  Confidence
                </th>
                <th
                  scope="col"
                  className="whitespace-nowrap border-b border-zinc-300 px-3 py-2 font-semibold text-zinc-700"
                >
                  Transform
                </th>
              </tr>
            </thead>

            <tbody>
              {suggestions.map((suggestion) => {
                const draft = drafts[suggestion.output_col] ?? {
                  inputCol: "",
                  transform: "",
                };
                const isLowConfidence = suggestion.confidence < 0.5;

                return (
                  <tr
                    key={suggestion.output_col}
                    className={isLowConfidence ? "bg-amber-50" : "even:bg-zinc-50"}
                  >
                    <td className="whitespace-nowrap border-b border-r border-zinc-100 px-3 py-2 font-medium text-black">
                      {suggestion.output_col}
                    </td>
                    <td className="border-b border-r border-zinc-100 px-3 py-2">
                      <select
                        value={draft.inputCol}
                        onChange={(event) =>
                          updateDraft(
                            suggestion.output_col,
                            "inputCol",
                            event.target.value,
                          )
                        }
                        className="w-full min-w-48 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-black outline-none transition focus:border-black focus:ring-2 focus:ring-zinc-200"
                      >
                        <option value="">No source / blank</option>
                        {posColumns.map((column) => (
                          <option key={column} value={column}>
                            {column}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="border-b border-r border-zinc-100 px-3 py-2">
                      <div className="space-y-1">
                        <span
                          className={`inline-flex min-w-16 items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${confidenceClasses(
                            suggestion.confidence,
                          )}`}
                        >
                          {Math.round(suggestion.confidence * 100)}%
                        </span>
                        <p className="max-w-64 text-xs text-zinc-500">
                          {suggestion.match_reason}
                        </p>
                      </div>
                    </td>
                    <td className="border-b border-zinc-100 px-3 py-2">
                      <select
                        value={draft.transform}
                        onChange={(event) =>
                          updateDraft(
                            suggestion.output_col,
                            "transform",
                            event.target.value,
                          )
                        }
                        className="w-full min-w-36 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-black outline-none transition focus:border-black focus:ring-2 focus:ring-zinc-200"
                      >
                        {TRANSFORM_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <button
        type="button"
        disabled={isConfirming}
        onClick={handleConfirm}
        className="inline-flex min-h-10 items-center justify-center rounded-lg bg-black px-5 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600"
      >
        {isConfirming ? (
          <>
            <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Applying
          </>
        ) : (
          "Apply Mapping"
        )}
      </button>
    </section>
  );
}
