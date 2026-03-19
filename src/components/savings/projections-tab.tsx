"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency } from "@/lib/utils/format";
import { PctAllocator } from "./pct-allocator";
import {
  GoalProjection,
  PlannedTxForm,
  emptyTxForm,
  monthKey,
  monthLabel,
} from "./types";

/* ── Toolbar: controls above the table ── */

function ProjectionToolbar({
  projectionYears,
  setProjectionYears,
  annualIncreaseRate,
  setAnnualIncreaseRate,
  showPctAllocator,
  setShowPctAllocator,
}: {
  projectionYears: number;
  setProjectionYears: (y: number) => void;
  annualIncreaseRate: number;
  setAnnualIncreaseRate: (r: number) => void;
  showPctAllocator: boolean;
  setShowPctAllocator: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
      {/* Year range */}
      <div className="flex items-center gap-1">
        {[2, 3, 5].map((y) => (
          <button
            key={y}
            onClick={() => setProjectionYears(y)}
            className={`px-2 py-0.5 text-xs rounded ${
              projectionYears === y
                ? "bg-blue-600 text-white"
                : "bg-surface-elevated text-muted hover:bg-surface-strong"
            }`}
          >
            {y}yr
          </button>
        ))}
      </div>

      {/* Annual raise */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-faint">Annual raise</span>
        <input
          type="number"
          min="0"
          max="20"
          step="0.5"
          value={annualIncreaseRate}
          onChange={(e) => setAnnualIncreaseRate(Number(e.target.value))}
          className="w-12 border rounded px-1 py-0.5 text-xs text-center bg-surface-primary text-primary"
        />
        <span className="text-[10px] text-faint">%</span>
      </div>

      {/* Pct allocator toggle */}
      <button
        onClick={() => setShowPctAllocator(!showPctAllocator)}
        className={`px-2 py-0.5 text-xs rounded ${
          showPctAllocator
            ? "bg-blue-600 text-white"
            : "bg-surface-elevated text-muted hover:bg-surface-strong"
        }`}
      >
        % Allocator
      </button>
    </div>
  );
}

/* ── Budget capacity bar ── */

function BudgetCapacityBar({
  maxMonthlyFunding,
  totalMonthlyAllocation,
  budgetData,
  budgetColumn,
  setBudgetColumn,
}: {
  maxMonthlyFunding: number | null;
  totalMonthlyAllocation: number;
  budgetData:
    | { columnLabels?: string[]; result?: { totalMonthly: number } | null }
    | undefined;
  budgetColumn: number;
  setBudgetColumn: (col: number) => void;
}) {
  const hasMultipleBudgets =
    budgetData?.columnLabels && budgetData.columnLabels.length > 1;
  const hasSingleBudget =
    budgetData?.columnLabels &&
    budgetData.columnLabels.length === 1 &&
    budgetData.result;

  return (
    <>
      {hasMultipleBudgets && (
        <div className="mb-2 flex items-center gap-2 text-xs">
          <span className="text-muted">Budget:</span>
          <div className="flex bg-surface-elevated rounded-lg p-0.5">
            {budgetData!.columnLabels!.map((label: string, idx: number) => (
              <button
                key={label}
                onClick={() => setBudgetColumn(idx)}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  budgetColumn === idx
                    ? "bg-surface-primary text-primary shadow-sm font-medium"
                    : "text-muted hover:text-secondary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-faint ml-1">
            ({formatCurrency(budgetData!.result?.totalMonthly ?? 0)}/mo)
          </span>
        </div>
      )}
      {hasSingleBudget && (
        <div className="mb-2 text-xs text-muted">
          Budget: {budgetData!.columnLabels![0]} —{" "}
          {formatCurrency(budgetData!.result!.totalMonthly)}/mo
        </div>
      )}
      {maxMonthlyFunding !== null && (
        <div
          className={`mb-3 px-3 py-2 rounded-lg text-sm flex items-center justify-between ${
            totalMonthlyAllocation > maxMonthlyFunding
              ? "bg-red-50 border border-red-200"
              : "bg-green-50 border border-green-200"
          }`}
        >
          <div className="flex items-center gap-4">
            <span className="text-muted">
              Budget leftover:{" "}
              <span className="font-semibold text-primary">
                {formatCurrency(maxMonthlyFunding)}
              </span>
              /mo
            </span>
            <span className="text-faint">|</span>
            <span className="text-muted">
              Allocated:{" "}
              <span className="font-semibold text-primary">
                {formatCurrency(totalMonthlyAllocation)}
              </span>
              /mo
            </span>
          </div>
          <span
            className={`font-semibold ${
              totalMonthlyAllocation > maxMonthlyFunding
                ? "text-red-600"
                : "text-green-600"
            }`}
          >
            {totalMonthlyAllocation > maxMonthlyFunding
              ? `Over by ${formatCurrency(totalMonthlyAllocation - maxMonthlyFunding)}`
              : `${formatCurrency(maxMonthlyFunding - totalMonthlyAllocation)} unallocated`}
          </span>
        </div>
      )}
    </>
  );
}

/* ── Inline override editor with bulk actions ── */

function OverrideEditor({
  value,
  defaultAllocation,
  goalId,
  monthDate,
  monthDates,
  monthIndex,
  onSave,
  onDelete,
  onBatchUpsert,
  onClose,
}: {
  value: string;
  defaultAllocation: number;
  goalId: number;
  monthDate: string;
  monthDates: Date[];
  monthIndex: number;
  onSave: (params: {
    goalId: number;
    monthDate: string;
    amount: number;
  }) => void;
  onDelete: (params: { goalId: number; monthDate: string }) => void;
  onBatchUpsert: (params: {
    goalId: number;
    overrides: { monthDate: string; amount: number }[];
  }) => void;
  onClose: () => void;
}) {
  const [editValue, setEditValue] = useState(value);

  const commit = () => {
    const val = parseFloat(editValue);
    if (!isNaN(val)) {
      if (val === defaultAllocation) {
        onDelete({ goalId, monthDate });
      } else {
        onSave({ goalId, monthDate, amount: val });
      }
    }
    onClose();
  };

  const formatMonthDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

  return (
    <div className="relative">
      <input
        type="number"
        autoFocus
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={(e) => {
          if (e.relatedTarget?.closest("[data-bulk-action]")) return;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") onClose();
        }}
        className="w-full max-w-[70px] text-right text-[10px] border border-blue-400 rounded px-1 py-0 tabular-nums ml-auto block bg-surface-primary text-primary"
      />
      <div
        className="absolute right-0 top-full mt-0.5 z-20 flex gap-0.5"
        data-bulk-action
      >
        <button
          tabIndex={0}
          data-bulk-action
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const val = parseFloat(editValue);
            if (isNaN(val)) return;
            const overrides = monthDates.slice(monthIndex).map((md) => ({
              monthDate: formatMonthDate(md),
              amount: val,
            }));
            onBatchUpsert({ goalId, overrides });
            onClose();
          }}
          className="px-1.5 py-0.5 text-[10px] bg-blue-600 text-white rounded whitespace-nowrap hover:bg-blue-700"
          title="Apply to all months from here onward"
        >
          Fill &darr;
        </button>
        <button
          tabIndex={0}
          data-bulk-action
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const val = parseFloat(editValue);
            if (isNaN(val)) return;
            const end = Math.min(monthIndex + 6, monthDates.length);
            const overrides = monthDates.slice(monthIndex, end).map((md) => ({
              monthDate: formatMonthDate(md),
              amount: val,
            }));
            onBatchUpsert({ goalId, overrides });
            onClose();
          }}
          className="px-1.5 py-0.5 text-[10px] bg-surface-strong text-white rounded whitespace-nowrap hover:bg-surface-elevated"
          title="Apply to next 6 months"
        >
          &times;6
        </button>
      </div>
    </div>
  );
}

/* ── Single projection cell ── */

function ProjectionCell({
  gp,
  monthIndex,
  mk,
  d,
  monthDates,
  editingCell,
  setEditingCell,
  onUpsertOverride,
  onDeleteOverride,
  onBatchUpsert,
}: {
  gp: GoalProjection;
  monthIndex: number;
  mk: string;
  d: Date;
  monthDates: Date[];
  editingCell: string | null;
  setEditingCell: (key: string | null) => void;
  onUpsertOverride: (params: {
    goalId: number;
    monthDate: string;
    amount: number;
  }) => void;
  onDeleteOverride: (params: { goalId: number; monthDate: string }) => void;
  onBatchUpsert: (params: {
    goalId: number;
    overrides: { monthDate: string; amount: number }[];
  }) => void;
}) {
  const bal = gp.balances[monthIndex]!;
  const events = gp.monthEvents[monthIndex];
  const alloc = gp.monthlyAllocations[monthIndex]!;
  const isOverridden = gp.hasOverride[monthIndex];
  const hasWithdrawal = events?.some((e) => e.amount < 0);
  const hasDeposit = events?.some((e) => e.amount > 0);
  const isNegative = bal < 0;
  const cellKey = `${gp.goalId}:${mk}`;
  const isEditing = editingCell === cellKey;
  const reachedTarget = gp.target > 0 && bal >= gp.target;

  const bgClass = isNegative
    ? "bg-red-100"
    : hasWithdrawal
      ? "bg-red-50"
      : hasDeposit
        ? "bg-green-50"
        : "";

  const monthDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

  return (
    <td className={`text-right py-1.5 px-2 align-top ${bgClass}`}>
      {/* Balance — primary number */}
      <div
        className={`text-xs tabular-nums font-medium ${
          isNegative
            ? "text-red-700"
            : reachedTarget
              ? "text-green-600"
              : "text-primary"
        }`}
      >
        {formatCurrency(bal)}
      </div>

      {/* Allocation — editable secondary line */}
      <div className="mt-0.5">
        {isEditing ? (
          <OverrideEditor
            value={String(Math.round(alloc))}
            defaultAllocation={gp.monthlyAllocation}
            goalId={gp.goalId}
            monthDate={monthDate}
            monthDates={monthDates}
            monthIndex={monthIndex}
            onSave={onUpsertOverride}
            onDelete={onDeleteOverride}
            onBatchUpsert={onBatchUpsert}
            onClose={() => setEditingCell(null)}
          />
        ) : (
          <button
            onClick={() => setEditingCell(cellKey)}
            className={`text-[10px] tabular-nums leading-none ${
              isOverridden
                ? "text-blue-600 font-semibold underline decoration-dotted"
                : "text-faint hover:text-blue-500"
            }`}
            title="Click to override this month's contribution"
          >
            +{formatCurrency(alloc)}
          </button>
        )}
      </div>

      {/* Events — only when present */}
      {events && (
        <div className="mt-0.5">
          {events.map((e, ei) => (
            <div
              key={ei}
              className={`text-[10px] leading-tight truncate ${
                e.amount < 0 ? "text-red-500" : "text-green-600"
              }`}
              title={`${e.description}: ${e.amount >= 0 ? "+" : ""}${formatCurrency(e.amount)}`}
            >
              {e.description} {e.amount >= 0 ? "+" : ""}
              {formatCurrency(e.amount)}
            </div>
          ))}
        </div>
      )}
    </td>
  );
}

/* ── Add Transaction Form ── */

function AddTransactionForm({
  goalName,
  txForm,
  setTxForm,
  onAddTx,
  createTxPending,
  onCancel,
}: {
  goalName: string;
  txForm: PlannedTxForm;
  setTxForm: (form: PlannedTxForm) => void;
  onAddTx: () => void;
  createTxPending: boolean;
  onCancel: () => void;
}) {
  return (
    <Card title={`Add Transaction — ${goalName}`} className="mb-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-muted mb-1">Date</label>
          <input
            type="date"
            value={txForm.transactionDate}
            onChange={(e) =>
              setTxForm({ ...txForm, transactionDate: e.target.value })
            }
            className="w-full border rounded px-2 py-1 text-sm bg-surface-primary text-primary"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">
            Amount (negative = spending)
          </label>
          <input
            type="number"
            step="0.01"
            value={txForm.amount}
            onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })}
            placeholder="-5000"
            className="w-full border rounded px-2 py-1 text-sm bg-surface-primary text-primary"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Description</label>
          <input
            type="text"
            value={txForm.description}
            onChange={(e) =>
              setTxForm({ ...txForm, description: e.target.value })
            }
            placeholder="Spain trip"
            className="w-full border rounded px-2 py-1 text-sm bg-surface-primary text-primary"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Recurring?</label>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={txForm.isRecurring}
              onChange={(e) =>
                setTxForm({ ...txForm, isRecurring: e.target.checked })
              }
            />
            {txForm.isRecurring && (
              <input
                type="number"
                value={txForm.recurrenceMonths}
                onChange={(e) =>
                  setTxForm({ ...txForm, recurrenceMonths: e.target.value })
                }
                placeholder="every N months"
                className="border rounded px-2 py-1 text-sm w-24 bg-surface-primary text-primary"
              />
            )}
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={onAddTx}
          disabled={createTxPending}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {createTxPending ? "Saving..." : "Add"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 border rounded text-sm hover:bg-surface-sunken"
        >
          Cancel
        </button>
      </div>
    </Card>
  );
}

/* ── Main component ── */

export function ProjectionsTab({
  goalProjections,
  monthDates,
  totalBalances,
  totalSaved,
  totalMonthlyAllocation,
  maxMonthlyFunding,
  budgetData,
  budgetColumn,
  setBudgetColumn,
  projectionYears,
  setProjectionYears,
  annualIncreaseRate,
  setAnnualIncreaseRate,
  onGoalUpdate,
  onUpsertOverride,
  onDeleteOverride,
  onBatchUpsert,
  addingTxForGoal,
  setAddingTxForGoal,
  txForm,
  setTxForm,
  onAddTx,
  createTxPending,
  goalById,
  canEdit,
}: {
  goalProjections: GoalProjection[];
  monthDates: Date[];
  totalBalances: number[];
  totalSaved: number;
  totalMonthlyAllocation: number;
  maxMonthlyFunding: number | null;
  budgetData:
    | {
        columnLabels?: string[];
        result?: { totalMonthly: number } | null;
      }
    | undefined;
  budgetColumn: number;
  setBudgetColumn: (col: number) => void;
  projectionYears: number;
  setProjectionYears: (years: number) => void;
  annualIncreaseRate: number;
  setAnnualIncreaseRate: (rate: number) => void;
  onGoalUpdate: (goalId: number, field: string, value: string) => void;
  onUpsertOverride: (params: {
    goalId: number;
    monthDate: string;
    amount: number;
  }) => void;
  onDeleteOverride: (params: { goalId: number; monthDate: string }) => void;
  onBatchUpsert: (params: {
    goalId: number;
    overrides: { monthDate: string; amount: number }[];
  }) => void;
  addingTxForGoal: number | null;
  setAddingTxForGoal: (goalId: number | null) => void;
  txForm: PlannedTxForm;
  setTxForm: (form: PlannedTxForm) => void;
  onAddTx: () => void;
  createTxPending: boolean;
  goalById: Map<number, { name: string }>;
  canEdit?: boolean;
}) {
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [showPctAllocator, setShowPctAllocator] = useState(false);

  return (
    <>
      <Card title="Sinking Fund Projection" className="mb-4">
        {/* Controls */}
        <ProjectionToolbar
          projectionYears={projectionYears}
          setProjectionYears={setProjectionYears}
          annualIncreaseRate={annualIncreaseRate}
          setAnnualIncreaseRate={setAnnualIncreaseRate}
          showPctAllocator={showPctAllocator}
          setShowPctAllocator={setShowPctAllocator}
        />

        {/* Budget & funding capacity */}
        <BudgetCapacityBar
          maxMonthlyFunding={maxMonthlyFunding}
          totalMonthlyAllocation={totalMonthlyAllocation}
          budgetData={budgetData}
          budgetColumn={budgetColumn}
          setBudgetColumn={setBudgetColumn}
        />

        {/* Percentage Allocator (collapsible) */}
        {showPctAllocator && (
          <div className="mb-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-blue-800">
                Percentage Allocator — set a total pool and distribute by %
              </p>
              <button
                onClick={() => setShowPctAllocator(false)}
                className="text-xs text-faint hover:text-muted"
              >
                Close
              </button>
            </div>
            <PctAllocator
              goals={goalProjections}
              defaultPool={maxMonthlyFunding ?? totalMonthlyAllocation}
              onApply={(allocations) => {
                for (const { goalId, amount } of allocations) {
                  onGoalUpdate(
                    goalId,
                    "monthlyContribution",
                    String(Math.round(amount)),
                  );
                }
                setShowPctAllocator(false);
              }}
            />
          </div>
        )}

        {/* Projection table */}
        <div className="overflow-y-auto max-h-[70vh]">
          <table className="w-full text-xs border-collapse table-fixed">
            <thead className="sticky top-0 bg-surface-primary z-10">
              {/* Column headers */}
              <tr className="border-b-2 border-strong">
                <th className="text-left py-2 pr-3 text-muted font-medium w-20">
                  Month
                </th>
                {goalProjections.map((gp) => (
                  <th key={gp.goalId} className="text-right py-2 px-2 w-32">
                    <div className="flex items-center justify-end gap-1">
                      {canEdit !== false && (
                        <button
                          onClick={() => {
                            setAddingTxForGoal(gp.goalId);
                            setTxForm(emptyTxForm(gp.goalId));
                          }}
                          className="inline-flex items-center justify-center w-4 h-4 rounded bg-blue-100 text-blue-600 hover:bg-blue-200 text-[10px] font-bold"
                          title="Add planned transaction"
                        >
                          +
                        </button>
                      )}
                      <span className="text-secondary font-semibold">
                        {gp.name}
                      </span>
                    </div>
                    <div className="font-normal text-faint mt-0.5">
                      {canEdit !== false ? (
                        <InlineEdit
                          value={String(gp.monthlyAllocation)}
                          onSave={(v) =>
                            onGoalUpdate(gp.goalId, "monthlyContribution", v)
                          }
                          formatDisplay={(v) => {
                            const amt = Number(v);
                            const pct =
                              totalMonthlyAllocation > 0
                                ? (amt / totalMonthlyAllocation) * 100
                                : 0;
                            return `${formatCurrency(amt)}/mo (${pct.toFixed(0)}%)`;
                          }}
                          parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                          type="number"
                          className="text-xs"
                        />
                      ) : (
                        <span className="text-xs">
                          {formatCurrency(gp.monthlyAllocation)}/mo
                          {totalMonthlyAllocation > 0 &&
                            ` (${((gp.monthlyAllocation / totalMonthlyAllocation) * 100).toFixed(0)}%)`}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
                <th className="text-right py-2 px-2 text-secondary font-semibold">
                  Total
                </th>
              </tr>

              {/* Current balance row */}
              <tr className="border-b bg-surface-sunken">
                <td className="py-1.5 pr-3 text-muted font-medium">Now</td>
                {goalProjections.map((gp) => (
                  <td
                    key={gp.goalId}
                    className="text-right py-1.5 px-2 font-semibold text-primary"
                  >
                    {formatCurrency(gp.current)}
                  </td>
                ))}
                <td className="text-right py-1.5 px-2 font-semibold text-primary">
                  {formatCurrency(totalSaved)}
                </td>
              </tr>
            </thead>

            <tbody>
              {monthDates.map((d, i) => {
                const mk = monthKey(d);
                const isYearBoundary = d.getMonth() === 0 && i > 0;
                const isEvenRow = i % 2 === 0;
                return (
                  <tr
                    key={mk}
                    className={`border-b ${
                      isYearBoundary
                        ? "border-strong border-t-2"
                        : "border-subtle"
                    } ${isEvenRow && !isYearBoundary ? "bg-surface-sunken/50" : ""}`}
                  >
                    <td
                      className={`py-1.5 pr-3 text-muted whitespace-nowrap ${
                        isYearBoundary ? "font-semibold" : ""
                      }`}
                    >
                      {monthLabel(d)}
                    </td>

                    {goalProjections.map((gp) => (
                      <ProjectionCell
                        key={gp.goalId}
                        gp={gp}
                        monthIndex={i}
                        mk={mk}
                        d={d}
                        monthDates={monthDates}
                        editingCell={editingCell}
                        setEditingCell={setEditingCell}
                        onUpsertOverride={onUpsertOverride}
                        onDeleteOverride={onDeleteOverride}
                        onBatchUpsert={onBatchUpsert}
                      />
                    ))}

                    <td className="text-right py-1.5 px-2 font-medium text-secondary">
                      {formatCurrency(totalBalances[i]!)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Transaction Form */}
      {canEdit !== false && addingTxForGoal !== null && (
        <AddTransactionForm
          goalName={goalById.get(addingTxForGoal)?.name ?? "Fund"}
          txForm={txForm}
          setTxForm={setTxForm}
          onAddTx={onAddTx}
          createTxPending={createTxPending}
          onCancel={() => setAddingTxForGoal(null)}
        />
      )}
    </>
  );
}
