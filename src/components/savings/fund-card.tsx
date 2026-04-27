"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { ChevronRight, ChevronDown } from "lucide-react";
import { InlineEdit } from "@/components/ui/inline-edit";
import { confirm } from "@/components/ui/confirm-dialog";
import { formatCurrency, formatDate } from "@/lib/utils/format";

// Code-split the per-fund Recharts mini chart (v0.5 expert-review M8). All
// FundCard instances on the page share a single chunk, so the recharts
// payload is fetched once when the savings page hydrates instead of being
// inlined in the page bundle. ssr:false because Recharts isn't SSR-friendly.
const FundMiniChart = dynamic(
  () => import("./fund-mini-chart").then((m) => ({ default: m.FundMiniChart })),
  {
    loading: () => (
      <div
        className="h-20 w-full bg-surface-sunken/40 rounded animate-pulse"
        aria-hidden="true"
      />
    ),
    ssr: false,
  },
);
import { FundTransactionList } from "./fund-transaction-list";
import { FundOverridesSummary } from "./fund-overrides-summary";
import { GoalProjection, PlannedTxForm, NewFundForm } from "./types";

interface RawGoal {
  id: number;
  name: string;
  monthlyContribution: string | null;
  isActive: boolean;
  isEmergencyFund: boolean;
  targetDate: string | null;
  targetAmount: string | null;
  targetMode: string;
  parentGoalId: number | null;
  priority: number;
  apiCategoryId?: string | null;
  apiCategoryName?: string | null;
  isApiSyncEnabled?: boolean | null;
}

interface PlannedTransaction {
  id: number;
  goalId: number;
  transactionDate: string;
  description: string;
  amount: number;
  isRecurring: boolean;
  recurrenceMonths: number | null;
  transferPairId?: string | null;
}

interface AllocationOverride {
  goalId: number;
  monthDate: string;
  amount: number;
}

interface SavingsGoalSummary {
  goalId: number;
  name: string;
  monthlyAllocation: number;
  current: number;
  target: number;
  progress: number;
  monthsToTarget: number | null;
}

/** Determine goal status for clear visual indicator */
function getGoalStatus(
  savingsGoal: SavingsGoalSummary,
  rawGoal: RawGoal,
  projection: GoalProjection,
  transactions: PlannedTransaction[],
): { label: string; color: string; bgColor: string; borderColor: string } {
  // Balance goes negative — needs attention regardless
  const goesNegative = projection.balances.some((b) => b < 0);
  if (goesNegative) {
    return {
      label: "Needs attention",
      color: "text-red-600",
      bgColor: "bg-red-100",
      borderColor: "border-red-200",
    };
  }

  // Emergency fund with target — special case (only fund type with a target)
  if (rawGoal.isEmergencyFund && savingsGoal.target > 0) {
    if (savingsGoal.current >= savingsGoal.target) {
      return {
        label: "Funded",
        color: "text-green-600",
        bgColor: "bg-green-100",
        borderColor: "border-green-200",
      };
    }
    if (savingsGoal.monthlyAllocation > 0) {
      return {
        label: "In progress",
        color: "text-blue-600",
        bgColor: "bg-blue-100",
        borderColor: "border-blue-200",
      };
    }
    return {
      label: "Not funded",
      color: "text-muted",
      bgColor: "bg-surface-elevated",
      borderColor: "border-strong/50",
    };
  }

  // Fixed sinking funds — one-time target (ongoing goals have no fixed target)
  if (rawGoal.targetMode === "fixed" && savingsGoal.target > 0) {
    if (savingsGoal.current >= savingsGoal.target) {
      return {
        label: "Funded",
        color: "text-green-600",
        bgColor: "bg-green-100",
        borderColor: "border-green-200",
      };
    }
    // No target date (or past) means the target is "now" — treat as behind
    const targetDate = rawGoal.targetDate
      ? new Date(rawGoal.targetDate + "T00:00:00")
      : null;
    const isPast = !targetDate || targetDate <= new Date();
    if (isPast) {
      return {
        label: "Behind",
        color: "text-red-600",
        bgColor: "bg-red-100",
        borderColor: "border-red-200",
      };
    }
    if (savingsGoal.monthlyAllocation > 0) {
      return {
        label: "On track",
        color: "text-blue-600",
        bgColor: "bg-blue-100",
        borderColor: "border-blue-200",
      };
    }
    return {
      label: "No contribution",
      color: "text-amber-600",
      bgColor: "bg-amber-100",
      borderColor: "border-amber-200",
    };
  }

  // Sinking funds without a target — just accumulating
  const hasPlannedExpenses = transactions.some((t) => t.amount < 0);
  if (hasPlannedExpenses && savingsGoal.monthlyAllocation > 0) {
    return {
      label: "On track",
      color: "text-green-600",
      bgColor: "bg-green-100",
      borderColor: "border-green-200",
    };
  }
  if (savingsGoal.monthlyAllocation > 0) {
    return {
      label: "Accumulating",
      color: "text-blue-600",
      bgColor: "bg-blue-100",
      borderColor: "border-blue-200",
    };
  }
  return {
    label: "Not funded",
    color: "text-faint",
    bgColor: "bg-surface-elevated/40",
    borderColor: "border/50",
  };
}

export function FundCard({
  projection,
  rawGoal,
  savingsGoal,
  children: childGoals,
  savingsGoals,
  transactions,
  overrides,
  monthDates,
  totalMonthlyAllocation,
  fundColor,
  onGoalUpdate,
  onGoalUpdateMulti,
  maxMonthlyFunding,
  onDeleteGoal,
  onDeleteTx,
  onDeleteTransfer,
  goalById,
  onAddTx,
  createTxPending,
  onUpdateTx,
  updateTxPending,
  apiServiceName,
  onEditMonth,
  onDeleteOverride,
  onTimelineClick,
  addingSubGoalForFund,
  setAddingSubGoalForFund,
  newFund,
  setNewFund,
  onCreateFund,
  createGoalPending,
  canEdit,
  apiBalance,
  onLinkToApi,
  onUnlinkFromApi,
  onConvertToBudgetItem,
  onUpdateParent,
  availableParents,
}: {
  projection: GoalProjection;
  rawGoal: RawGoal;
  savingsGoal: SavingsGoalSummary;
  children: RawGoal[];
  savingsGoals: SavingsGoalSummary[];
  transactions: PlannedTransaction[];
  overrides: AllocationOverride[];
  monthDates: Date[];
  totalMonthlyAllocation: number;
  fundColor: string;
  onGoalUpdate: (goalId: number, field: string, value: string) => void;
  onGoalUpdateMulti?: (goalId: number, fields: Record<string, string>) => void;
  maxMonthlyFunding?: number | null;
  onDeleteGoal: (params: { id: number }) => void;
  onDeleteTx: (params: { id: number }) => void;
  onDeleteTransfer?: (params: { transferPairId: string }) => void;
  goalById?: Map<number, { name: string }>;
  onAddTx: (form: PlannedTxForm) => void;
  createTxPending: boolean;
  onUpdateTx?: (id: number, form: PlannedTxForm) => void;
  updateTxPending?: boolean;
  apiServiceName?: string | null;
  onEditMonth: (monthDate: Date) => void;
  onDeleteOverride: (params: { goalId: number; monthDate: string }) => void;
  onTimelineClick: (goalId: number, monthIndex: number) => void;
  addingSubGoalForFund: number | null;
  setAddingSubGoalForFund: (id: number | null) => void;
  newFund: NewFundForm;
  setNewFund: (form: NewFundForm) => void;
  onCreateFund: () => void;
  createGoalPending: boolean;
  canEdit?: boolean;
  apiBalance?: { balance: number; budgeted: number; activity: number } | null;
  onLinkToApi?: (goalId: number) => void;
  onUnlinkFromApi?: (goalId: number) => void;
  onConvertToBudgetItem?: (goalId: number, name: string) => void;
  onUpdateParent?: (childGoalId: number, newParentId: number | null) => void;
  availableParents?: { id: number; name: string }[];
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [reassigningChildId, setReassigningChildId] = useState<number | null>(
    null,
  );
  const status = getGoalStatus(savingsGoal, rawGoal, projection, transactions);
  const pct =
    totalMonthlyAllocation > 0
      ? ((projection.monthlyAllocation / totalMonthlyAllocation) * 100).toFixed(
          0,
        )
      : "0";
  const progress =
    savingsGoal.target > 0
      ? Math.min(savingsGoal.current / savingsGoal.target, 1)
      : 0;
  const progressPct = (progress * 100).toFixed(0);

  const serviceLabel = (apiServiceName ?? "API").toUpperCase();

  /* ── Menu dropdown (shared by compact row) ── */
  const menuDropdown = canEdit !== false && !rawGoal.isEmergencyFund && (
    <div className="relative shrink-0">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowMenu(!showMenu);
        }}
        className="text-faint hover:text-secondary text-sm px-1.5 py-0.5 rounded"
        title="Actions"
      >
        &#8943;
      </button>
      {showMenu && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(false);
            }}
          />
          <div className="absolute right-0 top-full mt-1 z-20 bg-surface-primary border rounded-md shadow-lg py-1 min-w-[130px]">
            {onLinkToApi && !rawGoal.isApiSyncEnabled && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(false);
                  onLinkToApi(rawGoal.id);
                }}
                className="block w-full text-left px-3 py-1 text-xs text-blue-600 hover:bg-surface-elevated"
              >
                Link to API
              </button>
            )}
            {onUnlinkFromApi && rawGoal.isApiSyncEnabled && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(false);
                  onUnlinkFromApi(rawGoal.id);
                }}
                className="block w-full text-left px-3 py-1 text-xs text-faint hover:bg-surface-elevated"
              >
                Unlink API
              </button>
            )}
            {!rawGoal.isEmergencyFund && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(false);
                  onGoalUpdate(
                    projection.goalId,
                    "targetMode",
                    rawGoal.targetMode === "ongoing" ? "fixed" : "ongoing",
                  );
                }}
                className="block w-full text-left px-3 py-1 text-xs text-secondary hover:bg-surface-elevated"
              >
                {rawGoal.targetMode === "ongoing"
                  ? "Set Fixed Target"
                  : "Set Ongoing"}
              </button>
            )}
            {onConvertToBudgetItem && !rawGoal.isEmergencyFund && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  setShowMenu(false);
                  if (
                    await confirm(
                      `Convert "${projection.name}" to a budget item? This will delete the sinking fund and its history.`,
                    )
                  )
                    onConvertToBudgetItem(rawGoal.id, projection.name);
                }}
                className="block w-full text-left px-3 py-1 text-xs text-amber-600 hover:bg-surface-elevated"
              >
                → Budget Item
              </button>
            )}
            <button
              onClick={async (e) => {
                e.stopPropagation();
                setShowMenu(false);
                if (await confirm(`Delete "${projection.name}"?`))
                  onDeleteGoal({ id: rawGoal.id });
              }}
              className="block w-full text-left px-3 py-1 text-xs text-red-600 hover:bg-surface-elevated"
            >
              Delete Fund
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div
      id={`fund-card-${projection.goalId}`}
      className="bg-surface-primary rounded-lg border shadow-sm hover:shadow-md transition-shadow"
    >
      {/* ── Compact summary row (always visible) ── */}
      <div
        className="w-full flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none"
        onClick={() => setCollapsed(!collapsed)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setCollapsed(!collapsed);
        }}
      >
        {/* Chevron + color dot */}
        <span className="text-faint shrink-0">
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </span>
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: fundColor }}
        />

        {/* Name — left zone, takes available space */}
        <span className="font-semibold text-sm text-primary truncate flex-1 min-w-0">
          {projection.name}
        </span>

        {/* Status — fixed width column, colored text only */}
        <span
          className={`text-[11px] font-medium w-[110px] text-right shrink-0 ${status.color}`}
        >
          {status.label}
        </span>

        {/* Balance — fixed width column */}
        <span className="text-sm font-bold text-primary tabular-nums w-[108px] text-right shrink-0">
          {formatCurrency(savingsGoal.current)}
        </span>

        {/* Monthly — fixed width column, muted when $0 */}
        <span
          className={`text-xs font-semibold tabular-nums w-[80px] text-right shrink-0 ${
            projection.monthlyAllocation > 0 ? "text-green-600" : "text-muted"
          }`}
        >
          {formatCurrency(projection.monthlyAllocation)}/mo
        </span>

        {/* Menu — fixed-width slot so all rows have identical right padding */}
        <div className="w-6 shrink-0 flex justify-center">{menuDropdown}</div>
      </div>

      {/* ── Expanded body ── */}
      {!collapsed && (
        <div className="px-4 pb-4 pt-1 border-t">
          {/* ── API sync panel (when linked) ── */}
          {apiBalance && rawGoal.isApiSyncEnabled && (
            <div className="mb-2 mt-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-blue-600 font-medium">
                  {rawGoal.apiCategoryName}
                </span>
              </div>
              <div className="space-y-0.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-blue-500/70">
                    ↓ Balance from {serviceLabel}
                  </span>
                  <span className="text-blue-300 font-semibold tabular-nums">
                    {formatCurrency(apiBalance.balance)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-blue-500/70">
                    ↑ Monthly goal pushed to {serviceLabel}
                  </span>
                  <span className="text-blue-300 tabular-nums">
                    {formatCurrency(apiBalance.budgeted)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-blue-500/70">
                    Spent in {serviceLabel}
                  </span>
                  <span className="text-blue-300/70 tabular-nums">
                    {formatCurrency(apiBalance.activity)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ── Goal progress: the main story ── */}
          <div className="mb-3 mt-3 bg-surface-sunken rounded-lg p-3 border border-subtle/50">
            {/* Balance + upcoming info */}
            <div className="flex items-baseline justify-between mb-2">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-primary tabular-nums">
                  {formatCurrency(savingsGoal.current)}
                </span>
                {(rawGoal.targetMode === "fixed" ||
                  rawGoal.isEmergencyFund) && (
                  <>
                    <span className="text-faint text-lg">/</span>
                    {canEdit !== false && !rawGoal.isEmergencyFund ? (
                      <InlineEdit
                        value={String(savingsGoal.target)}
                        onSave={(v) =>
                          onGoalUpdate(projection.goalId, "targetAmount", v)
                        }
                        formatDisplay={(v) =>
                          v === "0"
                            ? "$0 — set target"
                            : formatCurrency(Number(v))
                        }
                        parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                        type="number"
                        className="text-muted text-xl"
                      />
                    ) : (
                      <span className="text-muted text-xl">
                        {formatCurrency(savingsGoal.target)}
                      </span>
                    )}
                  </>
                )}
              </div>

              {/* Upcoming expenses */}
              <div className="text-right">
                {(() => {
                  const upcomingExpenses = transactions
                    .filter(
                      (t) =>
                        t.amount < 0 &&
                        new Date(t.transactionDate) > new Date(),
                    )
                    .reduce((s, t) => s + Math.abs(t.amount), 0);
                  if (upcomingExpenses > 0) {
                    return (
                      <div>
                        <div className="text-xs text-muted tabular-nums">
                          {formatCurrency(upcomingExpenses)} planned
                        </div>
                        <div className="text-[10px] text-muted">
                          in upcoming expenses
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>

            {/* Progress bar — fixed goals and e-fund only */}
            {savingsGoal.target > 0 &&
              (rawGoal.targetMode === "fixed" || rawGoal.isEmergencyFund) && (
                <div className="relative">
                  <div className="h-3 bg-surface-strong rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        progress >= 1 ? "bg-green-500" : "bg-blue-500"
                      }`}
                      style={{ width: `${Math.min(100, progress * 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs font-semibold text-muted tabular-nums">
                      {progressPct}%
                    </span>
                    <span className="text-xs text-muted">
                      {formatCurrency(
                        Math.max(0, savingsGoal.target - savingsGoal.current),
                      )}{" "}
                      remaining
                    </span>
                  </div>
                </div>
              )}

            {/* Target date — fixed goals only */}
            {rawGoal.targetMode === "fixed" && !rawGoal.isEmergencyFund && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-muted">Target date</span>
                {canEdit !== false ? (
                  <input
                    type="date"
                    value={rawGoal.targetDate ?? ""}
                    onChange={(e) =>
                      onGoalUpdate(
                        projection.goalId,
                        "targetDate",
                        e.target.value || "",
                      )
                    }
                    className="bg-transparent border-b border-strong text-xs text-secondary px-1 py-0.5 focus:border-blue-500 focus:outline-none"
                  />
                ) : (
                  rawGoal.targetDate && (
                    <span className="text-xs text-secondary">
                      {formatDate(
                        new Date(rawGoal.targetDate + "T00:00:00"),
                        "short",
                      )}
                    </span>
                  )
                )}
                {!rawGoal.targetDate && canEdit === false && (
                  <span className="text-xs text-muted italic">not set</span>
                )}
              </div>
            )}

            {/* Monthly contribution — inline editable */}
            <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-subtle/50">
              <span className="text-xs text-muted">Saving</span>
              {canEdit !== false ? (
                <InlineEdit
                  value={String(projection.monthlyAllocation)}
                  onSave={(v) => {
                    const dollar = v.replace(/[^0-9.]/g, "");
                    const pool = maxMonthlyFunding;
                    if (pool && pool > 0 && onGoalUpdateMulti) {
                      const pct = (Number(dollar) / pool) * 100;
                      onGoalUpdateMulti(projection.goalId, {
                        monthlyContribution: dollar,
                        allocationPercent: pct.toFixed(3),
                      });
                    } else {
                      onGoalUpdate(
                        projection.goalId,
                        "monthlyContribution",
                        dollar,
                      );
                    }
                  }}
                  formatDisplay={(v) => `${formatCurrency(Number(v))}/mo`}
                  parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                  type="number"
                  className="text-sm font-bold text-green-600"
                />
              ) : (
                <span className="text-sm font-bold text-green-600">
                  {formatCurrency(projection.monthlyAllocation)}/mo
                </span>
              )}
              {totalMonthlyAllocation > 0 && (
                <span className="text-[10px] text-muted">({pct}% of pool)</span>
              )}
              {rawGoal.isApiSyncEnabled && (
                <span
                  className="text-[9px] text-blue-600/70"
                  title="Monthly contribution pushes to budget API for current + next month"
                >
                  → push
                </span>
              )}
            </div>
          </div>

          {/* ── Mini Chart: trajectory toward goal ── */}
          <FundMiniChart
            balances={projection.balances}
            monthDates={monthDates}
            monthEvents={projection.monthEvents}
            target={projection.target}
            fundColor={fundColor}
            onClickMonth={(monthIndex) =>
              onTimelineClick(projection.goalId, monthIndex)
            }
          />

          {/* ── Planned Transactions ── */}
          <div className="mt-3">
            <FundTransactionList
              transactions={transactions}
              goalId={rawGoal.id}
              goalName={projection.name}
              onDeleteTx={onDeleteTx}
              onDeleteTransfer={onDeleteTransfer}
              goalById={goalById}
              onAddTx={onAddTx}
              createTxPending={createTxPending}
              onUpdateTx={onUpdateTx}
              updateTxPending={updateTxPending}
              canEdit={canEdit}
            />
          </div>

          {/* ── Allocation Overrides ── */}
          <div className="mt-2">
            <FundOverridesSummary
              overrides={overrides}
              goalId={rawGoal.id}
              defaultAllocation={projection.monthlyAllocation}
              onDeleteOverride={onDeleteOverride}
              onEditMonth={onEditMonth}
              canEdit={canEdit}
            />
          </div>

          {/* ── Sub-Goals ── */}
          {childGoals.length > 0 && (
            <div className="mt-3 border-t pt-2">
              <p className="text-[10px] text-muted uppercase tracking-wide mb-1.5">
                Goals in this fund
              </p>
              <div className="space-y-2">
                {childGoals.map((child) => {
                  const childTarget = parseFloat(child.targetAmount ?? "0");
                  const childGoalCalc = savingsGoals.find(
                    (g) => g.goalId === child.id,
                  );
                  const childCurrent = childGoalCalc?.current ?? 0;
                  const childProgress =
                    childTarget > 0
                      ? Math.min(childCurrent / childTarget, 1)
                      : 0;
                  return (
                    <div key={child.id} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-secondary truncate">
                            {child.name}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted tabular-nums">
                              {formatCurrency(childCurrent)} /{" "}
                              {formatCurrency(childTarget)}
                            </span>
                            {canEdit !== false &&
                              onUpdateParent &&
                              availableParents && (
                                <button
                                  onClick={() =>
                                    setReassigningChildId(
                                      reassigningChildId === child.id
                                        ? null
                                        : child.id,
                                    )
                                  }
                                  className="text-blue-600/50 hover:text-blue-600 text-[10px]"
                                  title="Move to another fund"
                                >
                                  &#8596;
                                </button>
                              )}
                            {canEdit !== false && (
                              <button
                                onClick={async () => {
                                  if (await confirm(`Delete "${child.name}"?`))
                                    onDeleteGoal({ id: child.id });
                                }}
                                className="text-red-600/50 hover:text-red-600 text-[10px]"
                                title="Delete goal"
                              >
                                &times;
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="w-full bg-surface-strong rounded-full h-1.5 mt-0.5">
                          <div
                            className={`h-1.5 rounded-full ${childProgress >= 1 ? "bg-green-500" : "bg-indigo-400"}`}
                            style={{ width: `${childProgress * 100}%` }}
                          />
                        </div>
                        {reassigningChildId === child.id &&
                          onUpdateParent &&
                          availableParents && (
                            <div className="flex items-center gap-1 mt-1">
                              <select
                                className="border border-strong bg-surface-primary text-primary rounded px-1.5 py-0.5 text-[10px] flex-1"
                                defaultValue=""
                                onChange={(e) => {
                                  const val = e.target.value;
                                  onUpdateParent(
                                    child.id,
                                    val === "" ? null : Number(val),
                                  );
                                  setReassigningChildId(null);
                                }}
                              >
                                <option value="" disabled>
                                  Move to...
                                </option>
                                <option value="">None (top-level)</option>
                                {availableParents
                                  .filter(
                                    (p) =>
                                      p.id !== rawGoal.id && p.id !== child.id,
                                  )
                                  .map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ))}
                              </select>
                              <button
                                onClick={() => setReassigningChildId(null)}
                                className="text-muted hover:text-secondary text-[10px]"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Add sub-goal ── */}
          {canEdit !== false && !rawGoal.isEmergencyFund && (
            <div className="mt-2">
              {addingSubGoalForFund === rawGoal.id ? (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    value={newFund.name}
                    onChange={(e) =>
                      setNewFund({
                        ...newFund,
                        name: e.target.value,
                        parentGoalId: rawGoal.id,
                      })
                    }
                    placeholder="Goal name..."
                    className="border border-strong bg-surface-primary text-primary rounded px-2 py-0.5 text-xs flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onCreateFund();
                      if (e.key === "Escape") setAddingSubGoalForFund(null);
                    }}
                  />
                  <input
                    type="number"
                    value={newFund.targetAmount}
                    onChange={(e) =>
                      setNewFund({
                        ...newFund,
                        targetAmount: e.target.value,
                        parentGoalId: rawGoal.id,
                      })
                    }
                    placeholder="Target $"
                    className="border border-strong bg-surface-primary text-primary rounded px-2 py-0.5 text-xs w-24"
                  />
                  <button
                    onClick={onCreateFund}
                    disabled={!newFund.name || createGoalPending}
                    className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setAddingSubGoalForFund(null);
                      setNewFund({
                        name: "",
                        monthlyContribution: "",
                        targetAmount: "",
                        targetMode: "fixed",
                        targetDate: "",
                        parentGoalId: null,
                      });
                    }}
                    className="text-muted hover:text-secondary text-xs"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setAddingSubGoalForFund(rawGoal.id);
                    setNewFund({
                      name: "",
                      monthlyContribution: "0",
                      targetAmount: "",
                      targetMode: "fixed",
                      targetDate: "",
                      parentGoalId: rawGoal.id,
                    });
                  }}
                  className="text-[10px] text-blue-600 hover:text-blue-700"
                >
                  + Add goal
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
