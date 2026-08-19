"use client";

import React, { useCallback } from "react";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { FUND_COLORS } from "@/lib/utils/colors";
import { sumBy, safeDivide } from "@/lib/utils/math";
import { useInlineNumberEdit } from "@/lib/hooks/use-inline-number-edit";

export interface FundAllocation {
  goalId: number;
  name: string;
  defaultAmount: number;
  amount: number;
  colorIndex: number;
}

interface PoolDistributionEditorProps {
  pool: number;
  funds: FundAllocation[];
  onChange: (funds: FundAllocation[]) => void;
  onPoolChange?: (pool: number) => void;
  poolEditable?: boolean;
}

function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}

type EditField =
  | { kind: "pool" }
  | { kind: "amount"; goalId: number }
  | { kind: "percent"; goalId: number };

export function PoolDistributionEditor({
  pool,
  funds,
  onChange,
  onPoolChange,
  poolEditable = false,
}: PoolDistributionEditorProps) {
  const total = sumBy(funds, (f) => f.amount);
  const isBalanced = Math.abs(total - pool) < 1;
  const isUnderAllocated = total < pool - 1;
  const isOverAllocated = total > pool + 1;
  const remaining = pool - total;

  const updateFundAmount = useCallback(
    (goalId: number, newAmount: number) => {
      onChange(
        funds.map((f) =>
          f.goalId === goalId ? { ...f, amount: roundToCents(newAmount) } : f,
        ),
      );
    },
    [funds, onChange],
  );

  const updateFundPercent = useCallback(
    (goalId: number, newPct: number) => {
      const newAmount = roundToCents((newPct / 100) * pool);
      updateFundAmount(goalId, newAmount);
    },
    [pool, updateFundAmount],
  );

  const distributeRemaining = useCallback(() => {
    if (Math.abs(remaining) < 0.01) return;
    const totalCurrent = sumBy(funds, (f) => f.amount);
    if (totalCurrent === 0) {
      // Distribute equally
      const perFund = roundToCents(pool / funds.length);
      const updated = funds.map((f, i) => ({
        ...f,
        amount:
          i === funds.length - 1
            ? pool - perFund * (funds.length - 1)
            : perFund,
      }));
      onChange(updated);
    } else {
      // Distribute proportionally
      const updated = funds.map((f) => ({
        ...f,
        amount: roundToCents((f.amount / totalCurrent) * pool),
      }));
      // Fix rounding on last fund
      const newTotal = sumBy(updated, (f) => f.amount);
      if (updated.length > 0) {
        updated[updated.length - 1]!.amount += roundToCents(pool - newTotal);
      }
      onChange(updated);
    }
  }, [funds, pool, remaining, onChange]);

  const {
    editingKey: editingField,
    editValue,
    setEditValue,
    startEdit,
    commit,
    handleKeyDown,
  } = useInlineNumberEdit<EditField>({
    onCommit: (field, value) => {
      const val = parseFloat(value);
      if (isNaN(val) || val < 0) return;
      if (field.kind === "pool") {
        if (onPoolChange) onPoolChange(roundToCents(val));
      } else if (field.kind === "amount") {
        updateFundAmount(field.goalId, val);
      } else if (val <= 100) {
        updateFundPercent(field.goalId, val);
      }
    },
  });
  const isEditing = (field: EditField) =>
    editingField !== null &&
    editingField.kind === field.kind &&
    ("goalId" in editingField ? editingField.goalId : undefined) ===
      ("goalId" in field ? field.goalId : undefined);

  return (
    <div className="space-y-4">
      {/* Pool total */}
      <div className="flex items-center justify-between bg-surface-elevated rounded-lg px-4 py-3">
        <span className="text-sm text-secondary font-medium">Monthly Pool</span>
        {poolEditable && isEditing({ kind: "pool" }) ? (
          <div className="flex items-center gap-1.5">
            <span className="text-muted">$</span>
            <input
              type="number"
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commit}
              onKeyDown={handleKeyDown}
              className="w-28 text-right text-sm border border-blue-400 bg-surface-primary text-primary rounded px-2 py-1 tabular-nums"
            />
          </div>
        ) : (
          <button
            onClick={
              poolEditable
                ? () => startEdit({ kind: "pool" }, Math.round(pool))
                : undefined
            }
            className={`text-lg font-semibold tabular-nums text-primary ${
              poolEditable ? "cursor-pointer hover:text-blue-500" : ""
            }`}
          >
            {formatCurrency(pool)}/mo
          </button>
        )}
      </div>

      {/* Fund rows */}
      <div className="space-y-2">
        {funds.map((fund) => {
          const pct = safeDivide(fund.amount, pool, 0) * 100;
          const isDefault = Math.abs(fund.amount - fund.defaultAmount) < 0.01;
          const color = FUND_COLORS[fund.colorIndex % FUND_COLORS.length]!;

          return (
            <div
              key={fund.goalId}
              className={`rounded-lg px-4 py-3 border ${
                isDefault
                  ? "border bg-surface-sunken"
                  : "border-blue-300 bg-blue-50"
              }`}
            >
              {/* Fund name + indicator */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-sm font-medium text-primary">
                    {fund.name}
                  </span>
                  {!isDefault && (
                    <span className="text-caption text-blue-600 font-medium">
                      OVERRIDE
                    </span>
                  )}
                </div>
                {!isDefault && (
                  <button
                    onClick={() =>
                      updateFundAmount(fund.goalId, fund.defaultAmount)
                    }
                    className="text-caption text-faint hover:text-muted"
                  >
                    Reset
                  </button>
                )}
              </div>

              {/* Slider */}
              <div className="mb-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.5"
                  value={pct}
                  onChange={(e) =>
                    updateFundPercent(fund.goalId, parseFloat(e.target.value))
                  }
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, ${color} ${pct}%, var(--slider-track, #d1d5db) ${pct}%)`,
                  }}
                />
              </div>

              {/* % and $ inputs */}
              <div className="flex items-center justify-between">
                {/* Percent */}
                {isEditing({ kind: "percent", goalId: fund.goalId }) ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commit}
                      onKeyDown={handleKeyDown}
                      step="0.1"
                      className="w-16 text-right text-sm border border-blue-400 bg-surface-primary text-primary rounded px-2 py-1 tabular-nums"
                    />
                    <span className="text-xs text-muted">%</span>
                  </div>
                ) : (
                  <button
                    onClick={() =>
                      startEdit(
                        { kind: "percent", goalId: fund.goalId },
                        pct.toFixed(1),
                      )
                    }
                    className="text-sm tabular-nums text-muted hover:text-secondary cursor-pointer"
                  >
                    {formatPercent(pct / 100, 1)}
                  </button>
                )}

                {/* Dollar amount */}
                {isEditing({ kind: "amount", goalId: fund.goalId }) ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted">$</span>
                    <input
                      type="number"
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commit}
                      onKeyDown={handleKeyDown}
                      className="w-24 text-right text-sm border border-blue-400 bg-surface-primary text-primary rounded px-2 py-1 tabular-nums"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() =>
                      startEdit(
                        { kind: "amount", goalId: fund.goalId },
                        Math.round(fund.amount * 100) / 100,
                      )
                    }
                    className="text-sm tabular-nums font-semibold text-primary hover:text-blue-500 cursor-pointer"
                  >
                    {formatCurrency(fund.amount)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Constraint bar */}
      <div className="flex items-center justify-between bg-surface-elevated rounded-lg px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-medium tabular-nums ${
              isBalanced
                ? "text-green-600"
                : isOverAllocated
                  ? "text-red-600"
                  : "text-amber-600"
            }`}
          >
            Total: {formatCurrency(total)} / {formatCurrency(pool)}
          </span>
          {isBalanced ? (
            <svg
              aria-hidden="true"
              className="w-4 h-4 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          ) : (
            <span
              className={`text-xs ${isOverAllocated ? "text-red-600" : "text-amber-600"}`}
            >
              ({remaining > 0 ? "+" : ""}
              {formatCurrency(remaining)}{" "}
              {remaining > 0 ? "unallocated" : "over"})
            </span>
          )}
        </div>
        {(isUnderAllocated || isOverAllocated) && (
          <button
            onClick={distributeRemaining}
            className="px-2.5 py-1 text-xs bg-surface-strong text-secondary rounded hover:bg-surface-strong"
          >
            Distribute
          </button>
        )}
      </div>
    </div>
  );
}
