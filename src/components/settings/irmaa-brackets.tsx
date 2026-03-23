"use client";

/** Settings tab for managing Medicare IRMAA surcharge brackets by tax year and filing status, with inline threshold/surcharge editing and year duplication. */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency } from "@/lib/utils/format";

type IrmaaEntry = { magiThreshold: number; annualSurcharge: number };

function formatDollar(v: number): string {
  return formatCurrency(v);
}

function formatMonthly(annual: number): string {
  return formatCurrency(annual / 12) + "/mo";
}

function parseDollar(raw: string): string {
  return raw.replace(/[$,\s]/g, "");
}

export function IrmaaBracketsSettings() {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.settings.irmaaBrackets.list.useQuery();
  const updateMutation = trpc.settings.irmaaBrackets.update.useMutation({
    onSuccess: () => utils.settings.irmaaBrackets.invalidate(),
  });
  const createMutation = trpc.settings.irmaaBrackets.create.useMutation({
    onSuccess: () => utils.settings.irmaaBrackets.invalidate(),
  });
  const deleteMutation = trpc.settings.irmaaBrackets.delete.useMutation({
    onSuccess: () => utils.settings.irmaaBrackets.invalidate(),
  });

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [showAddYear, setShowAddYear] = useState(false);
  const [newYear, setNewYear] = useState("");
  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  if (isLoading)
    return <div className="text-muted">Loading IRMAA tables...</div>;
  if (!data || data.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">
          IRMAA Tables
        </h2>
        <p className="text-muted text-sm mb-3">
          No IRMAA brackets configured.
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
    brackets: IrmaaEntry[],
    bracketIdx: number,
    field: "magiThreshold" | "annualSurcharge",
    rawValue: string,
  ) => {
    const numValue = parseFloat(rawValue);
    if (isNaN(numValue)) return;

    const newBrackets = brackets.map((b, i) =>
      i === bracketIdx ? { ...b, [field]: numValue } : b,
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
          brackets: row.brackets as IrmaaEntry[],
        });
      }
    } else {
      for (const fs of filingStatuses) {
        await createMutation.mutateAsync({
          taxYear: yr,
          filingStatus: fs,
          brackets: [{ magiThreshold: 0, annualSurcharge: 0 }],
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
        <h2 className="text-lg font-semibold">IRMAA Tables</h2>
        <div className="flex items-center gap-2">
          <div
            className="flex gap-1"
            role="tablist"
            aria-label="IRMAA bracket year"
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

      <p className="text-xs text-muted mb-4">
        IRMAA uses a 2-year MAGI lookback — {activeYear} premiums are based
        on {activeYear - 2} MAGI. Surcharges are per-person (Part B + Part D
        combined, above the standard premium). Brackets are cliff-based —
        going $1 over triggers the full surcharge.
      </p>

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
            Delete all {activeYear} IRMAA brackets? This cannot be undone.
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
          const brackets = row.brackets as IrmaaEntry[];

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
                        MAGI Over
                      </th>
                      <th className="text-right pb-1 font-normal">
                        Annual
                      </th>
                      <th className="text-right pb-1 font-normal">
                        Monthly
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {brackets.map((b, i) => (
                      <tr key={i} className="border-t border-subtle">
                        <td className="py-1 pr-2">
                          <InlineEdit
                            value={b.magiThreshold.toString()}
                            formatDisplay={() =>
                              formatDollar(b.magiThreshold)
                            }
                            parseInput={parseDollar}
                            onSave={(v) =>
                              handleBracketUpdate(
                                row.id,
                                brackets,
                                i,
                                "magiThreshold",
                                v,
                              )
                            }
                            type="number"
                            className="text-sm"
                            editable={admin}
                          />
                        </td>
                        <td className="py-1 px-2 text-right">
                          <InlineEdit
                            value={b.annualSurcharge.toString()}
                            formatDisplay={() =>
                              formatDollar(b.annualSurcharge)
                            }
                            parseInput={parseDollar}
                            onSave={(v) =>
                              handleBracketUpdate(
                                row.id,
                                brackets,
                                i,
                                "annualSurcharge",
                                v,
                              )
                            }
                            type="number"
                            className="text-sm"
                            editable={admin}
                          />
                        </td>
                        <td className="py-1 pl-2 text-right text-muted text-xs">
                          {formatMonthly(b.annualSurcharge)}
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
          Source: CMS Medicare Part B/D premium adjustments. Surcharges are
          per person per year.
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
