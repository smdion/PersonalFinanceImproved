"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { accountDisplayName } from "@/lib/utils/format";
import type { AccountRow } from "./types";

type BasisFormRow = {
  performanceAccountId: number;
  ownerPersonId: number;
  year: number;
  displayName: string;
  contributionBasis: string;
  conversionBasis: string;
  latestConversionYear: string;
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
    })),
  );

  function updateRow(idx: number, field: keyof BasisFormRow, value: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
    );
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
        {rows.map((row, idx) => (
          <div
            key={row.performanceAccountId}
            className="border-default space-y-2 rounded-lg border p-3"
          >
            <div className="text-primary text-sm font-medium">
              {row.displayName}
            </div>
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
