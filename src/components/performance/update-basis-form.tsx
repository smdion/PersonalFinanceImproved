"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  accountDisplayName,
  formatCurrency,
  formatDate,
} from "@/lib/utils/format";
import type { AccountRow } from "./types";

type BasisFormRow = {
  performanceAccountId: number;
  ownerPersonId: number;
  year: number;
  displayName: string;
  contributionBasis: string;
  conversionBasis: string;
  latestConversionYear: string;
  /** As loaded — a fill leaves fields edited since alone. */
  original: { contributionBasis: string; conversionBasis: string };
};

/** Bulk Roth basis entry — mirrors UpdatePerformanceForm's batch-save shape,
 *  but for the 3 basis fields only. Reuses taxBuckets.batchUpdateRothBasis
 *  (the same mutation Tax Buckets' own bulk save uses) rather than a second
 *  write path for account_basis rows. */
export function UpdateBasisForm({
  currentYear,
  accountRows,
  onClose,
  onSaved,
}: {
  currentYear: number;
  accountRows: AccountRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const batchMutation = trpc.taxBuckets.batchUpdateRothBasis.useMutation({
    onSuccess: onSaved,
  });
  // Hidden (no error shown) without the portfolio permission it needs.
  const { data: suggestions } = trpc.investments.suggestBasis.useQuery(
    { year: currentYear },
    { retry: false },
  );
  const [fillNotes, setFillNotes] = useState<Map<string, string> | null>(null);
  const [fill, setFill] = useState<{
    year: number;
    baselines: Record<string, string>;
    counted: Record<string, string>;
  } | null>(null);
  const rowKey = (r: { performanceAccountId: number; ownerPersonId: number }) =>
    `${r.performanceAccountId}:${r.ownerPersonId}`;

  const basisEligible = accountRows.filter(
    (a) =>
      a.year === currentYear &&
      a.isActive &&
      a.performanceAccountId !== null &&
      a.contributionBasis !== null,
  );

  const [rows, setRows] = useState<BasisFormRow[]>(() =>
    basisEligible.map((a) => ({
      performanceAccountId: a.performanceAccountId!,
      ownerPersonId: a.ownerPersonId ?? 0,
      year: currentYear,
      displayName: accountDisplayName(
        {
          institution: a.institution,
          // lint-violation-ok: passing accountLabel into the blessed accountDisplayName helper, not rendering it directly
          accountLabel: a.accountLabel,
          accountType: a.accountType ?? undefined,
          ownershipType: a.ownershipType,
        },
        a.ownerName ?? undefined,
      ),
      contributionBasis: String(a.contributionBasis ?? 0),
      conversionBasis: String(a.conversionBasis ?? 0),
      latestConversionYear:
        a.latestConversionYear != null ? String(a.latestConversionYear) : "",
      original: {
        contributionBasis: String(a.contributionBasis ?? 0),
        conversionBasis: String(a.conversionBasis ?? 0),
      },
    })),
  );

  function updateRow(idx: number, field: keyof BasisFormRow, value: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
    );
  }

  /**
   * Prefill from SimpleFIN: stored basis plus Roth money no saved fill has
   * counted yet. Fields already edited in this form keep the edit.
   */
  function fillFromSimplefin() {
    if (!suggestions) return;
    const byKey = new Map(suggestions.accounts.map((a) => [rowKey(a), a]));
    const notes = new Map<string, string>();
    const record = {
      year: suggestions.year,
      baselines: {} as Record<string, string>,
      counted: {} as Record<string, string>,
    };
    setRows((prev) =>
      prev.map((r) => {
        const s = byKey.get(rowKey(r));
        if (!s || s.feed !== "linked") {
          notes.set(
            rowKey(r),
            s?.feed === "ambiguous"
              ? "Linked in SimpleFIN to the whole account — link each person's sub-account to fill this."
              : "No SimpleFIN feed — enter by hand.",
          );
          return r;
        }
        record.baselines[s.accountBasisId] = s.baseline;
        Object.assign(record.counted, s.counted);
        const untouched = (field: "contributionBasis" | "conversionBasis") =>
          (parseFloat(r[field]) || 0) === (parseFloat(r.original[field]) || 0);
        const kept =
          !untouched("contributionBasis") || !untouched("conversionBasis");
        const a = s.added;
        notes.set(
          rowKey(r),
          [
            a.contributions || a.conversions
              ? `Added from SimpleFIN since ${formatDate(s.baseline, "medium")}: ${formatCurrency(a.contributions)} Roth contributions, ${formatCurrency(a.conversions)} conversions.`
              : `Nothing new from SimpleFIN since ${formatDate(s.baseline, "medium")}.`,
            a.estimated && "Roth part estimated from your paycheck setup.",
            s.missingBefore &&
              `SimpleFIN transactions only go back to ${formatDate(s.missingBefore, "medium")} — add anything before that by hand.`,
            a.outflow > 0 &&
              `${formatCurrency(a.outflow)} left the account — taken off contributions first, then conversions (IRS ordering rules).`,
            kept && "Kept the figures you'd already edited.",
          ]
            .filter(Boolean)
            .join(" "),
        );
        return {
          ...r,
          contributionBasis: untouched("contributionBasis")
            ? s.suggested.contributionBasis.toFixed(2)
            : r.contributionBasis,
          conversionBasis: untouched("conversionBasis")
            ? s.suggested.conversionBasis.toFixed(2)
            : r.conversionBasis,
          latestConversionYear:
            s.suggested.latestConversionYear != null
              ? String(s.suggested.latestConversionYear)
              : "",
        };
      }),
    );
    setFillNotes(notes);
    setFill(record);
  }

  function handleSave() {
    batchMutation.mutate({
      entries: rows.map((r) => ({
        performanceAccountId: r.performanceAccountId,
        ownerPersonId: r.ownerPersonId,
        year: r.year,
        contributionBasis: r.contributionBasis || "0",
        conversionBasis: r.conversionBasis || "0",
        latestConversionYear: r.latestConversionYear
          ? parseInt(r.latestConversionYear, 10)
          : null,
      })),
      simplefinFill: fill ?? undefined,
    });
  }

  if (basisEligible.length === 0) {
    return (
      <div className="text-muted p-4 text-sm">
        No Roth-basis-tracking accounts (401k/403b/IRA) are active for{" "}
        {currentYear}.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <p className="text-caption text-muted">
          Contribution and conversion basis for {currentYear} — the tax-free,
          penalty-free portion of each Roth account. Also editable inline on
          this page or on Tax Buckets.
        </p>
        {suggestions && suggestions.accounts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded bg-blue-50 p-2 text-xs text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
            <span>
              {fillNotes
                ? "Filled from SimpleFIN — check each figure, then save."
                : "Add Roth contributions and conversions SimpleFIN has seen since each row was last saved."}
            </span>
            {!fillNotes && (
              <button
                type="button"
                onClick={fillFromSimplefin}
                className="rounded bg-blue-600 px-2 py-0.5 text-white hover:bg-blue-700"
              >
                Fill from SimpleFIN
              </button>
            )}
          </div>
        )}
        {rows.map((row, idx) => (
          <div
            key={rowKey(row)}
            className="border-default space-y-2 rounded-lg border p-3"
          >
            <div className="text-primary text-sm font-medium">
              {row.displayName}
            </div>
            {fillNotes?.get(rowKey(row)) && (
              <p className="text-caption text-muted">
                {fillNotes.get(rowKey(row))}
              </p>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-caption text-muted mb-0.5 block font-medium">
                  Contribution basis
                </label>
                <div className="border-default flex items-center rounded border focus-within:ring-1 focus-within:ring-blue-500">
                  <span className="text-muted pl-1.5 text-xs select-none">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={row.contributionBasis}
                    onChange={(e) =>
                      updateRow(idx, "contributionBasis", e.target.value)
                    }
                    className="text-primary focus-visible:ring-offset-surface-primary min-w-0 flex-1 rounded bg-transparent px-1 py-1 text-right text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-caption text-muted mb-0.5 block font-medium">
                  Conversion basis
                </label>
                <div className="border-default flex items-center rounded border focus-within:ring-1 focus-within:ring-blue-500">
                  <span className="text-muted pl-1.5 text-xs select-none">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={row.conversionBasis}
                    onChange={(e) =>
                      updateRow(idx, "conversionBasis", e.target.value)
                    }
                    className="text-primary focus-visible:ring-offset-surface-primary min-w-0 flex-1 rounded bg-transparent px-1 py-1 text-right text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-caption text-muted mb-0.5 block font-medium">
                  Latest conversion year
                </label>
                <input
                  type="number"
                  step="1"
                  value={row.latestConversionYear}
                  onChange={(e) =>
                    updateRow(idx, "latestConversionYear", e.target.value)
                  }
                  placeholder="none"
                  className="border-default text-primary w-full rounded border bg-transparent px-1.5 py-1 text-right text-xs focus-within:ring-1 focus-within:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-default flex items-center justify-end gap-2 border-t p-4">
        {batchMutation.isError && (
          <span className="text-caption mr-auto text-red-600">
            Save failed — try again.
          </span>
        )}
        <button
          onClick={onClose}
          className="text-muted hover:text-primary px-3 py-1.5 text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={batchMutation.isPending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {batchMutation.isPending ? "Saving..." : "Save Basis"}
        </button>
      </div>
    </div>
  );
}
