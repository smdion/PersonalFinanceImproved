"use client";

import { memo } from "react";

import { trpc } from "@/lib/trpc";
import { Card, ProgressBar } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { LoadingCard, ErrorCard } from "./utils";

function SavingsGoalsCardImpl() {
  const [efundBudgetColumn, setEfundBudgetColumn] = usePersistedSetting<number>(
    "efund_budget_column",
    -1,
  );
  const efundTierInput =
    efundBudgetColumn >= 0
      ? { budgetTierOverride: efundBudgetColumn }
      : undefined;
  const { data, isLoading, error } =
    trpc.savings.computeSummary.useQuery(efundTierInput);
  const { data: reimbursementsData } =
    trpc.savings.listEfundReimbursements.useQuery();
  if (isLoading) return <LoadingCard title="Savings Goals" />;
  if (error)
    return <ErrorCard title="Savings Goals" message="Failed to load" />;
  if (!data) return null;

  const {
    savings,
    efund,
    budgetTierLabels,
    efundTierIndex,
    goals: rawGoals,
    plannedTransactions,
    allocationOverrides,
  } = data;

  // Compute per-fund status for ALL active non-efund goals
  type GoalStatus = {
    kind: "funded" | "on-track" | "accumulating" | "shortfall" | "no-target";
    totalPlanned?: number;
    shortfalls?: { month: string; amount: number }[];
    needed?: number;
  };
  const goalStatusMap = new Map<number, GoalStatus>();
  const now = new Date();
  const shortMonthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  for (const rawGoal of rawGoals.filter(
    (g: { isActive: boolean }) => g.isActive,
  )) {
    const rg = rawGoal as {
      id: number;
      name: string;
      targetAmount: string | null;
      targetMode: string;
      targetDate: string | null;
      monthlyContribution: string | null;
    };
    const calcGoal = savings.goals.find((g) => g.goalId === rg.id);
    if (!calcGoal) continue;

    const current = calcGoal.current;
    // Data-driven: fixed goals use their target, ongoing goals have no fixed target to reach
    const target = rg.targetMode === "fixed" ? calcGoal.target : 0;

    // All future transactions for this fund (deposits + withdrawals)
    const goalTxs = plannedTransactions
      .filter(
        (t: { goalId: number; transactionDate: string }) =>
          t.goalId === rg.id && new Date(t.transactionDate) > now,
      )
      .sort((a: { transactionDate: string }, b: { transactionDate: string }) =>
        a.transactionDate.localeCompare(b.transactionDate),
      );

    const totalPlannedExpenses = goalTxs
      .filter((t: { amount: number }) => t.amount < 0)
      .reduce((s: number, t: { amount: number }) => s + Math.abs(t.amount), 0);

    // If there are planned expenses, simulate month-by-month (applies to both fixed and ongoing)
    if (totalPlannedExpenses > 0) {
      const overrideMap = new Map<string, number>();
      for (const o of allocationOverrides.filter(
        (o: { goalId: number }) => o.goalId === rg.id,
      )) {
        const ov = o as { monthDate: string; amount: number };
        overrideMap.set(ov.monthDate.slice(0, 7), ov.amount);
      }

      let onTrack = true;
      const shortfalls: { month: string; amount: number }[] = [];
      let balance = current;
      const lastTx = goalTxs[goalTxs.length - 1] as
        | { transactionDate: string; amount: number }
        | undefined;
      if (!lastTx) continue;
      const lastTxDate = new Date(lastTx.transactionDate);
      const monthsToSimulate = Math.max(
        1,
        (lastTxDate.getFullYear() - now.getFullYear()) * 12 +
          (lastTxDate.getMonth() - now.getMonth()) +
          1,
      );
      for (let m = 0; m < monthsToSimulate; m++) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() + m, 1);
        const mk = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
        const contribution = overrideMap.has(mk)
          ? overrideMap.get(mk)!
          : calcGoal.monthlyAllocation;
        balance += contribution;
        for (const tx of goalTxs) {
          const t = tx as { transactionDate: string; amount: number };
          if (t.transactionDate?.startsWith(mk)) {
            balance += t.amount;
          }
        }
        if (balance < 0) {
          onTrack = false;
          shortfalls.push({
            month: `${shortMonthNames[monthDate.getMonth()]} ${monthDate.getFullYear()}`,
            amount: Math.abs(balance),
          });
        }
      }
      goalStatusMap.set(
        rg.id,
        onTrack
          ? { kind: "on-track", totalPlanned: totalPlannedExpenses }
          : {
              kind: "shortfall",
              totalPlanned: totalPlannedExpenses,
              shortfalls,
            },
      );
      continue;
    }

    // No planned expenses — status depends on targetMode
    // Ongoing goals without planned expenses have no fixed target to measure against
    if (!target || target <= 0) {
      goalStatusMap.set(rg.id, { kind: "no-target" });
      continue;
    }

    // Fixed goals — compare current vs target
    if (current >= target) {
      goalStatusMap.set(rg.id, { kind: "funded" });
    } else {
      // No target date (or past) means"should be funded now" → shortfall
      const isPast =
        !rg.targetDate || new Date(rg.targetDate + "T00:00:00") <= now;
      if (isPast) {
        goalStatusMap.set(rg.id, {
          kind: "shortfall",
          needed: target - current,
        });
      } else if (calcGoal.monthlyAllocation > 0) {
        goalStatusMap.set(rg.id, {
          kind: "accumulating",
          needed: target - current,
        });
      } else {
        goalStatusMap.set(rg.id, {
          kind: "shortfall",
          needed: target - current,
        });
      }
    }
  }

  return (
    <Card title="Savings Goals" href="/savings">
      {efund && efund.monthsCovered !== null && (
        <div className="mb-3 pb-3 border-b border-subtle">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted uppercase tracking-wide">
              Income Replacement
            </p>
            <div className="flex bg-surface-elevated rounded p-0.5">
              {budgetTierLabels.map((label: string, idx: number) => (
                <button
                  key={label}
                  onClick={(e) => {
                    e.preventDefault();
                    setEfundBudgetColumn(idx);
                  }}
                  className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                    efundTierIndex === idx
                      ? "bg-surface-primary text-primary shadow-sm font-medium"
                      : "text-muted hover:text-secondary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ProgressBar
            value={efund.progress}
            label={`${efund.targetMonths}mo target: ${formatCurrency(efund.targetAmount)}`}
            color={efund.progress >= 1 ? "bg-green-500" : "bg-amber-500"}
            tooltip={`Emergency fund: ${formatCurrency(efund.trueBalance)} true balance toward ${formatCurrency(efund.targetAmount)} (${efund.targetMonths} months of essential expenses)`}
          />
          <div className="mt-2 space-y-0.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Current Fund</span>
              <span className="text-primary">
                {formatCurrency(efund.rawBalance)}
              </span>
            </div>
            {efund.outstandingSelfLoans > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted">Self-Loan</span>
                  <span className="text-amber-600">
                    {formatCurrency(efund.outstandingSelfLoans)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">With Repay</span>
                  <span className="text-primary font-medium">
                    {formatCurrency(efund.balanceWithRepay)}
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span className="text-muted">Current Months</span>
              <span className="text-primary">
                {efund.monthsCovered!.toFixed(2)}
              </span>
            </div>
            {efund.outstandingSelfLoans > 0 &&
              efund.monthsCoveredWithRepay !== null && (
                <div className="flex justify-between">
                  <span className="text-muted">Repaid Months</span>
                  <span className="text-primary">
                    {efund.monthsCoveredWithRepay.toFixed(2)}
                  </span>
                </div>
              )}
            {(reimbursementsData?.total ?? 0) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Pending Reimb.</span>
                <span className="text-amber-600">
                  +{formatCurrency(reimbursementsData!.total)}
                </span>
              </div>
            )}
            <div className="flex justify-between font-medium">
              <span className="text-muted">Needed</span>
              {(() => {
                const effectiveNeeded =
                  efund.neededAfterRepay - (reimbursementsData?.total ?? 0);
                return (
                  <span
                    className={
                      effectiveNeeded <= 0 ? "text-green-600" : "text-red-600"
                    }
                  >
                    {effectiveNeeded <= 0 ? "-" : ""}
                    {formatCurrency(Math.abs(effectiveNeeded))}
                  </span>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {[...savings.goals]
          .sort((a, b) => {
            const rawA = rawGoals.find(
              (rg: { id: number }) => rg.id === a.goalId,
            ) as { isEmergencyFund?: boolean } | undefined;
            const rawB = rawGoals.find(
              (rg: { id: number }) => rg.id === b.goalId,
            ) as { isEmergencyFund?: boolean } | undefined;
            // Emergency fund (Income Replacement) always first
            if (rawA?.isEmergencyFund && !rawB?.isEmergencyFund) return -1;
            if (!rawA?.isEmergencyFund && rawB?.isEmergencyFund) return 1;
            // Then alphabetical by name
            return a.name.localeCompare(b.name);
          })
          .map((g) => {
            const raw = rawGoals.find(
              (rg: { id: number }) => rg.id === g.goalId,
            ) as { id: number; parentGoalId: number | null } | undefined;
            // Skip child goals — they're shown under their parent on the savings page
            if (raw?.parentGoalId) return null;
            const status = goalStatusMap.get(g.goalId);
            const dotColor =
              !status ||
              status.kind === "no-target" ||
              status.kind === "funded" ||
              status.kind === "on-track"
                ? "bg-green-500"
                : status.kind === "accumulating"
                  ? "bg-amber-500"
                  : "bg-red-500";
            return (
              <div key={g.goalId}>
                <div className="flex justify-between text-sm items-center">
                  <span className="text-muted flex items-center gap-1.5">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${dotColor}`}
                    />
                    {g.name}
                  </span>
                  <span className="text-primary">
                    {formatCurrency(g.current)}
                  </span>
                </div>
                <div className="flex justify-between items-start">
                  {status?.kind === "on-track" ? (
                    <span className="text-[10px] text-green-600">
                      {formatCurrency(status.totalPlanned!)} planned
                    </span>
                  ) : status?.kind === "shortfall" && status.shortfalls ? (
                    <div className="text-[10px] text-red-600 space-y-0">
                      {status.shortfalls.slice(0, 3).map((s) => (
                        <div key={s.month}>
                          -{formatCurrency(s.amount)} in {s.month}
                        </div>
                      ))}
                      {status.shortfalls.length > 3 && (
                        <div className="text-red-500">
                          +{status.shortfalls.length - 3} more
                        </div>
                      )}
                    </div>
                  ) : status?.kind === "shortfall" && status.needed ? (
                    <span className="text-[10px] text-red-600">
                      {formatCurrency(status.needed)} needed
                      {g.monthlyAllocation <= 0 ? " — no contribution" : ""}
                    </span>
                  ) : status?.kind === "accumulating" ? (
                    <span className="text-[10px] text-amber-600">
                      {formatCurrency(status.needed!)} to go
                      {g.monthsToTarget ? ` — ~${g.monthsToTarget}mo` : ""}
                    </span>
                  ) : status?.kind === "funded" ? (
                    <span className="text-[10px] text-green-600">Funded</span>
                  ) : (
                    <span />
                  )}
                  {g.monthlyAllocation > 0 && (
                    <span className="text-[10px] text-faint">
                      {formatCurrency(g.monthlyAllocation)}/mo
                    </span>
                  )}
                </div>
              </div>
            );
          })}
      </div>
      <div className="mt-3 pt-3 border-t border-subtle flex justify-between text-sm">
        <span className="text-muted">Monthly pool</span>
        <span className="text-primary font-medium">
          {formatCurrency(
            savings.goals.reduce((s, g) => s + g.monthlyAllocation, 0),
          )}
          /mo
        </span>
      </div>
    </Card>
  );
}

export const SavingsGoalsCard = memo(SavingsGoalsCardImpl);
