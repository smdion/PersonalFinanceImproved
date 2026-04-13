"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { formatCurrency, accountDisplayName } from "@/lib/utils/format";
import { computeGainLoss } from "@/lib/pure/performance";
import type { UpdateFormRow, UpdatePerformanceFormProps } from "./types";

type EndingBalanceSource = "snapshot" | "manual";

export function UpdatePerformanceForm({
  currentYear,
  accountRows: currentYearAccounts,
  onClose,
  onSaved,
}: UpdatePerformanceFormProps) {
  const { data: latestSnap, isLoading: loadingSnap } =
    trpc.settings.portfolioSnapshots.getLatest.useQuery();
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
      return {
        accountPerformanceId: a.id,
        performanceAccountId: a.performanceAccountId,
        displayName: accountDisplayName(
          {
            institution: a.institution,
            accountLabel: a.accountLabel,
            accountType: a.accountType ?? undefined,
          },
          a.ownerName ?? undefined,
        ),
        parentCategory: a.parentCategory,
        beginningBalance: a.beginningBalance,
        totalContributions: String(a.totalContributions),
        employerContributions: String(a.employerContributions),
        distributions: String(a.distributions),
        rollovers: String(a.rollovers),
        fees: String(a.fees),
        endingBalance: String(a.endingBalance),
        yearlyGainLoss: String(a.yearlyGainLoss),
        gainLossOverride: false,
        snapshotEndingBalance: snapBal,
        original: {
          totalContributions: a.totalContributions,
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
      return computeGainLoss({
        endingBalance: getEndingBalance(row),
        beginningBalance: row.beginningBalance,
        totalContributions: parseFloat(row.totalContributions) || 0,
        employerContributions: parseFloat(row.employerContributions) || 0,
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
      return {
        id: r.accountPerformanceId,
        totalContributions: r.totalContributions,
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

  // Group rows by parentCategory
  const groups = new Map<string, UpdateFormRow[]>();
  for (const row of currentRows) {
    const cat = row.parentCategory;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(row);
  }

  const totalGainLoss = currentRows.reduce((sum, r) => {
    const gl = r.gainLossOverride
      ? parseFloat(r.yearlyGainLoss) || 0
      : getComputedGainLoss(r);
    return sum + gl;
  }, 0);

  const snapshotDate = latestSnap?.snapshot?.snapshotDate ?? null;

  if (loadingSnap) {
    return (
      <Card title={`Update Performance (${currentYear})`} className="mb-6">
        <p className="text-sm text-muted">Loading snapshot data...</p>
      </Card>
    );
  }

  return (
    <Card title={`Update Performance (${currentYear})`} className="mb-6">
      <div className="space-y-4">
        {/* Ending balance source toggle */}
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted font-medium">Ending Balance Source:</span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="endingBalanceSource"
              checked={endingBalanceSource === "snapshot"}
              onChange={() => setEndingBalanceSource("snapshot")}
              className="accent-indigo-600"
            />
            <span>
              From Latest Snapshot
              {snapshotDate && (
                <span className="text-faint ml-1">({snapshotDate})</span>
              )}
            </span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="endingBalanceSource"
              checked={endingBalanceSource === "manual"}
              onChange={() => setEndingBalanceSource("manual")}
              className="accent-indigo-600"
            />
            <span>Manual Entry</span>
          </label>
        </div>

        {/* Account groups */}
        {Array.from(groups.entries()).map(([category, groupRows]) => {
          const groupGainLoss = groupRows.reduce((sum, r) => {
            const gl = r.gainLossOverride
              ? parseFloat(r.yearlyGainLoss) || 0
              : getComputedGainLoss(r);
            return sum + gl;
          }, 0);

          return (
            <div key={category}>
              {/* Category header */}
              <div className="flex items-baseline justify-between border-b-2 border-strong pb-1 mb-3">
                <span className="text-sm font-semibold text-primary">
                  {category}
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
        <div className="flex items-baseline justify-between border-t-2 border-strong pt-2">
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
            className="px-3 py-1.5 text-sm text-muted hover:text-primary border border-strong rounded"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={batchMutation.isPending || currentRows.length === 0}
            className="px-4 py-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-50"
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
    </Card>
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

  return (
    <div className="mb-4 last:mb-0">
      {/* Account name */}
      <div className="text-sm font-medium text-primary mb-1.5">
        {row.displayName}
      </div>

      {/* Flow fields */}
      <div className="grid grid-cols-5 gap-2 mb-1.5">
        <FieldInput
          label="Contributions"
          value={row.totalContributions}
          originalValue={row.original.totalContributions}
          onChange={(v) => onFieldChange(id, "totalContributions", v)}
        />
        <FieldInput
          label="Employer"
          value={row.employerContributions}
          originalValue={row.original.employerContributions}
          onChange={(v) => onFieldChange(id, "employerContributions", v)}
        />
        <FieldInput
          label="Distributions"
          value={row.distributions}
          originalValue={row.original.distributions}
          onChange={(v) => onFieldChange(id, "distributions", v)}
        />
        <FieldInput
          label="Rollovers"
          value={row.rollovers}
          originalValue={row.original.rollovers}
          onChange={(v) => onFieldChange(id, "rollovers", v)}
        />
        <FieldInput
          label="Fees"
          value={row.fees}
          originalValue={row.original.fees}
          onChange={(v) => onFieldChange(id, "fees", v)}
        />
      </div>

      {/* Ending balance + gain/loss row */}
      <div className="flex items-center gap-4 text-sm">
        {/* Ending balance */}
        <div className="flex items-center gap-1.5">
          <span className="text-muted">Ending Bal:</span>
          {endingBalanceSource === "snapshot" &&
          row.snapshotEndingBalance !== null ? (
            <span className="font-medium">
              {formatCurrency(row.snapshotEndingBalance)}
              {snapshotDate && (
                <span className="text-faint text-xs ml-1">
                  (snapshot {snapshotDate})
                </span>
              )}
            </span>
          ) : endingBalanceSource === "snapshot" &&
            row.snapshotEndingBalance === null ? (
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                step="0.01"
                value={row.endingBalance}
                onChange={(e) =>
                  onFieldChange(id, "endingBalance", e.target.value)
                }
                className="border rounded px-2 py-0.5 text-sm text-right w-28"
              />
              <span className="text-xs text-amber-600">(no snapshot)</span>
            </span>
          ) : (
            <input
              type="number"
              step="0.01"
              value={row.endingBalance}
              onChange={(e) =>
                onFieldChange(id, "endingBalance", e.target.value)
              }
              className="border rounded px-2 py-0.5 text-sm text-right w-28"
            />
          )}
          {row.original.endingBalance !== effectiveEndingBalance && (
            <span className="text-xs text-faint">
              was {formatCurrency(row.original.endingBalance)}
            </span>
          )}
        </div>

        {/* Gain/loss */}
        <div className="flex items-center gap-1.5">
          <span className="text-muted">Gain/Loss:</span>
          {row.gainLossOverride ? (
            <>
              <input
                type="number"
                step="0.01"
                value={row.yearlyGainLoss}
                onChange={(e) =>
                  onFieldChange(id, "yearlyGainLoss", e.target.value)
                }
                className="border rounded px-2 py-0.5 text-sm text-right w-28"
              />
              <span className="text-xs text-amber-600 italic">manual</span>
              <button
                type="button"
                onClick={() => onFieldChange(id, "gainLossOverride", false)}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                reset
              </button>
            </>
          ) : (
            <>
              <span
                className={`font-medium ${gainLoss >= 0 ? "text-green-600" : "text-red-600"}`}
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
                  className="w-3.5 h-3.5"
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
        </div>
      </div>
    </div>
  );
}

/** Small labeled number input with "was" hint. */
function FieldInput({
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
  const changed = numValue !== originalValue;

  return (
    <div>
      <label className="block text-[10px] font-medium text-muted mb-0.5">
        {label}
      </label>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border rounded px-2 py-0.5 text-sm text-right w-full"
      />
      {changed && originalValue !== 0 && (
        <div className="text-[10px] text-faint text-right">
          was {formatCurrency(originalValue)}
        </div>
      )}
    </div>
  );
}
