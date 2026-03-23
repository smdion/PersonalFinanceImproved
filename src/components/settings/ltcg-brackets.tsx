"use client";

/** Settings tab for managing long-term capital gains tax brackets by tax year and filing status, with inline threshold/rate editing and year duplication. */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

type LtcgEntry = { threshold: number | null; rate: number };

function formatDollar(v: number | null): string {
  if (v === null) return "∞";
  return formatCurrency(v);
}

function formatRate(v: number): string {
  return formatPercent(v, 1);
}

function parseDollar(raw: string): string {
  return raw.replace(/[$,\s]/g, "");
}

function parseRate(raw: string): string {
  return raw.replace(/%/g, "").trim();
}

export function LtcgBracketsSettings() {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.settings.ltcgBrackets.list.useQuery();
  const updateMutation = trpc.settings.ltcgBrackets.update.useMutation({
    onSuccess: () => utils.settings.ltcgBrackets.invalidate(),
  });
  const createMutation = trpc.settings.ltcgBrackets.create.useMutation({
    onSuccess: () => utils.settings.ltcgBrackets.invalidate(),
  });
  const deleteMutation = trpc.settings.ltcgBrackets.delete.useMutation({
    onSuccess: () => utils.settings.ltcgBrackets.invalidate(),
  });

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [showAddYear, setShowAddYear] = useState(false);
  const [newYear, setNewYear] = useState("");
  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  if (isLoading)
    return <div className="text-muted">Loading LTCG brackets...</div>;
  if (!data || data.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">
          Long-Term Capital Gains Brackets
        </h2>
        <p className="text-muted text-sm mb-3">
          No LTCG brackets configured.
        </p>
        {admin && (
          <button
            onClick={() => setShowAddYear(true)}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            + Add year
          </button>
        )}
      </div>
    );
  }

  const years = Array.from(new Set(data.map((r) => r.taxYear))).sort(
    (a, b) => b - a,
  );
  const activeYear = selectedYear ?? years[0]!;
  const yearData = data.filter((r) => r.taxYear === activeYear);

  const filingStatuses = ["MFJ", "Single", "HOH"] as const;
  const statusLabels: Record<string, string> = {
    MFJ: "Married Filing Jointly",
    Single: "Single",
    HOH: "Head of Household",
  };

  const handleBracketUpdate = (
    rowId: number,
    brackets: LtcgEntry[],
    bracketIdx: number,
    field: "threshold" | "rate",
    rawValue: string,
  ) => {
    const numValue = parseFloat(rawValue);
    if (isNaN(numValue)) return;

    const newBrackets = brackets.map((b, i) =>
      i === bracketIdx
        ? {
            ...b,
            [field]: field === "rate" ? numValue / 100 : numValue,
          }
        : b,
    );

    const row = yearData.find((r) => r.id === rowId);
    if (!row) return;
    updateMutation.mutate({
      id: rowId,
      taxYear: row.taxYear,
      filingStatus: row.filingStatus as "MFJ" | "Single" | "HOH",
      brackets: newBrackets,
    });
  };

  const handleAddYear = async () => {
    const yr = parseInt(newYear);
    if (isNaN(yr) || yr < 2020 || yr > 2040) return;
    if (years.includes(yr)) return;

    if (copyFrom) {
      const sourceData = data.filter((r) => r.taxYear === copyFrom);
      for (const row of sourceData) {
        await createMutation.mutateAsync({
          taxYear: yr,
          filingStatus: row.filingStatus as "MFJ" | "Single" | "HOH",
          brackets: row.brackets as LtcgEntry[],
        });
      }
    } else {
      for (const fs of filingStatuses) {
        await createMutation.mutateAsync({
          taxYear: yr,
          filingStatus: fs,
          brackets: [
            { threshold: 0, rate: 0 },
            { threshold: 0, rate: 0.15 },
            { threshold: null, rate: 0.2 },
          ],
        });
      }
    }

    setSelectedYear(yr);
    setShowAddYear(false);
    setNewYear("");
    setCopyFrom(null);
  };

  const handleDeleteYear = async (yr: number) => {
    const toDelete = data.filter((r) => r.taxYear === yr);
    for (const row of toDelete) {
      await deleteMutation.mutateAsync({ id: row.id });
    }
    setConfirmDelete(null);
    if (activeYear === yr) setSelectedYear(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          Long-Term Capital Gains Brackets
        </h2>
        <div className="flex items-center gap-2">
          <div
            className="flex gap-1"
            role="tablist"
            aria-label="LTCG bracket year"
          >
            {years.map((yr) => (
              <button
                key={yr}
                role="tab"
                aria-selected={yr === activeYear}
                onClick={() => setSelectedYear(yr)}
                className={`px-3 py-1 text-sm rounded-full transition-colors ${
                  yr === activeYear
                    ? "bg-blue-600 text-white"
                    : "bg-surface-elevated text-muted hover:bg-surface-strong"
                }`}
              >
                {yr}
              </button>
            ))}
          </div>
          {admin && (
            <button
              onClick={() => {
                setShowAddYear(!showAddYear);
                setNewYear(
                  String((years[0] ?? new Date().getFullYear()) + 1),
                );
                setCopyFrom(years[0] ?? null);
              }}
              className="px-2 py-1 text-sm text-blue-600 hover:text-blue-800 border border-blue-200 rounded-full hover:bg-blue-50 transition-colors"
            >
              + Year
            </button>
          )}
        </div>
      </div>

      {/* Add year dialog */}
      {showAddYear && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-3">
            <label className="text-sm text-secondary">
              Year:
              <input
                type="number"
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
                className="ml-2 w-20 px-2 py-1 text-sm border rounded"
              />
            </label>
            <label className="text-sm text-secondary">
              Copy from:
              <select
                value={copyFrom ?? ""}
                onChange={(e) =>
                  setCopyFrom(
                    e.target.value ? parseInt(e.target.value) : null,
                  )
                }
                className="ml-2 px-2 py-1 text-sm border rounded"
              >
                <option value="">Empty brackets</option>
                {years.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={handleAddYear}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Add
            </button>
            <button
              onClick={() => setShowAddYear(false)}
              className="px-3 py-1 text-sm text-muted hover:text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Delete year confirmation */}
      {confirmDelete === activeYear && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <span className="text-sm text-red-800">
            Delete all {activeYear} LTCG brackets? This cannot be undone.
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => handleDeleteYear(activeYear)}
              className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(null)}
              className="px-3 py-1 text-sm text-muted hover:text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {filingStatuses.map((status) => {
          const row = yearData.find((r) => r.filingStatus === status);
          if (!row) return null;
          const brackets = row.brackets as LtcgEntry[];

          return (
            <div key={status} className="border rounded-lg overflow-hidden">
              <div className="bg-surface-sunken px-4 py-2 border-b">
                <h3 className="font-medium text-primary">
                  {statusLabels[status]}
                </h3>
              </div>
              <div className="p-3">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-xs text-muted">
                      <th className="text-left pb-1 font-normal">
                        Up To
                      </th>
                      <th className="text-right pb-1 font-normal">
                        Rate
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {brackets.map((b, i) => (
                      <tr key={i} className="border-t border-subtle">
                        <td className="py-1 pr-2">
                          {b.threshold === null ? (
                            <span className="text-sm text-muted">
                              Above
                            </span>
                          ) : (
                            <InlineEdit
                              value={b.threshold.toString()}
                              formatDisplay={() =>
                                formatDollar(b.threshold)
                              }
                              parseInput={parseDollar}
                              onSave={(v) =>
                                handleBracketUpdate(
                                  row.id,
                                  brackets,
                                  i,
                                  "threshold",
                                  v,
                                )
                              }
                              type="number"
                              className="text-sm"
                              editable={admin}
                            />
                          )}
                        </td>
                        <td className="py-1 pl-2 text-right">
                          <InlineEdit
                            value={(b.rate * 100).toFixed(1)}
                            formatDisplay={() => formatRate(b.rate)}
                            parseInput={parseRate}
                            onSave={(v) =>
                              handleBracketUpdate(
                                row.id,
                                brackets,
                                i,
                                "rate",
                                v,
                              )
                            }
                            type="number"
                            className="text-sm"
                            editable={admin}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-4">
        <p className="text-xs text-faint">
          Source: IRS Revenue Procedure (adjusted annually for inflation).
          Rates apply to long-term gains based on total taxable income. Edit
          rates as percentages (e.g., enter 15 for 15%).
        </p>
        {admin && years.length > 1 && confirmDelete !== activeYear && (
          <button
            onClick={() => setConfirmDelete(activeYear)}
            className="text-xs text-red-500 hover:text-red-700"
          >
            Delete {activeYear}
          </button>
        )}
      </div>
    </div>
  );
}
