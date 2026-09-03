"use client";

/** Settings tab for managing federal income tax withholding brackets (IRS Pub 15-T) by tax year, filing status, and W-4 checkbox, with inline editing and year duplication. */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

type BracketEntry = {
  threshold: number;
  baseWithholding: number;
  rate: number;
};

function formatDollar(v: number): string {
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

export function TaxBracketsSettings({ year }: { year: number }) {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.settings.taxBrackets.list.useQuery();
  const updateMutation = trpc.settings.taxBrackets.update.useMutation({
    onSuccess: () => utils.settings.taxBrackets.invalidate(),
  });
  const createMutation = trpc.settings.taxBrackets.create.useMutation({
    onSuccess: () => utils.settings.taxBrackets.invalidate(),
  });
  const deleteMutation = trpc.settings.taxBrackets.delete.useMutation({
    onSuccess: () => utils.settings.taxBrackets.invalidate(),
  });

  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  if (isLoading) return <Skeleton className="h-6 w-48" />;

  // Get unique years, sorted descending (newest first)
  const years = Array.from(new Set((data ?? []).map((tb) => tb.taxYear))).sort(
    (a, b) => b - a,
  );
  const activeYear = year;
  const yearData = (data ?? []).filter((tb) => tb.taxYear === activeYear);
  const hasYearData = yearData.length > 0;
  const effectiveCopyFrom = copyFrom ?? years[0] ?? null;

  const filingStatuses = ["MFJ", "Single", "HOH"] as const;
  const statusLabels: Record<string, string> = {
    MFJ: "Married Filing Jointly",
    Single: "Single",
    HOH: "Head of Household",
  };

  const handleBracketUpdate = (
    tbId: number,
    brackets: BracketEntry[],
    bracketIdx: number,
    field: keyof BracketEntry,
    rawValue: string,
  ) => {
    const numValue = parseFloat(rawValue);
    if (isNaN(numValue)) return;

    const newBrackets = brackets.map((b, i) =>
      i === bracketIdx
        ? { ...b, [field]: field === "rate" ? numValue / 100 : numValue }
        : b,
    );

    const tb = yearData.find((t) => t.id === tbId);
    if (!tb) return;
    updateMutation.mutate({
      id: tbId,
      taxYear: tb.taxYear,
      filingStatus: tb.filingStatus as "MFJ" | "Single" | "HOH",
      w4Checkbox: tb.w4Checkbox,
      brackets: newBrackets,
    });
  };

  const handleAddYear = async () => {
    if (years.includes(activeYear)) return;

    if (effectiveCopyFrom) {
      // Copy brackets from source year
      const sourceData = (data ?? []).filter(
        (tb) => tb.taxYear === effectiveCopyFrom,
      );
      for (const tb of sourceData) {
        await createMutation.mutateAsync({
          taxYear: activeYear,
          filingStatus: tb.filingStatus as "MFJ" | "Single" | "HOH",
          w4Checkbox: tb.w4Checkbox,
          brackets: tb.brackets as BracketEntry[],
        });
      }
    } else {
      // Create empty brackets for all filing status + checkbox combos
      for (const fs of filingStatuses) {
        for (const checkbox of [false, true]) {
          await createMutation.mutateAsync({
            taxYear: activeYear,
            filingStatus: fs,
            w4Checkbox: checkbox,
            brackets: [{ threshold: 0, baseWithholding: 0, rate: 0 }],
          });
        }
      }
    }

    setCopyFrom(null);
  };

  const handleDeleteYear = async (yr: number) => {
    const toDelete = (data ?? []).filter((tb) => tb.taxYear === yr);
    for (const tb of toDelete) {
      await deleteMutation.mutateAsync({ id: tb.id });
    }
    setConfirmDelete(null);
  };

  if (!hasYearData) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">Tax Brackets</h2>
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-muted mb-3 text-sm">
            No tax brackets configured for {activeYear}.
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
                    <option value="">Empty brackets</option>
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
      <h2 className="mb-4 text-lg font-semibold">Tax Brackets</h2>

      {/* Delete year confirmation */}
      {confirmDelete === activeYear && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3">
          <span className="text-sm text-red-800">
            Delete all {activeYear} brackets? This cannot be undone.
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

      <div className="space-y-6">
        {filingStatuses.map((status) => {
          const statusBrackets = yearData.filter(
            (tb) => tb.filingStatus === status,
          );
          if (statusBrackets.length === 0) return null;

          return (
            <div key={status} className="overflow-hidden rounded-lg border">
              <div className="bg-surface-sunken border-b px-4 py-2">
                <h3 className="text-primary font-medium">
                  {statusLabels[status]}
                </h3>
              </div>

              <div className="grid grid-cols-1 divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                {statusBrackets
                  .sort(
                    (a, b) => (a.w4Checkbox ? 1 : 0) - (b.w4Checkbox ? 1 : 0),
                  )
                  .map((tb) => {
                    const brackets = tb.brackets as BracketEntry[];
                    return (
                      <div key={tb.id} className="p-3">
                        <p className="text-muted mb-2 text-xs font-medium tracking-wide uppercase">
                          {tb.w4Checkbox
                            ? "W-4 Box 2(c) Checked"
                            : "W-4 Box 2(c) Not Checked"}
                        </p>
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="text-muted text-xs">
                              <th className="pb-1 text-left font-normal">
                                Over
                              </th>
                              <th className="pb-1 text-right font-normal">
                                Base
                              </th>
                              <th className="pb-1 text-right font-normal">
                                Rate
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {brackets.map((b, i) => (
                              <tr
                                key={b.threshold}
                                className="border-subtle border-t"
                              >
                                <td className="py-1 pr-2">
                                  <InlineEdit
                                    value={b.threshold.toString()}
                                    formatDisplay={() =>
                                      formatDollar(b.threshold)
                                    }
                                    parseInput={parseDollar}
                                    onSave={(v) =>
                                      handleBracketUpdate(
                                        tb.id,
                                        brackets,
                                        i,
                                        "threshold",
                                        v,
                                      )
                                    }
                                    type="number"
                                    className="text-sm"
                                    isEditable={admin}
                                  />
                                </td>
                                <td className="px-2 py-1 text-right">
                                  <InlineEdit
                                    value={b.baseWithholding.toString()}
                                    formatDisplay={() =>
                                      formatDollar(b.baseWithholding)
                                    }
                                    parseInput={parseDollar}
                                    onSave={(v) =>
                                      handleBracketUpdate(
                                        tb.id,
                                        brackets,
                                        i,
                                        "baseWithholding",
                                        v,
                                      )
                                    }
                                    type="number"
                                    className="text-sm"
                                    isEditable={admin}
                                  />
                                </td>
                                <td className="py-1 pl-2 text-right">
                                  <InlineEdit
                                    value={(b.rate * 100).toFixed(1)}
                                    formatDisplay={() => formatRate(b.rate)}
                                    parseInput={parseRate}
                                    onSave={(v) =>
                                      handleBracketUpdate(
                                        tb.id,
                                        brackets,
                                        i,
                                        "rate",
                                        v,
                                      )
                                    }
                                    type="number"
                                    className="text-sm"
                                    isEditable={admin}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-faint text-xs">
          Source: IRS Publication 15-T. Click any value to edit. Edit rates as
          percentages (e.g., enter 22 for 22%).
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
