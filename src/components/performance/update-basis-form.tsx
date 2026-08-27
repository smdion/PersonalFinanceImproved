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
      <div className="p-4 text-sm text-muted">
        No Roth-basis-tracking accounts (401k/403b/IRA) are active for{" "}
        {currentYear}.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <p className="text-caption text-muted">
          Contribution and conversion basis for {currentYear} — the tax-free,
          penalty-free portion of each Roth account. Also editable inline on
          this page or on Tax Buckets.
        </p>
        {rows.map((row, idx) => (
          <div
            key={row.performanceAccountId}
            className="border border-default rounded-lg p-3 space-y-2"
          >
            <div className="text-sm font-medium text-primary">
              {row.displayName}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-caption font-medium text-muted mb-0.5">
                  Contribution basis
                </label>
                <div className="flex items-center border border-default rounded focus-within:ring-1 focus-within:ring-blue-500">
                  <span className="pl-1.5 text-xs text-muted select-none">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={row.contributionBasis}
                    onChange={(e) =>
                      updateRow(idx, "contributionBasis", e.target.value)
                    }
                    className="flex-1 min-w-0 bg-transparent px-1 py-1 text-xs text-right text-primary focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-caption font-medium text-muted mb-0.5">
                  Conversion basis
                </label>
                <div className="flex items-center border border-default rounded focus-within:ring-1 focus-within:ring-blue-500">
                  <span className="pl-1.5 text-xs text-muted select-none">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={row.conversionBasis}
                    onChange={(e) =>
                      updateRow(idx, "conversionBasis", e.target.value)
                    }
                    className="flex-1 min-w-0 bg-transparent px-1 py-1 text-xs text-right text-primary focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-caption font-medium text-muted mb-0.5">
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
                  className="w-full border border-default rounded px-1.5 py-1 text-xs text-right text-primary bg-transparent focus:outline-none focus-within:ring-1 focus-within:ring-blue-500"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 p-4 border-t border-default">
        {batchMutation.isError && (
          <span className="text-caption text-red-600 mr-auto">
            Save failed — try again.
          </span>
        )}
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm text-muted hover:text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={batchMutation.isPending}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors disabled:opacity-50"
        >
          {batchMutation.isPending ? "Saving..." : "Save Basis"}
        </button>
      </div>
    </div>
  );
}
