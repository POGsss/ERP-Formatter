"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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

export default function AdminSettingsPage() {
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
    <div className="min-h-[calc(100vh-3.5rem)] bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal text-slate-950">
              Configurable Defaults
            </h1>
            <p className="mt-2 text-base text-slate-600">
              Manage ERP values used when POS exports do not provide the field.
            </p>
          </div>
          <Link
            href="/admin"
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Back to Admin
          </Link>
        </div>
      </header>

      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <p className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            These values are used when the POS file has no data for this column.
            Update them once you have access to the ERP.
          </p>

          {error ? (
            <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {error}
            </p>
          ) : null}

          {notice ? (
            <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
              {notice}
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-normal text-slate-600">
                <tr>
                  <th className="px-4 py-3">Column Name</th>
                  <th className="px-4 py-3">Current Default</th>
                  <th className="px-4 py-3">Value Type</th>
                  <th className="px-4 py-3">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {isLoading ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      Loading defaults
                    </td>
                  </tr>
                ) : defaults.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      No configurable defaults found.
                    </td>
                  </tr>
                ) : (
                  defaults.map((item) => {
                    const isEditing = editingColumn === item.column_name;
                    const isSaving = savingColumn === item.column_name;

                    return (
                      <tr key={item.column_name} className="align-middle">
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-950">
                          {item.column_name}
                        </td>
                        <td className="min-w-56 px-4 py-3 text-slate-700">
                          {isEditing ? (
                            <input
                              type={inputType(item.value_type)}
                              step={inputStep(item.value_type)}
                              value={draftValue}
                              onChange={(event) =>
                                setDraftValue(event.target.value)
                              }
                              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                          ) : (
                            item.default_value
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">
                            {item.value_type}
                          </span>
                        </td>
                        <td className="min-w-48 px-4 py-3">
                          {isEditing ? (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void saveDefault(item)}
                                disabled={savingColumn !== null}
                                className="inline-flex min-h-9 items-center justify-center rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
                              >
                                {isSaving ? "Saving" : "Save"}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                disabled={savingColumn !== null}
                                className="inline-flex min-h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEdit(item)}
                              disabled={savingColumn !== null}
                              className="inline-flex min-h-9 items-center justify-center rounded-md border border-blue-700 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400"
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
