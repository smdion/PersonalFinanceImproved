"use client";

import React, { useRef, useState } from "react";
import { useScrollToFocus } from "@/components/ui/focus-target";
import { useFocusMatch, useFocusReveal } from "@/lib/hooks/use-focus";
import dynamic from "next/dynamic";
import { Popover } from "@/components/ui/popover";
import { formatCurrency } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";

// Code-split the per-fund Recharts mini chart. All
// FundCard instances on the page share a single chunk, so the recharts
// payload is fetched once when the savings page hydrates instead of being
// inlined in the page bundle. ssr:false because Recharts isn't SSR-friendly.
const FundMiniChart = dynamic(
  () => import("./fund-mini-chart").then((m) => ({ default: m.FundMiniChart })),
  {
    loading: () => (
      <div
        className="bg-surface-sunken/40 h-20 w-full animate-pulse rounded"
        aria-hidden="true"
      />
    ),
    ssr: false,
  },
);
import { FundTransactionList } from "./fund-transaction-list";
import { FundOverridesSummary } from "./fund-overrides-summary";
import { FundCardMenuItems } from "./fund-card-menu";
import {
  FundBalanceHeadline,
  FundMonthlySaving,
  FundProgressAndTargetDate,
} from "./fund-card-progress";
import {
  AddSubGoal,
  SubGoalActions,
  SubGoalProgressAndMove,
} from "./fund-card-sub-goals";
import { FundApiSyncPanel, FundSummaryRow } from "./fund-card-summary";
import { GoalProjection, PlannedTxForm, NewFundForm, RawGoal } from "./types";
import type { PlannedTransaction } from "@/lib/pure/savings/savings-projection";

interface EfundResult {
  neededAfterRepay: number;
  targetAmount: number;
  progress: number;
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
  efundResult?: EfundResult | null,
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

  // Bucket — free-form holding fund with no target
  if (rawGoal.targetMode === "bucket") {
    return {
      label: "Bucket",
      color: "text-muted",
      bgColor: "bg-surface-elevated",
      borderColor: "border-strong/50",
    };
  }

  // Emergency fund — use Ledgr-computed neededAfterRepay as the funded check
  if (rawGoal.isEmergencyFund && efundResult) {
    if (efundResult.neededAfterRepay <= 0) {
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
  onRecalculateAllocation,
  recalculateAllocationPending,
  onLockInAllocationPercent,
  lockInAllocationPercentPending,
  onDeleteGoal,
  onDeleteTx,
  onDeleteTransfer,
  onSettleTx,
  settledOccurrences,
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
  efundResult,
  apiBalance,
  onLinkToApi,
  onUnlinkFromApi,
  onConvertToBudgetItem,
  onUpdateParent,
  availableParents,
  defaultExpanded,
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
  onGoalUpdateMulti?: (
    goalId: number,
    fields: Record<string, string | null>,
  ) => void;
  maxMonthlyFunding?: number | null;
  onRecalculateAllocation?: () => void;
  recalculateAllocationPending?: boolean;
  onLockInAllocationPercent?: () => void;
  lockInAllocationPercentPending?: boolean;
  onDeleteGoal: (params: { id: number }) => void;
  onDeleteTx: (params: { id: number }) => void;
  onDeleteTransfer?: (params: { transferPairId: string }) => void;
  onSettleTx?: (params: {
    plannedTxId: number;
    occurrenceMonth: string;
  }) => void;
  settledOccurrences?: Set<string>;
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
  efundResult?: EfundResult | null;
  apiBalance?: {
    balance: number;
    budgeted: number;
    activity: number;
    goalTarget: number | null;
  } | null;
  onLinkToApi?: (goalId: number) => void;
  onUnlinkFromApi?: (goalId: number) => void;
  onConvertToBudgetItem?: (
    goalId: number,
    name: string,
    goalMet: boolean,
  ) => void;
  onUpdateParent?: (childGoalId: number, newParentId: number | null) => void;
  availableParents?: { id: number; name: string }[];
  defaultExpanded?: boolean;
}) {
  // A link to this goal opens its card and scrolls to it.
  const isThis = (ids: { goalId: number }) => ids.goalId === projection.goalId;
  const [open, setOpen] = useFocusReveal(
    "savingsGoal",
    isThis,
    defaultExpanded,
  );
  const collapsed = !open;
  const setCollapsed = (c: boolean) => setOpen(!c);
  const linked = useFocusMatch("savingsGoal");
  const cardRef = useRef<HTMLDivElement>(null);
  useScrollToFocus(cardRef, linked !== null && isThis(linked));
  const [showMenu, setShowMenu] = useState(false);
  const [reassigningChildId, setReassigningChildId] = useState<number | null>(
    null,
  );
  const status = getGoalStatus(
    savingsGoal,
    rawGoal,
    projection,
    transactions,
    efundResult,
  );
  const pct = (
    safeDivide(projection.monthlyAllocation, totalMonthlyAllocation, 0)! * 100
  ).toFixed(0);
  // E-fund uses Ledgr-computed progress (balanceWithRepay / target); others use raw balance
  const progress =
    rawGoal.isEmergencyFund && efundResult
      ? Math.min(efundResult.progress, 1)
      : Math.min(safeDivide(savingsGoal.current, savingsGoal.target, 0)!, 1);
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
        className="text-faint hover:text-secondary rounded px-1.5 py-0.5 text-sm transition-colors"
        title="Actions"
      >
        &#8943;
      </button>
      {showMenu && (
        <Popover
          onClose={() => setShowMenu(false)}
          layer="card"
          className="bg-surface-primary absolute top-full right-0 mt-1 min-w-[130px] rounded-md border py-1 shadow-lg"
        >
          <FundCardMenuItems
            onLinkToApi={onLinkToApi}
            rawGoal={rawGoal}
            setShowMenu={setShowMenu}
            onUnlinkFromApi={onUnlinkFromApi}
            onGoalUpdate={onGoalUpdate}
            projection={projection}
            onGoalUpdateMulti={onGoalUpdateMulti}
            onConvertToBudgetItem={onConvertToBudgetItem}
            savingsGoal={savingsGoal}
            onDeleteGoal={onDeleteGoal}
          />
        </Popover>
      )}
    </div>
  );

  return (
    <div
      ref={cardRef}
      className="bg-surface-elevated rounded-lg border shadow-sm transition-shadow hover:shadow-md"
    >
      <FundSummaryRow
        setCollapsed={setCollapsed}
        collapsed={collapsed}
        fundColor={fundColor}
        projection={projection}
        status={status}
        rawGoal={rawGoal}
        efundResult={efundResult}
        savingsGoal={savingsGoal}
        menuDropdown={menuDropdown}
      />

      {/* ── Expanded body ── */}
      {!collapsed && (
        <div className="border-t px-4 pt-1 pb-4">
          <FundApiSyncPanel
            apiBalance={apiBalance}
            rawGoal={rawGoal}
            serviceLabel={serviceLabel}
          />

          {/* ── Goal progress: the main story ── */}
          <div className="bg-surface-sunken border-subtle/50 mt-3 mb-3 rounded-lg border p-3">
            <FundBalanceHeadline
              rawGoal={rawGoal}
              efundResult={efundResult}
              savingsGoal={savingsGoal}
              canEdit={canEdit}
              onGoalUpdate={onGoalUpdate}
              projection={projection}
              transactions={transactions}
            />

            <FundProgressAndTargetDate
              savingsGoal={savingsGoal}
              rawGoal={rawGoal}
              progress={progress}
              progressPct={progressPct}
              efundResult={efundResult}
              canEdit={canEdit}
              onGoalUpdate={onGoalUpdate}
              projection={projection}
            />
            <FundMonthlySaving
              canEdit={canEdit}
              projection={projection}
              maxMonthlyFunding={maxMonthlyFunding}
              onGoalUpdateMulti={onGoalUpdateMulti}
              onGoalUpdate={onGoalUpdate}
              totalMonthlyAllocation={totalMonthlyAllocation}
              pct={pct}
              rawGoal={rawGoal}
              onLockInAllocationPercent={onLockInAllocationPercent}
              lockInAllocationPercentPending={lockInAllocationPercentPending}
              onRecalculateAllocation={onRecalculateAllocation}
              recalculateAllocationPending={recalculateAllocationPending}
            />
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
              onSettleTx={onSettleTx}
              settledOccurrences={settledOccurrences}
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
              <p className="text-caption text-muted mb-1.5 tracking-wide uppercase">
                Goals in this fund
              </p>
              <div className="space-y-2">
                {childGoals.map((child) => {
                  const childTarget = parseFloat(child.targetAmount ?? "0");
                  const childGoalCalc = savingsGoals.find(
                    (g) => g.goalId === child.id,
                  );
                  const childCurrent = childGoalCalc?.current ?? 0;
                  const childProgress = Math.min(
                    safeDivide(childCurrent, childTarget, 0)!,
                    1,
                  );
                  return (
                    <div key={child.id} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-secondary truncate font-medium">
                            {child.name}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted tabular-nums">
                              {formatCurrency(childCurrent)} /{" "}
                              {formatCurrency(childTarget)}
                            </span>
                            <SubGoalActions
                              canEdit={canEdit}
                              onUpdateParent={onUpdateParent}
                              availableParents={availableParents}
                              setReassigningChildId={setReassigningChildId}
                              reassigningChildId={reassigningChildId}
                              child={child}
                              onDeleteGoal={onDeleteGoal}
                            />
                          </div>
                        </div>
                        <SubGoalProgressAndMove
                          childProgress={childProgress}
                          reassigningChildId={reassigningChildId}
                          child={child}
                          onUpdateParent={onUpdateParent}
                          availableParents={availableParents}
                          setReassigningChildId={setReassigningChildId}
                          rawGoal={rawGoal}
                        />
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
              <AddSubGoal
                addingSubGoalForFund={addingSubGoalForFund}
                rawGoal={rawGoal}
                newFund={newFund}
                setNewFund={setNewFund}
                onCreateFund={onCreateFund}
                setAddingSubGoalForFund={setAddingSubGoalForFund}
                createGoalPending={createGoalPending}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
