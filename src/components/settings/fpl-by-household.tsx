"use client";

/** Settings tab for managing the ACA Federal Poverty Level table by tax year and household size, with inline dollar-amount editing and year duplication. */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils/format";
import { TAX_YEAR_MIN, TAX_YEAR_MAX } from "@/lib/constants";
import { YearSelector } from "@/components/settings/year-selector";

const HOUSEHOLD_SIZES = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

function parseDollar(raw: string): string {
  return raw.replace(/[$,\s]/g, "");
}

export function FplByHouseholdSettings() {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.settings.fplByHousehold.list.useQuery();
  const updateMutation = trpc.settings.fplByHousehold.update.useMutation({
    onSuccess: () => utils.settings.fplByHousehold.invalidate(),
  });
  const createMutation = trpc.settings.fplByHousehold.create.useMutation({
    onSuccess: () => utils.settings.fplByHousehold.invalidate(),
  });
  const deleteMutation = trpc.settings.fplByHousehold.delete.useMutation({
    onSuccess: () => utils.settings.fplByHousehold.invalidate(),
  });

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [showAddYear, setShowAddYear] = useState(false);
  const [newYear, setNewYear] = useState("");
  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  if (isLoading) return <Skeleton className="h-6 w-48" />;
  if (!data || data.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">
          ACA Federal Poverty Level
        </h2>
        <p className="text-muted text-sm mb-3">No FPL table configured.</p>
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
  const row = data.find((r) => r.taxYear === activeYear);
  const amounts = (row?.amounts ?? {}) as Record<string, number>;

  const handleAmountUpdate = (size: string, rawValue: string) => {
    const numValue = parseFloat(rawValue);
    if (isNaN(numValue) || !row) return;
    updateMutation.mutate({
      id: row.id,
      taxYear: row.taxYear,
      amounts: { ...amounts, [size]: numValue } as Record<
        "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8",
        number
      >,
    });
  };

  const handleAddYear = async () => {
    const yr = parseInt(newYear);
    if (isNaN(yr) || yr < TAX_YEAR_MIN || yr > TAX_YEAR_MAX) return;
    if (years.includes(yr)) return;

    const sourceAmounts = copyFrom
      ? ((data.find((r) => r.taxYear === copyFrom)?.amounts ?? {}) as Record<
          string,
          number
        >)
      : {};
    await createMutation.mutateAsync({
      taxYear: yr,
      amounts: Object.fromEntries(
        HOUSEHOLD_SIZES.map((s) => [s, sourceAmounts[s] ?? 0]),
      ) as Record<"1" | "2" | "3" | "4" | "5" | "6" | "7" | "8", number>,
    });

    setSelectedYear(yr);
    setShowAddYear(false);
    setNewYear("");
    setCopyFrom(null);
  };

  const handleDeleteYear = async (yr: number) => {
    const toDelete = data.find((r) => r.taxYear === yr);
    if (toDelete) await deleteMutation.mutateAsync({ id: toDelete.id });
    setConfirmDelete(null);
    if (activeYear === yr) setSelectedYear(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">ACA Federal Poverty Level</h2>
        <YearSelector
          years={years}
          activeYear={activeYear}
          onSelectYear={setSelectedYear}
          admin={admin}
          ariaLabel="FPL year"
          onAddYearClick={() => {
            setShowAddYear(!showAddYear);
            setNewYear(String((years[0] ?? new Date().getFullYear()) + 1));
            setCopyFrom(years[0] ?? null);
          }}
        />
      </div>

      <p className="text-xs text-muted mb-4">
        Coverage-year FPL — HHS publishes these guidelines the PRIOR calendar
        year. Determines the 400% FPL ACA subsidy cliff (4× the
        household&rsquo;s figure below).
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
                  setCopyFrom(e.target.value ? parseInt(e.target.value) : null)
                }
                className="ml-2 px-2 py-1 text-sm border rounded"
              >
                <option value="">All zero</option>
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
            Delete the {activeYear} FPL table? This cannot be undone.
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

      <div className="border rounded-lg overflow-hidden">
        <div className="bg-surface-sunken px-4 py-2 border-b">
          <h3 className="font-medium text-primary">By Household Size</h3>
        </div>
        <div className="p-3 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-xs text-muted">
                {HOUSEHOLD_SIZES.map((s) => (
                  <th key={s} className="text-right pb-1 px-2 font-normal">
                    {s} {s === "1" ? "person" : "people"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-subtle">
                {HOUSEHOLD_SIZES.map((s) => (
                  <td key={s} className="py-1 px-2 text-right">
                    <InlineEdit
                      value={(amounts[s] ?? 0).toString()}
                      formatDisplay={() => formatCurrency(amounts[s] ?? 0)}
                      parseInput={parseDollar}
                      onSave={(v) => handleAmountUpdate(s, v)}
                      type="number"
                      className="text-sm"
                      isEditable={admin}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4">
        <p className="text-xs text-faint">
          Source: HHS Federal Register poverty guidelines.
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
