"use client";

/** Settings tab for managing the ACA Federal Poverty Level table by tax year and household size, with inline dollar-amount editing and year duplication. */
import { useState } from "react";
import { AddYearPanel, DeleteYearConfirm } from "./tax-year-actions";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { InlineEdit } from "@/components/ui/inline-edit";
import { SettingsQueryBoundary, queryPending } from "./settings-query-boundary";
import { formatCurrency } from "@/lib/utils/format";
const HOUSEHOLD_SIZES = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

function parseDollar(raw: string): string {
  return raw.replace(/[$,\s]/g, "");
}

export function FplByHouseholdSettings({ year }: { year: number }) {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const query = trpc.settings.fplByHousehold.list.useQuery();
  const updateMutation = trpc.settings.fplByHousehold.update.useMutation({
    onSuccess: () => utils.settings.fplByHousehold.invalidate(),
  });
  const createMutation = trpc.settings.fplByHousehold.create.useMutation({
    onSuccess: () => utils.settings.fplByHousehold.invalidate(),
  });
  const deleteMutation = trpc.settings.fplByHousehold.delete.useMutation({
    onSuccess: () => utils.settings.fplByHousehold.invalidate(),
  });
  const resetMutation = trpc.settings.fplByHousehold.resetToShipped.useMutation(
    { onSuccess: () => utils.settings.fplByHousehold.invalidate() },
  );

  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  if (queryPending(query)) return <SettingsQueryBoundary query={query} />;

  const years = Array.from(
    new Set((query.data ?? []).map((r) => r.taxYear)),
  ).sort((a, b) => b - a);
  const activeYear = year;
  const row = (query.data ?? []).find((r) => r.taxYear === activeYear);
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
      ? (((query.data ?? []).find((r) => r.taxYear === effectiveCopyFrom)
          ?.amounts ?? {}) as Record<string, number>)
      : ({} as Record<string, number>);
    await createMutation.mutateAsync({
      taxYear: activeYear,
      amounts: Object.fromEntries(
        HOUSEHOLD_SIZES.map((s) => [s, sourceAmounts[s] ?? 0]),
      ) as Record<"1" | "2" | "3" | "4" | "5" | "6" | "7" | "8", number>,
      // A copy or all-zero placeholder: replaced when the real table ships.
      carried: true,
    });

    setCopyFrom(null);
  };

  const handleDeleteYear = async (yr: number) => {
    const toDelete = (query.data ?? []).find((r) => r.taxYear === yr);
    if (toDelete) await deleteMutation.mutateAsync({ id: toDelete.id });
    setConfirmDelete(null);
  };

  if (!row) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">
          ACA Federal Poverty Level
        </h2>
        <AddYearPanel
          message={<>No FPL table configured for {activeYear}.</>}
          admin={admin}
          year={activeYear}
          years={years}
          copyFrom={effectiveCopyFrom}
          onCopyFromChange={setCopyFrom}
          noneLabel="All zero"
          onAdd={handleAddYear}
        />
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
        <DeleteYearConfirm
          message={
            <>Delete the {activeYear} FPL table? This cannot be undone.</>
          }
          onDelete={() => handleDeleteYear(activeYear)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      <div className="overflow-hidden rounded-lg border">
        <div className="bg-surface-sunken border-b px-4 py-2">
          <h3 className="text-primary font-medium">
            By Household Size
            {admin && row.shipped && row.origin === "user" && (
              <button
                type="button"
                onClick={() => resetMutation.mutate({ id: row.id })}
                className="text-caption ml-2 font-normal text-blue-600 hover:underline"
                title="You changed this table — put back the one Ledgr ships"
              >
                Reset to shipped
              </button>
            )}
          </h3>
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
        {admin &&
          years.length > 1 &&
          !row.shipped &&
          confirmDelete !== activeYear && (
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
