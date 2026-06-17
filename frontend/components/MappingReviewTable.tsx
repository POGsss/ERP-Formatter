"use client";

import { useEffect, useState } from "react";
import type { MappingItem, SuggestionItem } from "../types";
import {
  ActionButton,
  SelectInput,
  TableFrame,
  TableHeaderCell,
} from "./ui";

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
    return "bg-black text-white ring-black";
  }

  if (confidence >= 0.5) {
    return "bg-zinc-100 text-black ring-zinc-300";
  }

  return "bg-white text-black ring-zinc-500";
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
    <section aria-labelledby="mapping-review-title">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="mapping-review-title"
            className="text-base font-semibold text-black"
          >
            Mapping Review
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            {suggestions.length} output columns
          </p>
        </div>
        <ActionButton
          disabled={isConfirming}
          onClick={handleConfirm}
        >
          {isConfirming ? "Applying" : "Apply Mapping"}
        </ActionButton>
      </div>

      <TableFrame>
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <TableHeaderCell>Output Column</TableHeaderCell>
              <TableHeaderCell>Suggested POS Column</TableHeaderCell>
              <TableHeaderCell>Confidence</TableHeaderCell>
              <TableHeaderCell>Transform</TableHeaderCell>
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
                  className={isLowConfidence ? "bg-zinc-100" : "bg-white hover:bg-zinc-50"}
                >
                  <td className="whitespace-nowrap border-b border-r border-zinc-100 px-3 py-2 font-medium text-black">
                    {suggestion.output_col}
                  </td>
                  <td className="border-b border-r border-zinc-100 px-3 py-2">
                    <SelectInput
                      value={draft.inputCol}
                      onChange={(event) =>
                        updateDraft(
                          suggestion.output_col,
                          "inputCol",
                          event.target.value,
                        )
                      }
                      className="min-w-48"
                    >
                      <option value="">No source / blank</option>
                      {posColumns.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </SelectInput>
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
                    <SelectInput
                      value={draft.transform}
                      onChange={(event) =>
                        updateDraft(
                          suggestion.output_col,
                          "transform",
                          event.target.value,
                        )
                      }
                      className="min-w-36"
                    >
                      {TRANSFORM_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </SelectInput>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
    </section>
  );
}
