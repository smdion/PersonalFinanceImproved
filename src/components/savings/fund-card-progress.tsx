import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { sumBy, safeDivide } from "@/lib/utils/math";
import type { GoalProjection, RawGoal } from "./types";
import type { PlannedTransaction } from "@/lib/pure/savings/savings-projection";

export function upcomingExpensesNote(transactions: PlannedTransaction[]) {
  // Date-truncated cutoff — matches the shared
  // isFuturePlannedTx predicate's boundary semantics.
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const upcomingExpenses = sumBy(
    transactions.filter(
      (t) => t.amount < 0 && new Date(t.transactionDate + "T00:00:00") >= today,
    ),
    (t) => Math.abs(t.amount),
  );
  if (upcomingExpenses > 0) {
    return (
      <div>
        <div className="text-muted text-xs tabular-nums">
          {formatCurrency(upcomingExpenses)} planned
        </div>
        <div className="text-caption text-muted">in upcoming expenses</div>
      </div>
    );
  }
  return null;
}

export function FundMonthlySaving({
  canEdit,
  projection,
  maxMonthlyFunding,
  onGoalUpdateMulti,
  onGoalUpdate,
  totalMonthlyAllocation,
  pct,
  rawGoal,
  onLockInAllocationPercent,
  lockInAllocationPercentPending,
  onRecalculateAllocation,
  recalculateAllocationPending,
}: {
  canEdit: boolean | undefined;
  projection: GoalProjection;
  maxMonthlyFunding: number | null | undefined;
  onGoalUpdateMulti:
    | ((goalId: number, fields: Record<string, string | null>) => void)
    | undefined;
  onGoalUpdate: (goalId: number, field: string, value: string) => void;
  totalMonthlyAllocation: number;
  pct: string;
  rawGoal: RawGoal;
  onLockInAllocationPercent: (() => void) | undefined;
  lockInAllocationPercentPending: boolean | undefined;
  onRecalculateAllocation: (() => void) | undefined;
  recalculateAllocationPending: boolean | undefined;
}) {
  return (
    <>
      {/* Monthly contribution — inline editable */}
      <div className="border-subtle/50 mt-2.5 flex items-center gap-2 border-t pt-2">
        <span className="text-muted text-xs">Saving</span>
        {canEdit !== false ? (
          <InlineEdit
            value={String(projection.monthlyAllocation)}
            onSave={(v) => {
              const dollar = v.replace(/[^0-9.]/g, "");
              const pool = maxMonthlyFunding;
              if (pool && pool > 0 && onGoalUpdateMulti) {
                const pct = safeDivide(Number(dollar), pool, 0)! * 100;
                onGoalUpdateMulti(projection.goalId, {
                  monthlyContribution: dollar,
                  allocationPercent: pct.toFixed(3),
                });
              } else {
                onGoalUpdate(projection.goalId, "monthlyContribution", dollar);
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
          <span className="text-caption text-muted">({pct}% of pool)</span>
        )}
        {canEdit !== false && rawGoal.allocationPercent != null && (
          <>
            {onLockInAllocationPercent && (
              <button
                onClick={onLockInAllocationPercent}
                disabled={lockInAllocationPercentPending}
                className="text-caption text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                title="Keep this goal's dollar amount as-is; just update its % to reflect current income"
              >
                {lockInAllocationPercentPending ? "Updating..." : "Update %"}
              </button>
            )}
            {onRecalculateAllocation && (
              <button
                onClick={onRecalculateAllocation}
                disabled={recalculateAllocationPending}
                className="text-caption text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                title={`Recompute this goal's dollar amount from its ${rawGoal.allocationPercent}% allocation and current income`}
              >
                {recalculateAllocationPending
                  ? "Pulling in pay..."
                  : "Pull In Pay"}
              </button>
            )}
          </>
        )}
        {rawGoal.isApiSyncEnabled && (
          <span
            className="text-micro text-blue-600/70"
            title="Monthly contribution pushes to budget API for current + next month"
          >
            → push
          </span>
        )}
      </div>
    </>
  );
}

export function FundProgressAndTargetDate({
  savingsGoal,
  rawGoal,
  progress,
  progressPct,
  efundResult,
  canEdit,
  onGoalUpdate,
  projection,
}: {
  savingsGoal: { current: number; target: number };
  rawGoal: RawGoal;
  progress: number;
  progressPct: string;
  efundResult:
    | { neededAfterRepay: number; targetAmount: number; progress: number }
    | null
    | undefined;
  canEdit: boolean | undefined;
  onGoalUpdate: (goalId: number, field: string, value: string) => void;
  projection: GoalProjection;
}) {
  return (
    <>
      {/* Progress bar — fixed goals and e-fund only */}
      {savingsGoal.target > 0 &&
        (rawGoal.targetMode === "fixed" || rawGoal.isEmergencyFund) && (
          <div className="relative">
            <div className="bg-surface-strong h-3 overflow-hidden rounded-full">
              <div
                className={`h-full rounded-full transition-all ${
                  progress >= 1 ? "bg-green-500" : "bg-blue-500"
                }`}
                style={{ width: `${Math.min(100, progress * 100)}%` }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted text-xs font-semibold tabular-nums">
                {progressPct}%
              </span>
              <span className="text-muted text-xs">
                {rawGoal.isEmergencyFund && efundResult
                  ? efundResult.neededAfterRepay <= 0
                    ? "Fully funded"
                    : `${formatCurrency(efundResult.neededAfterRepay)} remaining`
                  : `${formatCurrency(Math.max(0, savingsGoal.target - savingsGoal.current))} remaining`}
              </span>
            </div>
          </div>
        )}

      {/* Target date — fixed goals only */}
      {rawGoal.targetMode === "fixed" && !rawGoal.isEmergencyFund && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-muted text-xs">Target date</span>
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
              className="border-strong text-secondary border-b bg-transparent px-1 py-0.5 text-xs focus:border-blue-500 focus:outline-none"
            />
          ) : (
            rawGoal.targetDate && (
              <span className="text-secondary text-xs">
                {formatDate(
                  new Date(rawGoal.targetDate + "T00:00:00"),
                  "short",
                )}
              </span>
            )
          )}
          {!rawGoal.targetDate && canEdit === false && (
            <span className="text-muted text-xs italic">not set</span>
          )}
        </div>
      )}
    </>
  );
}

export function FundBalanceHeadline({
  rawGoal,
  efundResult,
  savingsGoal,
  canEdit,
  onGoalUpdate,
  projection,
  transactions,
}: {
  rawGoal: RawGoal;
  efundResult:
    | { neededAfterRepay: number; targetAmount: number; progress: number }
    | null
    | undefined;
  savingsGoal: { current: number; target: number };
  canEdit: boolean | undefined;
  onGoalUpdate: (goalId: number, field: string, value: string) => void;
  projection: GoalProjection;
  transactions: PlannedTransaction[];
}) {
  return (
    <>
      {/* Balance + upcoming info */}
      <div className="mb-2 flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          {rawGoal.isEmergencyFund && efundResult ? (
            <>
              <div>
                <div className="text-caption text-faint mb-0.5">
                  still needed
                </div>
                <span className="text-primary text-3xl font-extrabold tabular-nums">
                  {efundResult.neededAfterRepay <= 0
                    ? "Fully funded"
                    : formatCurrency(efundResult.neededAfterRepay)}
                </span>
              </div>
              <span className="text-faint text-lg">/</span>
              <div>
                <div className="text-caption text-faint mb-0.5">target</div>
                <span className="text-muted text-xl tabular-nums">
                  {formatCurrency(efundResult.targetAmount)}
                </span>
              </div>
            </>
          ) : (
            <>
              <span className="text-primary text-3xl font-extrabold tabular-nums">
                {formatCurrency(savingsGoal.current)}
              </span>
              {rawGoal.targetMode === "fixed" && (
                <>
                  <span className="text-faint text-lg">/</span>
                  {canEdit !== false ? (
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
            </>
          )}
        </div>

        {/* Upcoming expenses */}
        <div className="text-right">{upcomingExpensesNote(transactions)}</div>
      </div>
    </>
  );
}
