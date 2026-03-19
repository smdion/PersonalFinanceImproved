// Brokerage Goals Calculator — pure function, no DB, no side effects.
//
// Enriches contribution engine output with a brokerage-focused view:
// goal funding status, year-by-year brokerage projection, and tax breakdowns.
// The engine handles the actual balance tracking and goal withdrawals;
// this calculator provides the goal-oriented analysis layer.

import { roundToCents } from "@/lib/utils/math";
import { isOverflowTarget } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import type { EngineAccumulationYear, EngineYearProjection } from "./types";

// --- Input ---

export type BrokerageGoalInput = {
  id: number;
  name: string;
  targetAmount: number;
  targetYear: number;
  priority: number;
};

export type BrokeragePlannedTransactionInput = {
  goalId: number;
  transactionDate: string;
  amount: number;
  isRecurring: boolean;
  recurrenceMonths: number | null;
};

export type BrokerageGoalsInput = {
  asOfDate: Date;
  goals: BrokerageGoalInput[];
  /** Engine projection years (accumulation + decumulation). */
  engineYears: EngineYearProjection[];
  /** When set, derive afterTax balance from individual accounts matching this parentCategory
   *  instead of the aggregate balanceByTaxType.afterTax (which mixes all parentCategories). */
  parentCategoryFilter?: string;
  /** Manual planned deposits/withdrawals layered on top of engine projections. */
  plannedTransactions?: BrokeragePlannedTransactionInput[];
};

// --- Output ---

export type BrokerageGoalWithdrawal = {
  goalId: number;
  name: string;
  amount: number;
  basisPortion: number;
  gainsPortion: number;
  taxCost: number;
};

export type BrokerageGoalYear = {
  year: number;
  /** Intentional brokerage contribution from engine (employee + match). */
  contribution: number;
  /** IRS limit overflow routed to brokerage by the engine. */
  overflow: number;
  /** Investment growth (balance change minus net contributions/withdrawals). */
  growth: number;
  /** Goal withdrawals processed by the engine this year. */
  goalWithdrawals: BrokerageGoalWithdrawal[];
  totalWithdrawal: number;
  totalTaxCost: number;
  /** Net planned transaction amount for this year (deposits positive, withdrawals negative). */
  plannedTransactionTotal: number;
  endBalance: number;
  endBasis: number;
  unrealizedGain: number;
};

export type BrokerageGoalStatus = {
  id: number;
  name: string;
  targetAmount: number;
  targetYear: number;
  /** Whether the engine fully funded this withdrawal. */
  funded: boolean;
  /** Brokerage balance at target year (after growth, before this withdrawal). */
  projectedBalance: number;
  /** Actual amount withdrawn (may be less than target if underfunded). */
  actualWithdrawal: number;
  /** Shortfall: targetAmount - actualWithdrawal (0 if fully funded). */
  shortfall: number;
  /** Tax cost on the withdrawal (capital gains on gains portion). */
  taxCost: number;
};

export type BrokerageGoalsResult = {
  projectionByYear: BrokerageGoalYear[];
  goals: BrokerageGoalStatus[];
  warnings: string[];
};

// --- Calculator ---

export function calculateBrokerageGoals(
  input: BrokerageGoalsInput,
): BrokerageGoalsResult {
  const { goals, engineYears, parentCategoryFilter, plannedTransactions } =
    input;
  const warnings: string[] = [];

  // Expand planned transactions into year -> net amount map
  const plannedTxByYear = new Map<number, number>();
  if (plannedTransactions) {
    const lastYear =
      engineYears.length > 0 ? engineYears[engineYears.length - 1]!.year : 0;
    for (const tx of plannedTransactions) {
      const txDate = new Date(tx.transactionDate + "T00:00:00");
      const addToYear = (year: number, amount: number) => {
        plannedTxByYear.set(year, (plannedTxByYear.get(year) ?? 0) + amount);
      };
      addToYear(txDate.getFullYear(), tx.amount);
      if (tx.isRecurring && tx.recurrenceMonths && tx.recurrenceMonths > 0) {
        let d = new Date(
          txDate.getFullYear(),
          txDate.getMonth() + tx.recurrenceMonths,
          1,
        );
        while (d.getFullYear() <= lastYear) {
          addToYear(d.getFullYear(), tx.amount);
          d = new Date(d.getFullYear(), d.getMonth() + tx.recurrenceMonths, 1);
        }
      }
    }
  }

  // Build goal status map from engine's accumulation years
  const goalStatusMap = new Map<number, BrokerageGoalStatus>();
  for (const goal of goals) {
    goalStatusMap.set(goal.id, {
      id: goal.id,
      name: goal.name,
      targetAmount: goal.targetAmount,
      targetYear: goal.targetYear,
      funded: false,
      projectedBalance: 0,
      actualWithdrawal: 0,
      shortfall: goal.targetAmount,
      taxCost: 0,
    });
  }

  // Extract brokerage-focused view from engine years
  const projectionByYear: BrokerageGoalYear[] = [];
  let prevBalance = 0;

  for (let i = 0; i < engineYears.length; i++) {
    const yr = engineYears[i]!;
    // When parentCategoryFilter is set, derive afterTax from individual accounts
    // matching that parentCategory (e.g. 'Portfolio' for brokerage page).
    // Otherwise use the aggregate bucket (which includes all parentCategories).
    let afterTax: number;
    let afterTaxBasis: number;
    if (parentCategoryFilter && yr.individualAccountBalances.length > 0) {
      const filtered = yr.individualAccountBalances.filter(
        (ia) => ia.parentCategory === parentCategoryFilter,
      );
      if (filtered.length === 0 && i === 0) {
        warnings.push(
          `parentCategoryFilter "${parentCategoryFilter}" matched zero individual accounts — brokerage goals will show as shortfalls`,
        );
      }
      afterTax = roundToCents(filtered.reduce((s, ia) => s + ia.balance, 0));
      // Basis not tracked per individual account; fall back to proportional estimate
      const totalAfterTax = yr.balanceByTaxType.afterTax;
      const ratio = totalAfterTax > 0 ? afterTax / totalAfterTax : 0;
      afterTaxBasis = roundToCents(yr.balanceByTaxType.afterTaxBasis * ratio);
    } else {
      afterTax = yr.balanceByTaxType.afterTax;
      afterTaxBasis = yr.balanceByTaxType.afterTaxBasis;
    }

    let contribution = 0;
    let overflow = 0;
    let goalWithdrawals: BrokerageGoalWithdrawal[] = [];
    let totalWithdrawal = 0;
    let totalTaxCost = 0;

    if (yr.phase === "accumulation") {
      const accYr = yr as EngineAccumulationYear;

      if (parentCategoryFilter && yr.individualAccountBalances.length > 0) {
        // Derive contribution/overflow from filtered individual accounts' breakdown fields.
        // ia.contribution is the aggregate (intentional + overflow + ramp); use the breakdown
        // fields so each column shows only its portion.
        const filtered = yr.individualAccountBalances.filter(
          (ia) => ia.parentCategory === parentCategoryFilter,
        );
        contribution = roundToCents(
          filtered.reduce(
            (s, ia) => s + (ia.intentionalContribution ?? ia.contribution),
            0,
          ),
        );
        overflow = roundToCents(
          filtered.reduce((s, ia) => s + (ia.overflowContribution ?? 0), 0),
        );
      } else {
        // Brokerage contribution = brokerage slot's employee + employer + ramp
        const brokerageSlot = accYr.slots.find((s) =>
          isOverflowTarget(s.category as AccountCategory),
        );
        contribution = brokerageSlot
          ? roundToCents(
              brokerageSlot.employeeContrib +
                brokerageSlot.employerMatch +
                accYr.brokerageRampContribution,
            )
          : roundToCents(accYr.brokerageRampContribution);
        overflow = accYr.overflowToBrokerage;
      }

      // Goal withdrawals from engine
      goalWithdrawals = accYr.brokerageGoalWithdrawals.map((gw) => ({
        goalId: gw.goalId,
        name: gw.name,
        amount: gw.amount,
        basisPortion: gw.basisPortion,
        gainsPortion: gw.gainsPortion,
        taxCost: gw.taxCost,
      }));
      totalWithdrawal = roundToCents(
        goalWithdrawals.reduce((s, gw) => s + gw.amount, 0),
      );
      totalTaxCost = roundToCents(
        goalWithdrawals.reduce((s, gw) => s + gw.taxCost, 0),
      );

      // Update goal statuses (include planned transaction adjustments for accurate projection)
      const yearPlannedTx = roundToCents(plannedTxByYear.get(yr.year) ?? 0);
      for (const gw of accYr.brokerageGoalWithdrawals) {
        const status = goalStatusMap.get(gw.goalId);
        if (!status) continue;
        // projectedBalance = balance before this withdrawal (approx: end balance + withdrawal + planned tx)
        status.projectedBalance = roundToCents(
          afterTax + yearPlannedTx + gw.amount,
        );
        status.actualWithdrawal = gw.amount;
        status.shortfall = roundToCents(
          Math.max(0, status.targetAmount - gw.amount),
        );
        status.funded = status.shortfall === 0;
        status.taxCost = gw.taxCost;
      }
    }
    // Decumulation years: no brokerage contributions or goal withdrawals
    // (retirement withdrawals from brokerage are tracked by the engine separately)

    // Growth: when filtering by parentCategory, use individual accounts' growth field directly
    // (avoids needing the starting balance which prevBalance=0 doesn't capture).
    // Otherwise fall back to balance-delta formula.
    let growth: number;
    if (parentCategoryFilter && yr.individualAccountBalances.length > 0) {
      const filtered = yr.individualAccountBalances.filter(
        (ia) => ia.parentCategory === parentCategoryFilter,
      );
      growth = roundToCents(filtered.reduce((s, ia) => s + ia.growth, 0));
    } else {
      const netInflow = contribution - totalWithdrawal;
      growth = roundToCents(afterTax - prevBalance - netInflow);
    }

    const plannedTxAmount = roundToCents(plannedTxByYear.get(yr.year) ?? 0);
    // Adjust balance by cumulative planned transactions (manual deposits/withdrawals
    // layered on top of the engine projection).
    const adjustedBalance = roundToCents(afterTax + plannedTxAmount);
    const adjustedBasis = roundToCents(
      afterTaxBasis + Math.max(0, plannedTxAmount),
    );

    projectionByYear.push({
      year: yr.year,
      contribution,
      overflow,
      growth,
      goalWithdrawals,
      totalWithdrawal,
      totalTaxCost,
      plannedTransactionTotal: plannedTxAmount,
      endBalance: adjustedBalance,
      endBasis: adjustedBasis,
      unrealizedGain: roundToCents(adjustedBalance - adjustedBasis),
    });

    prevBalance = afterTax;
  }

  // Check for goals with target years beyond projection range
  const lastYear =
    engineYears.length > 0 ? engineYears[engineYears.length - 1]!.year : 0;
  for (const goal of goals) {
    if (goal.targetYear > lastYear) {
      warnings.push(
        `Goal "${goal.name}" target year ${goal.targetYear} is beyond projection range`,
      );
    }
  }

  return {
    projectionByYear,
    goals: goals
      .map((g) => goalStatusMap.get(g.id))
      .filter((s): s is BrokerageGoalStatus => s != null),
    warnings,
  };
}
