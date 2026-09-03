"use client";

/** Settings tab for managing the ACA Federal Poverty Level table by tax year and household size, with inline dollar-amount editing and year duplication. */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils/format";
const HOUSEHOLD_SIZES = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

function parseDollar(raw: string): string {
  return raw.replace(/[$,\s]/g, "");
}

export function FplByHouseholdSettings({ year }: { year: number }) {
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

  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  if (isLoading) return <Skeleton className="h-6 w-48" />;

  const years = Array.from(new Set((data ?? []).map((r) => r.taxYear))).sort(
    (a, b) => b - a,
  );
  const activeYear = year;
  const row = (data ?? []).find((r) => r.taxYear === activeYear);
  const amounts = (row?.amounts ?? {}) as Record<string, number>;
  const effectiveCopyFrom = copyFrom ?? years[0] ?? null;

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
    if (years.includes(activeYear)) return;

    const sourceAmounts = effectiveCopyFrom
      ? (((data ?? []).find((r) => r.taxYear === effectiveCopyFrom)?.amounts ??
          {}) as Record<string, number>)
      : ({} as Record<string, number>);
    await createMutation.mutateAsync({
      taxYear: activeYear,
      amounts: Object.fromEntries(
        HOUSEHOLD_SIZES.map((s) => [s, sourceAmounts[s] ?? 0]),
      ) as Record<"1" | "2" | "3" | "4" | "5" | "6" | "7" | "8", number>,
    });

    setCopyFrom(null);
  };

  const handleDeleteYear = async (yr: number) => {
    const toDelete = (data ?? []).find((r) => r.taxYear === yr);
    if (toDelete) await deleteMutation.mutateAsync({ id: toDelete.id });
    setConfirmDelete(null);
  };

  if (!row) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">
          ACA Federal Poverty Level
        </h2>
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-muted mb-3 text-sm">
            No FPL table configured for {activeYear}.
          </p>
          {admin && (
            <div className="flex items-center justify-center gap-3">
              {years.length > 0 && (
                <label className="text-secondary text-sm">
                  Copy from:
                  <select
                    value={effectiveCopyFrom ?? ""}
                    onChange={(e) =>
                      setCopyFrom(
                        e.target.value ? parseInt(e.target.value) : null,
                      )
                    }
                    className="ml-2 rounded border px-2 py-1 text-sm"
                  >
                    <option value="">All zero</option>
                    {years.map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                onClick={handleAddYear}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
              >
                Add {activeYear}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">ACA Federal Poverty Level</h2>

      <p className="text-muted mb-4 text-xs">
        Coverage-year FPL — HHS publishes these guidelines the PRIOR calendar
        year. Determines the 400% FPL ACA subsidy cliff (4× the
        household&rsquo;s figure below).
      </p>

      {/* Delete year confirmation */}
      {confirmDelete === activeYear && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3">
          <span className="text-sm text-red-800">
            Delete the {activeYear} FPL table? This cannot be undone.
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => handleDeleteYear(activeYear)}
              className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(null)}
              className="text-muted hover:text-primary px-3 py-1 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border">
        <div className="bg-surface-sunken border-b px-4 py-2">
          <h3 className="text-primary font-medium">By Household Size</h3>
        </div>
        <div className="overflow-x-auto p-3">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-muted text-xs">
                {HOUSEHOLD_SIZES.map((s) => (
                  <th key={s} className="px-2 pb-1 text-right font-normal">
                    {s} {s === "1" ? "person" : "people"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-subtle border-t">
                {HOUSEHOLD_SIZES.map((s) => (
                  <td key={s} className="px-2 py-1 text-right">
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

      <div className="mt-4 flex items-center justify-between">
        <p className="text-faint text-xs">
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
