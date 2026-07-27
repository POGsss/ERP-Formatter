"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, X } from "lucide-react";
import {
  ActionButton,
  AppShell,
  Message,
  Panel,
  SelectInput,
  SkeletonLine,
  TableCell,
  TableFrame,
  TableHeaderCell,
  TextInput,
} from "../../components/ui";
import type { Template } from "../../types";

type DefaultValueType = "string" | "int" | "float" | "date" | "formula";

const DEFAULT_VALUE_TYPES: DefaultValueType[] = [
  "string",
  "int",
  "float",
  "date",
  "formula",
];
const DEFAULT_TEMPLATE_KEY = "old_pos";
const TEMPLATE_STORAGE_KEY = "erp-formatter-active-template";

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

interface ColumnDefault {
  column_name: string;
  default_value: string;
  value?: string;
  value_type: DefaultValueType;
  description: string | null;
  updated_at: string;
}

interface DefaultsResponse {
  defaults: ColumnDefault[];
}

interface DefaultUpdateResponse {
  default: ColumnDefault;
}

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      detail?: string;
      error?: string;
    };

    return payload.detail || payload.error || "Request failed.";
  } catch {
    return "Request failed.";
  }
}

function inputType(valueType: DefaultValueType): "number" | "text" | "date" {
  if (valueType === "int" || valueType === "float") {
    return "number";
  }

  if (valueType === "date") {
    return "date";
  }

  return "text";
}

function inputStep(valueType: DefaultValueType): string | undefined {
  if (valueType === "float") {
    return "any";
  }

  if (valueType === "int") {
    return "1";
  }

  return undefined;
}

function coerceDraftValueForType(value: string, valueType: DefaultValueType): string {
  const trimmedValue = value.trim();

  if (valueType === "formula") {
    return value;
  }

  if (valueType === "int") {
    const parsedValue = Number.parseInt(trimmedValue, 10);
    return Number.isNaN(parsedValue) ? "0" : String(parsedValue);
  }

  if (valueType === "float") {
    const parsedValue = Number.parseFloat(trimmedValue);
    return Number.isNaN(parsedValue) ? "0" : String(parsedValue);
  }

  return value;
}

function inputValue(value: string, valueType: DefaultValueType): string {
  if (valueType === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "";
  }

  return value;
}

function currentValue(item: ColumnDefault): string {
  return item.value ?? item.default_value;
}

function displayCurrentValue(item: ColumnDefault): string {
  if (item.value_type === "formula") {
    return "System calculated";
  }

  return currentValue(item);
}

function savedTemplateKey(templates: Template[]): string | null {
  try {
    const savedKey = window.localStorage.getItem(TEMPLATE_STORAGE_KEY);
    return templates.some((template) => template.key === savedKey)
      ? savedKey
      : null;
  } catch {
    return null;
  }
}

function saveTemplateKey(templateKey: string): void {
  try {
    window.localStorage.setItem(TEMPLATE_STORAGE_KEY, templateKey);
  } catch {
    // The selector still works for the current page when storage is unavailable.
  }
}

export default function DefaultSettingsPage() {
  const [templates, setTemplates] = useState<Template[]>(FALLBACK_TEMPLATES);
  const [selectedTemplate, setSelectedTemplate] = useState(DEFAULT_TEMPLATE_KEY);
  const [templatesReady, setTemplatesReady] = useState(false);
  const [defaults, setDefaults] = useState<ColumnDefault[]>([]);
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [draftValueType, setDraftValueType] =
    useState<DefaultValueType>("string");
  const [isLoading, setIsLoading] = useState(true);
  const [savingColumn, setSavingColumn] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
        savedTemplateKey(availableTemplates) ??
          availableTemplates.find((template) => template.is_default)?.key ??
          availableTemplates[0]?.key ??
          DEFAULT_TEMPLATE_KEY,
      );
    } catch {
      setTemplates(FALLBACK_TEMPLATES);
      setSelectedTemplate(
        savedTemplateKey(FALLBACK_TEMPLATES) ??
          FALLBACK_TEMPLATES.find((template) => template.is_default)?.key ??
          DEFAULT_TEMPLATE_KEY,
      );
    } finally {
      setTemplatesReady(true);
    }
  }, []);

  const loadDefaults = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/admin/defaults?template=${encodeURIComponent(selectedTemplate)}`,
        {
          cache: "no-store",
        },
      );

      if (!response.ok) {
        setError(await getErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as DefaultsResponse;
      setDefaults(payload.defaults ?? []);
    } catch {
      setError("Defaults failed to load. Check that the backend server is running.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedTemplate]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (templatesReady) {
      void loadDefaults();
    }
  }, [loadDefaults, templatesReady]);

  const handleTemplateChange = (templateKey: string) => {
    cancelEdit();
    setSelectedTemplate(templateKey);
    saveTemplateKey(templateKey);
    setNotice("");
  };

  const startEdit = (item: ColumnDefault) => {
    setEditingColumn(item.column_name);
    setDraftValue(currentValue(item));
    setDraftValueType(item.value_type);
    setError("");
    setNotice("");
  };

  const cancelEdit = () => {
    setEditingColumn(null);
    setDraftValue("");
    setDraftValueType("string");
  };

  const saveDefault = async (item: ColumnDefault) => {
    if (savingColumn !== null) {
      return;
    }

    setSavingColumn(item.column_name);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `/api/admin/defaults/${encodeURIComponent(
          item.column_name,
        )}?template=${encodeURIComponent(selectedTemplate)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            value: draftValue,
            value_type: draftValueType,
          }),
        },
      );

      if (!response.ok) {
        setError(await getErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as DefaultUpdateResponse;
      void payload;
      setEditingColumn(null);
      setDraftValue("");
      setDraftValueType("string");
      setNotice(`${item.column_name} default saved.`);
      await loadDefaults();
    } catch {
      setError("Default save failed. Check that the backend server is running.");
    } finally {
      setSavingColumn(null);
    }
  };

  const activeTemplate =
    templates.find((template) => template.key === selectedTemplate) ??
    FALLBACK_TEMPLATES[0];
  const skeletonRowCount = selectedTemplate === "new_pos" ? 11 : 12;

  return (
    <AppShell title="Settings" actionHref="/" actionLabel="Back">
      {(error || notice) ? (
        <section className="grid gap-3">
          {error ? <Message tone="error">{error}</Message> : null}
          {notice ? <Message tone="success">{notice}</Message> : null}
        </section>
      ) : null}

      <Panel>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-black">
              ERP Default Values
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              Configure Sale Invoice output columns independently for {activeTemplate.label}.
            </p>
          </div>
          <SelectInput
            aria-label="Template"
            value={selectedTemplate}
            onChange={(event) => handleTemplateChange(event.target.value)}
            disabled={!templatesReady || isLoading || savingColumn !== null}
          >
            {templates.map((template) => (
              <option key={template.key} value={template.key}>
                {template.label}
              </option>
            ))}
          </SelectInput>
        </div>

        <TableFrame fitContent>
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                <TableHeaderCell>Column Name</TableHeaderCell>
                <TableHeaderCell>Current Value</TableHeaderCell>
                <TableHeaderCell>Value Type</TableHeaderCell>
                <TableHeaderCell>Origin Description</TableHeaderCell>
                <TableHeaderCell className="text-center">Action</TableHeaderCell>
              </tr>
            </thead>
            <tbody className="bg-white">
              {isLoading ? (
                Array.from({ length: skeletonRowCount }).map((_, index) => (
                  <tr key={index}>
                    <TableCell>
                      <SkeletonLine className="h-4 w-40" />
                    </TableCell>
                    <TableCell>
                      <SkeletonLine className="h-4 w-32" />
                    </TableCell>
                    <TableCell>
                      <SkeletonLine className="h-4 w-20" />
                    </TableCell>
                    <TableCell>
                      <SkeletonLine className="h-4 w-56" />
                    </TableCell>
                    <TableCell>
                      <div className="h-9 w-16 rounded-lg border border-zinc-200 bg-white" />
                    </TableCell>
                  </tr>
                ))
              ) : defaults.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-sm font-medium text-zinc-500"
                  >
                    No configurable defaults found.
                  </td>
                </tr>
              ) : (
                defaults.map((item) => {
                  const isEditing = editingColumn === item.column_name;
                  const isSaving = savingColumn === item.column_name;

                  return (
                    <tr
                      key={item.column_name}
                      className="h-[60px] bg-white align-middle hover:bg-zinc-50"
                    >
                      <TableCell className="whitespace-nowrap font-semibold text-black">
                        {item.column_name}
                      </TableCell>
                      <TableCell className="min-w-56">
                        {isEditing ? (
                          <div className="grid gap-2">
                            <TextInput
                              type={inputType(draftValueType)}
                              step={inputStep(draftValueType)}
                              value={
                                draftValueType === "formula"
                                  ? ""
                                  : inputValue(draftValue, draftValueType)
                              }
                              disabled={draftValueType === "formula"}
                              onChange={(event) =>
                                setDraftValue(event.target.value)
                              }
                              className="w-full"
                            />
                          </div>
                        ) : (
                          displayCurrentValue(item)
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {isEditing ? (
                          <SelectInput
                            value={draftValueType}
                            onChange={(event) => {
                              const nextValueType = event.target.value as DefaultValueType;
                              setDraftValueType(nextValueType);
                              setDraftValue((currentValue) =>
                                coerceDraftValueForType(currentValue, nextValueType),
                              );
                            }}
                          >
                            {DEFAULT_VALUE_TYPES.map((valueType) => (
                              <option key={valueType} value={valueType}>
                                {valueType}
                              </option>
                            ))}
                          </SelectInput>
                        ) : (
                          <span className="inline-flex rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-semibold text-black">
                            {item.value_type}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="min-w-72 text-zinc-600">
                        {item.description || "No description available."}
                      </TableCell>
                      <TableCell className="min-w-44 text-center">
                        {isEditing ? (
                          <div className="flex flex-nowrap justify-center gap-2">
                            <ActionButton
                              onClick={() => void saveDefault(item)}
                              disabled={savingColumn !== null}
                              className="min-h-9 px-3 py-1.5 text-xs"
                            >
                              {isSaving ? "Saving" : "Save"}
                            </ActionButton>
                            <button
                              type="button"
                              aria-label="Cancel"
                              title="Cancel"
                              onClick={cancelEdit}
                              disabled={savingColumn !== null}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 bg-white text-black transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                            >
                              <X aria-hidden="true" className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            aria-label="Edit"
                            title="Edit"
                            onClick={() => startEdit(item)}
                            disabled={savingColumn !== null}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 bg-white text-black transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                          >
                            <Pencil aria-hidden="true" className="h-4 w-4" />
                          </button>
                        )}
                      </TableCell>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableFrame>
      </Panel>
    </AppShell>
  );
}
