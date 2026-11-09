"use client";

/** Settings tab for managing federal income tax withholding brackets (IRS Pub 15-T) by tax year, filing status, and W-4 checkbox, with inline editing and year duplication. */
import { useState } from "react";
import { AddYearPanel, DeleteYearConfirm } from "./tax-year-actions";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { InlineEdit } from "@/components/ui/inline-edit";
import { SettingsQueryBoundary, queryPending } from "./settings-query-boundary";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import {
  W4_FILING_STATUS_VALUES,
  type W4FilingStatus,
} from "@/lib/config/filing-status";
import { FILING_STATUS_LABELS } from "@/lib/config/display-labels";

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
  const query = trpc.settings.taxBrackets.list.useQuery();
  const updateMutation = trpc.settings.taxBrackets.update.useMutation({
    onSuccess: () => utils.settings.taxBrackets.invalidate(),
  });
  const createMutation = trpc.settings.taxBrackets.create.useMutation({
    onSuccess: () => utils.settings.taxBrackets.invalidate(),
  });
  const deleteMutation = trpc.settings.taxBrackets.delete.useMutation({
    onSuccess: () => utils.settings.taxBrackets.invalidate(),
  });
  const resetMutation = trpc.settings.taxBrackets.resetToShipped.useMutation({
    onSuccess: () => utils.settings.taxBrackets.invalidate(),
  });

  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  if (queryPending(query)) return <SettingsQueryBoundary query={query} />;

  // Get unique years, sorted descending (newest first)
  const years = Array.from(
    new Set((query.data ?? []).map((tb) => tb.taxYear)),
  ).sort((a, b) => b - a);
  const activeYear = year;
  const yearData = (query.data ?? []).filter((tb) => tb.taxYear === activeYear);
  const hasYearData = yearData.length > 0;
  // A year Ledgr ships can't be deleted (it would come back on restart).
  const yearShipped = yearData.some((tb) => tb.shipped);
  const effectiveCopyFrom = copyFrom ?? years[0] ?? null;

  const handleBracketUpdate = (
    tbId: number,
    brackets: BracketEntry[],
    bracketIndex: number,
    field: keyof BracketEntry,
    rawValue: string,
  ) => {
    const numValue = parseFloat(rawValue);
    if (isNaN(numValue)) return;

    const newBrackets = brackets.map((b, i) =>
      i === bracketIndex
        ? { ...b, [field]: field === "rate" ? numValue / 100 : numValue }
        : b,
    );

    const tb = yearData.find((t) => t.id === tbId);
    if (!tb) return;
    updateMutation.mutate({
      id: tbId,
      taxYear: tb.taxYear,
      filingStatus: tb.filingStatus as W4FilingStatus,
      w4Checkbox: tb.w4Checkbox,
      brackets: newBrackets,
    });
  };

  const handleAddYear = async () => {
    if (years.includes(activeYear)) return;

    if (effectiveCopyFrom) {
      // Copy brackets from source year
      const sourceData = (query.data ?? []).filter(
        (tb) => tb.taxYear === effectiveCopyFrom,
      );
      for (const tb of sourceData) {
        await createMutation.mutateAsync({
          taxYear: activeYear,
          filingStatus: tb.filingStatus as W4FilingStatus,
          w4Checkbox: tb.w4Checkbox,
          brackets: tb.brackets as BracketEntry[],
          carried: true, // replaced when the real tables ship
        });
      }
    } else {
      // Create empty brackets for all filing status + checkbox combos
      for (const fs of W4_FILING_STATUS_VALUES) {
        for (const checkbox of [false, true]) {
          await createMutation.mutateAsync({
            taxYear: activeYear,
            filingStatus: fs,
            w4Checkbox: checkbox,
            brackets: [{ threshold: 0, baseWithholding: 0, rate: 0 }],
            carried: true, // a placeholder until filled in or shipped
          });
        }
      }
    }

    setCopyFrom(null);
  };

  const handleDeleteYear = async (yr: number) => {
    const toDelete = (query.data ?? []).filter((tb) => tb.taxYear === yr);
    for (const tb of toDelete) {
      await deleteMutation.mutateAsync({ id: tb.id });
    }
    setConfirmDelete(null);
  };

  if (!hasYearData) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">Tax Brackets</h2>
        <AddYearPanel
          message={<>No tax brackets configured for {activeYear}.</>}
          admin={admin}
          year={activeYear}
          years={years}
          copyFrom={effectiveCopyFrom}
          onCopyFromChange={setCopyFrom}
          onAdd={handleAddYear}
        />
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Tax Brackets</h2>

      {/* Delete year confirmation */}
      {confirmDelete === activeYear && (
        <DeleteYearConfirm
          message={
            <>Delete all {activeYear} brackets? This cannot be undone.</>
          }
          onDelete={() => handleDeleteYear(activeYear)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      <div className="space-y-6">
        {W4_FILING_STATUS_VALUES.map((status) => {
          const statusBrackets = yearData.filter(
            (tb) => tb.filingStatus === status,
          );
          if (statusBrackets.length === 0) return null;

          return (
            <div key={status} className="overflow-hidden rounded-lg border">
              <div className="bg-surface-sunken border-b px-4 py-2">
                <h3 className="text-primary font-medium">
                  {FILING_STATUS_LABELS[status]}
                  {admin &&
                    statusBrackets.some(
                      (tb) => tb.shipped && tb.origin === "user",
                    ) && (
                      <button
                        type="button"
                        onClick={async () => {
                          for (const tb of statusBrackets)
                            if (tb.shipped && tb.origin === "user")
                              await resetMutation.mutateAsync({ id: tb.id });
                        }}
                        className="text-caption ml-2 font-normal text-blue-600 hover:underline"
                        title="You changed these tables — put back the ones Ledgr ships"
                      >
                        Reset to shipped
                      </button>
                    )}
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
        {admin &&
          years.length > 1 &&
          !yearShipped &&
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
