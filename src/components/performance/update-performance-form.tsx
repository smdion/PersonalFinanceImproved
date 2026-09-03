"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, accountDisplayName } from "@/lib/utils/format";
import { computeGainLoss } from "@/lib/pure/performance";
import { getDisplayConfig } from "@/lib/config/account-types";
import {
  CASH_BASIS_HELP,
  combineCashBasisGainLoss,
} from "@/lib/config/display-labels";
import { HelpTip } from "@/components/ui/help-tip";
import { EsppCalculator } from "./espp-calculator";
import type { UpdateFormRow, UpdatePerformanceFormProps } from "./types";
import type { EsppSummary } from "@/lib/pure/performance";

type EndingBalanceSource = "snapshot" | "manual";

export function UpdatePerformanceForm({
  currentYear,
  accountRows: currentYearAccounts,
  onClose,
  onSaved,
}: UpdatePerformanceFormProps) {
  const { data: latestSnap, isLoading: loadingSnap } =
    trpc.networth.portfolioSnapshots.getLatest.useQuery();
  const batchMutation = trpc.performance.batchUpdateAccounts.useMutation({
    onSuccess: onSaved,
  });

  const [endingBalanceSource, setEndingBalanceSource] =
    useState<EndingBalanceSource>("snapshot");
  const [rows, setRows] = useState<UpdateFormRow[] | null>(null);
  const didInit = useRef(false);

  // Build snapshot lookup: performanceAccountId → sum of amounts
  const snapshotByPerfAcct = useRef(new Map<number, number>());
  useEffect(() => {
    if (!latestSnap?.accounts) return;
    const map = new Map<number, number>();
    for (const a of latestSnap.accounts) {
      if (a.performanceAccountId) {
        map.set(
          a.performanceAccountId,
          (map.get(a.performanceAccountId) ?? 0) + parseFloat(a.amount),
        );
      }
    }
    snapshotByPerfAcct.current = map;
  }, [latestSnap]);

  // Initialize form rows from current year account data (once)
  useEffect(() => {
    if (didInit.current || loadingSnap) return;
    didInit.current = true;

    const filtered = currentYearAccounts.filter(
      (a) => a.year === currentYear && a.isActive,
    );

    const initial: UpdateFormRow[] = filtered.map((a) => {
      const snapBal =
        a.performanceAccountId !== null
          ? (snapshotByPerfAcct.current.get(a.performanceAccountId) ?? null)
          : null;
      const employeeContrib = a.totalContributions - a.employerContributions;
      return {
        accountPerformanceId: a.id,
        performanceAccountId: a.performanceAccountId,
        accountType: a.accountType,
        subType: a.subType,
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
        institution: a.institution,
        parentCategory: a.parentCategory,
        beginningBalance: a.beginningBalance,
        employeeContrib: String(employeeContrib),
        employerContributions: String(a.employerContributions),
        distributions: String(a.distributions),
        rollovers: String(a.rollovers),
        fees: String(a.fees),
        endingBalance: String(a.endingBalance),
        yearlyGainLoss: String(a.yearlyGainLoss),
        gainLossOverride: false,
        snapshotEndingBalance: snapBal,
        original: {
          employeeContrib,
          employerContributions: a.employerContributions,
          distributions: a.distributions,
          rollovers: a.rollovers,
          fees: a.fees,
          endingBalance: a.endingBalance,
        },
      };
    });
    setRows(initial);
  }, [loadingSnap, currentYearAccounts, currentYear]);

  const updateRow = useCallback(
    (id: number, field: keyof UpdateFormRow, value: string | boolean) => {
      setRows(
        (prev) =>
          prev?.map((r) =>
            r.accountPerformanceId === id ? { ...r, [field]: value } : r,
          ) ?? null,
      );
    },
    [],
  );

  // Get the effective ending balance for a row
  const getEndingBalance = useCallback(
    (row: UpdateFormRow): number => {
      if (
        endingBalanceSource === "snapshot" &&
        row.snapshotEndingBalance !== null
      ) {
        return row.snapshotEndingBalance;
      }
      return parseFloat(row.endingBalance) || 0;
    },
    [endingBalanceSource],
  );

  // Compute gain/loss for a row using the pure function
  const getComputedGainLoss = useCallback(
    (row: UpdateFormRow): number => {
      const totalContrib =
        (parseFloat(row.employeeContrib) || 0) +
        (parseFloat(row.employerContributions) || 0);
      return computeGainLoss({
        endingBalance: getEndingBalance(row),
        beginningBalance: row.beginningBalance,
        totalContributions: totalContrib,
        distributions: parseFloat(row.distributions) || 0,
        rollovers: parseFloat(row.rollovers) || 0,
        fees: parseFloat(row.fees) || 0,
      });
    },
    [getEndingBalance],
  );

  const handleSave = () => {
    if (!rows) return;
    const accounts = rows.map((r) => {
      const endBal = getEndingBalance(r);
      const gainLoss = r.gainLossOverride
        ? parseFloat(r.yearlyGainLoss) || 0
        : getComputedGainLoss(r);
      const totalContributions = (
        (parseFloat(r.employeeContrib) || 0) +
        (parseFloat(r.employerContributions) || 0)
      ).toFixed(2);
      return {
        id: r.accountPerformanceId,
        totalContributions,
        employerContributions: r.employerContributions,
        distributions: r.distributions,
        rollovers: r.rollovers,
        fees: r.fees,
        endingBalance: endBal.toFixed(2),
        yearlyGainLoss: gainLoss.toFixed(2),
      };
    });
    batchMutation.mutate({ accounts });
  };

  const currentRows = rows ?? [];

  // Group rows by institution (sorted alphabetically)
  const groups = new Map<string, UpdateFormRow[]>();
  for (const row of currentRows) {
    if (!groups.has(row.institution)) groups.set(row.institution, []);
    groups.get(row.institution)!.push(row);
  }
  const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const totalGainLoss = currentRows.reduce((sum, r) => {
    const gl = r.gainLossOverride
      ? parseFloat(r.yearlyGainLoss) || 0
      : getComputedGainLoss(r);
    return sum + gl;
  }, 0);

  const snapshotDate = latestSnap?.snapshot?.snapshotDate ?? null;

  if (loadingSnap) {
    return <p className="text-muted text-sm">Loading snapshot data...</p>;
  }

  return (
    <div className="space-y-4">
      {/* Ending balance source toggle */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-muted font-medium">Ending Balance Source:</span>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="radio"
            name="endingBalanceSource"
            checked={endingBalanceSource === "snapshot"}
            onChange={() => setEndingBalanceSource("snapshot")}
            className="accent-blue-600"
          />
          <span>
            From Latest Snapshot
            {snapshotDate && (
              <span className="text-faint ml-1">({snapshotDate})</span>
            )}
          </span>
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="radio"
            name="endingBalanceSource"
            checked={endingBalanceSource === "manual"}
            onChange={() => setEndingBalanceSource("manual")}
            className="accent-blue-600"
          />
          <span>Manual Entry</span>
        </label>
      </div>

      {/* Account groups — one section per institution */}
      {sortedGroups.map(([institution, groupRows]) => {
        const groupGainLoss = groupRows.reduce((sum, r) => {
          const gl = r.gainLossOverride
            ? parseFloat(r.yearlyGainLoss) || 0
            : getComputedGainLoss(r);
          return sum + gl;
        }, 0);

        return (
          <div key={institution} className="mb-2">
            {/* Institution header */}
            <div className="border-strong mb-3 flex items-baseline justify-between border-b-2 pb-1.5">
              <span className="text-primary text-sm font-semibold">
                {institution}
              </span>
              <span
                className={`text-xs font-medium ${groupGainLoss >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                Gain/Loss: {formatCurrency(groupGainLoss)}
              </span>
            </div>

            {/* Account rows */}
            {groupRows.map((row) => (
              <AccountFormRow
                key={row.accountPerformanceId}
                row={row}
                endingBalanceSource={endingBalanceSource}
                snapshotDate={snapshotDate}
                computedGainLoss={getComputedGainLoss(row)}
                effectiveEndingBalance={getEndingBalance(row)}
                onFieldChange={updateRow}
              />
            ))}
          </div>
        );
      })}

      {/* Total */}
      <div className="border-strong flex items-baseline justify-between border-t-2 pt-2">
        <span className="font-semibold">Total Gain/Loss</span>
        <span
          className={`font-bold ${totalGainLoss >= 0 ? "text-green-600" : "text-red-600"}`}
        >
          {formatCurrency(totalGainLoss)}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:text-primary border-strong rounded border px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={batchMutation.isPending || currentRows.length === 0}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {batchMutation.isPending ? "Saving..." : "Save Update"}
        </button>
      </div>

      {batchMutation.isError && (
        <p className="text-sm text-red-600">
          Error: {batchMutation.error.message}
        </p>
      )}
    </div>
  );
}

/** Individual account row within the form. */
function AccountFormRow({
  row,
  endingBalanceSource,
  snapshotDate,
  computedGainLoss,
  effectiveEndingBalance,
  onFieldChange,
}: {
  row: UpdateFormRow;
  endingBalanceSource: EndingBalanceSource;
  snapshotDate: string | null;
  computedGainLoss: number;
  effectiveEndingBalance: number;
  onFieldChange: (
    id: number,
    field: keyof UpdateFormRow,
    value: string | boolean,
  ) => void;
}) {
  const id = row.accountPerformanceId;
  const gainLoss = row.gainLossOverride
    ? parseFloat(row.yearlyGainLoss) || 0
    : computedGainLoss;

  const displayCfg = getDisplayConfig(row.accountType ?? "", row.subType);
  const [showCalculator, setShowCalculator] = useState(
    displayCfg.hasPurchasePeriodCalculator,
  );

  const applyEsppSummary = useCallback(
    (summary: EsppSummary) => {
      onFieldChange(
        id,
        "employeeContrib",
        summary.employeeContributions.toFixed(2),
      );
      onFieldChange(
        id,
        "employerContributions",
        summary.employerMatch.toFixed(2),
      );
      onFieldChange(id, "rollovers", summary.rollovers.toFixed(2));
      onFieldChange(id, "fees", summary.fees.toFixed(2));
      onFieldChange(id, "distributions", summary.distributions.toFixed(2));
    },
    [id, onFieldChange],
  );

  return (
    <div className="border-subtle mb-3 border-b pb-3 last:mb-0 last:border-b-0 last:pb-0">
      {/* Account name */}
      <div className="mb-2 flex items-center gap-2">
        <span className="h-4 w-0.5 flex-shrink-0 rounded-full bg-blue-500" />
        <span className="text-primary text-sm font-semibold">
          {row.displayName}
        </span>
        {displayCfg.hasPurchasePeriodCalculator && !showCalculator && (
          <button
            type="button"
            onClick={() => setShowCalculator(true)}
            className="text-caption ml-auto text-teal-600 hover:text-teal-800"
          >
            ESPP Calculator
          </button>
        )}
      </div>

      {/* ESPP calculator — shown for ESPP sub-type accounts */}
      {showCalculator && displayCfg.hasPurchasePeriodCalculator && (
        <EsppCalculator
          onApply={applyEsppSummary}
          onDismiss={() => setShowCalculator(false)}
        />
      )}

      {/* Flow fields — one row */}
      <div className="mb-1 grid grid-cols-5 gap-2">
        <CompactCurrencyField
          label="Employee Contrib"
          value={row.employeeContrib}
          originalValue={row.original.employeeContrib}
          onChange={(v) => onFieldChange(id, "employeeContrib", v)}
        />
        <CompactCurrencyField
          label="Employer Match"
          value={row.employerContributions}
          originalValue={row.original.employerContributions}
          onChange={(v) => onFieldChange(id, "employerContributions", v)}
        />
        <CompactCurrencyField
          label="Distributions"
          value={row.distributions}
          originalValue={row.original.distributions}
          onChange={(v) => onFieldChange(id, "distributions", v)}
        />
        <CompactCurrencyField
          label="Rollovers"
          value={row.rollovers}
          originalValue={row.original.rollovers}
          onChange={(v) => onFieldChange(id, "rollovers", v)}
        />
        <CompactCurrencyField
          label="Fees"
          value={row.fees}
          originalValue={row.original.fees}
          onChange={(v) => onFieldChange(id, "fees", v)}
        />
      </div>
      {/* Total contributions read-only display */}
      <div className="text-caption text-muted mb-2">
        Total Contributions:{" "}
        <span className="text-primary font-medium">
          {formatCurrency(
            (parseFloat(row.employeeContrib) || 0) +
              (parseFloat(row.employerContributions) || 0),
          )}
        </span>
      </div>

      {/* Ending balance + gain/loss summary */}
      <div className="flex items-center gap-4 text-sm">
        {/* Ending balance */}
        <div className="flex items-center gap-1.5">
          <span className="text-muted text-xs">Ending Bal:</span>
          {endingBalanceSource === "snapshot" &&
          row.snapshotEndingBalance !== null ? (
            <span className="text-xs font-medium">
              {formatCurrency(row.snapshotEndingBalance)}
              {snapshotDate && (
                <span className="text-faint text-caption ml-1">
                  ({snapshotDate})
                </span>
              )}
            </span>
          ) : endingBalanceSource === "snapshot" &&
            row.snapshotEndingBalance === null ? (
            <span className="flex items-center gap-1.5">
              <div className="border-default flex items-center rounded border focus-within:ring-1 focus-within:ring-blue-500">
                <span className="text-muted pl-1.5 text-xs select-none">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={row.endingBalance}
                  onChange={(e) =>
                    onFieldChange(id, "endingBalance", e.target.value)
                  }
                  className="text-primary focus-visible:ring-offset-surface-primary w-24 rounded bg-transparent px-1 py-0.5 text-right text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
                />
              </div>
              <span className="text-caption text-amber-600">(no snapshot)</span>
            </span>
          ) : (
            <div className="border-default flex items-center rounded border focus-within:ring-1 focus-within:ring-blue-500">
              <span className="text-muted pl-1.5 text-xs select-none">$</span>
              <input
                type="number"
                step="0.01"
                value={row.endingBalance}
                onChange={(e) =>
                  onFieldChange(id, "endingBalance", e.target.value)
                }
                className="text-primary focus-visible:ring-offset-surface-primary w-24 rounded bg-transparent px-1 py-0.5 text-right text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
              />
            </div>
          )}
          {row.original.endingBalance !== effectiveEndingBalance && (
            <span className="text-caption text-faint">
              was {formatCurrency(row.original.endingBalance)}
            </span>
          )}
        </div>

        {/* Gain/loss */}
        <div className="flex items-center gap-1.5">
          <span className="text-muted text-xs">Gain/Loss:</span>
          {row.gainLossOverride ? (
            <>
              <div className="border-default flex items-center rounded border focus-within:ring-1 focus-within:ring-blue-500">
                <span className="text-muted pl-1.5 text-xs select-none">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={row.yearlyGainLoss}
                  onChange={(e) =>
                    onFieldChange(id, "yearlyGainLoss", e.target.value)
                  }
                  className="text-primary focus-visible:ring-offset-surface-primary w-24 rounded bg-transparent px-1 py-0.5 text-right text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
                />
              </div>
              <span className="text-caption text-amber-600 italic">manual</span>
              <button
                type="button"
                onClick={() => onFieldChange(id, "gainLossOverride", false)}
                className="text-caption text-blue-600 hover:text-blue-800"
              >
                reset
              </button>
            </>
          ) : (
            <>
              <span
                className={`text-sm font-semibold tabular-nums ${gainLoss >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                {formatCurrency(gainLoss)}
              </span>
              <button
                type="button"
                onClick={() => {
                  onFieldChange(
                    id,
                    "yearlyGainLoss",
                    computedGainLoss.toFixed(2),
                  );
                  onFieldChange(id, "gainLossOverride", true);
                }}
                className="text-faint hover:text-muted"
                title="Override with manual value"
              >
                <svg
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
              </button>
            </>
          )}
          {displayCfg.employerContribKind === "discount" && (
            <HelpTip
              text={`${formatCurrency(
                combineCashBasisGainLoss(
                  gainLoss,
                  parseFloat(row.employerContributions) || 0,
                ),
              )} ${CASH_BASIS_HELP}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Small labeled currency input with $ prefix, zero-value dimming, and "was" hint. */
function CompactCurrencyField({
  label,
  value,
  originalValue,
  onChange,
}: {
  label: string;
  value: string;
  originalValue: number;
  onChange: (value: string) => void;
}) {
  const numValue = parseFloat(value) || 0;
  const isZero = numValue === 0 && originalValue === 0;
  const changed = numValue !== originalValue;

  return (
    <div>
      <label className="text-caption text-muted mb-0.5 block font-medium">
        {label}
      </label>
      <div
        className={`border-default flex items-center rounded border focus-within:ring-1 focus-within:ring-blue-500 transition-opacity${isZero ? "opacity-40 focus-within:opacity-100" : ""}`}
      >
        <span className="text-muted pl-1.5 text-xs select-none">$</span>
        <input
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="text-primary focus-visible:ring-offset-surface-primary min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-right text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
        />
      </div>
      {changed && originalValue !== 0 && (
        <div className="text-caption text-faint text-right">
          was {formatCurrency(originalValue)}
        </div>
      )}
    </div>
  );
}
