"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ActionButton,
  AppShell,
  Message,
  Panel,
  SkeletonLine,
  TableCell,
  TableFrame,
  TableHeaderCell,
} from "../../components/ui";

type DefaultValueType = "string" | "int" | "float";

interface ColumnDefault {
  column_name: string;
  default_value: string;
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

function inputType(valueType: DefaultValueType): "number" | "text" {
  return valueType === "string" ? "text" : "number";
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

export default function DefaultSettingsPage() {
  const [defaults, setDefaults] = useState<ColumnDefault[]>([]);
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [savingColumn, setSavingColumn] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDefaults = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/defaults", {
        cache: "no-store",
      });

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
  }, []);

  useEffect(() => {
    void loadDefaults();
  }, [loadDefaults]);

  const startEdit = (item: ColumnDefault) => {
    setEditingColumn(item.column_name);
    setDraftValue(item.default_value);
    setError("");
    setNotice("");
  };

  const cancelEdit = () => {
    setEditingColumn(null);
    setDraftValue("");
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
        `/api/admin/defaults/${encodeURIComponent(item.column_name)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ default_value: draftValue }),
        },
      );

      if (!response.ok) {
        setError(await getErrorMessage(response));
        return;
      }

      const payload = (await response.json()) as DefaultUpdateResponse;
      setDefaults((currentDefaults) =>
        currentDefaults.map((current) =>
          current.column_name === item.column_name ? payload.default : current,
        ),
      );
      setEditingColumn(null);
      setDraftValue("");
      setNotice(`${item.column_name} default saved.`);
    } catch {
      setError("Default save failed. Check that the backend server is running.");
    } finally {
      setSavingColumn(null);
    }
  };

  return (
    <AppShell title="Default Settings" actionHref="/" actionLabel="Back">
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
              Values used when an uploaded file does not include an ERP column.
            </p>
          </div>
          <ActionButton
            variant="secondary"
            onClick={() => void loadDefaults()}
            disabled={isLoading}
          >
            {isLoading ? "Refreshing" : "Refresh"}
          </ActionButton>
        </div>

        <TableFrame>
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                <TableHeaderCell>Column Name</TableHeaderCell>
                <TableHeaderCell>Current Default</TableHeaderCell>
                <TableHeaderCell>Value Type</TableHeaderCell>
                <TableHeaderCell>Action</TableHeaderCell>
              </tr>
            </thead>
            <tbody className="bg-white">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, index) => (
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
                      <div className="h-9 w-16 rounded-lg border border-zinc-200 bg-white" />
                    </TableCell>
                  </tr>
                ))
              ) : defaults.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
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
                    <tr key={item.column_name} className="bg-white hover:bg-zinc-50">
                      <TableCell className="whitespace-nowrap font-semibold text-black">
                        {item.column_name}
                      </TableCell>
                      <TableCell className="min-w-56">
                        {isEditing ? (
                          <input
                            type={inputType(item.value_type)}
                            step={inputStep(item.value_type)}
                            value={draftValue}
                            onChange={(event) =>
                              setDraftValue(event.target.value)
                            }
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-black focus:ring-2 focus:ring-zinc-200"
                          />
                        ) : (
                          item.default_value
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="inline-flex rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-semibold text-black">
                          {item.value_type}
                        </span>
                      </TableCell>
                      <TableCell className="min-w-44">
                        {isEditing ? (
                          <div className="flex flex-wrap gap-2">
                            <ActionButton
                              onClick={() => void saveDefault(item)}
                              disabled={savingColumn !== null}
                              className="min-h-9 px-3 py-1.5 text-xs"
                            >
                              {isSaving ? "Saving" : "Save"}
                            </ActionButton>
                            <ActionButton
                              variant="secondary"
                              onClick={cancelEdit}
                              disabled={savingColumn !== null}
                              className="min-h-9 px-3 py-1.5 text-xs"
                            >
                              Cancel
                            </ActionButton>
                          </div>
                        ) : (
                          <ActionButton
                            variant="secondary"
                            onClick={() => startEdit(item)}
                            disabled={savingColumn !== null}
                            className="min-h-9 px-3 py-1.5 text-xs"
                          >
                            Edit
                          </ActionButton>
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
