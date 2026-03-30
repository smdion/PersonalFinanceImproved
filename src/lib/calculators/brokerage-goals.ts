// Brokerage Goals Calculator — pure function, no DB, no side effects.
//
// Enriches contribution engine output with a brokerage-focused view:
// goal funding status, year-by-year brokerage projection, and tax breakdowns.
// The engine handles the actual balance tracking and goal withdrawals;
// this calculator provides the goal-oriented analysis layer.

import { roundToCents } from "@/lib/utils/math";
import { isOverflowTarget } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import type {
  EngineAccumulationYear,
  EngineDecumulationYear,
  EngineYearProjection,
} from "./types";

// --- Input ---

export type BrokerageGoalInput = {
  id: number;
  name: string;
  targetAmount: number;
  targetYear: number;
  priority: number;
};

export type BrokerageGoalsInput = {
  asOfDate: Date;
  goals: BrokerageGoalInput[];
  /** Engine projection years (accumulation + decumulation). */
  engineYears: EngineYearProjection[];
  /** When set, derive afterTax balance from individual accounts matching this parentCategory
   *  instead of the aggregate balanceByTaxType.afterTax (which mixes all parentCategories). */
  parentCategoryFilter?: string;
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

export type BrokerageIndividualAccount = {
  name: string;
  category: string;
  balance: number;
  contribution: number;
  employerMatch: number;
  growth: number;
  intentionalContribution?: number;
  overflowContribution?: number;
};

export type BrokerageGoalYear = {
  year: number;
  /** Intentional brokerage contribution from engine (employee + match). */
  contribution: number;
  /** Employer match total (subset of contribution, shown separately in tooltips). */
  employerMatch: number;
  /** IRS limit overflow routed to brokerage by the engine. */
  overflow: number;
  /** Investment growth (balance change minus net contributions/withdrawals). */
  growth: number;
  /** Goal withdrawals processed by the engine this year. */
  goalWithdrawals: BrokerageGoalWithdrawal[];
  totalWithdrawal: number;
  totalTaxCost: number;
  endBalance: number;
  endBasis: number;
  unrealizedGain: number;
  /** Pro-rate fraction for first year (e.g. 0.833 = 10/12 months). null for full years. */
  proRateFraction: number | null;
  /** Return rate applied this year. */
  returnRate: number;
  /** Per-account breakdown for Portfolio-filtered accounts. */
  individualAccounts: BrokerageIndividualAccount[];
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
  const { goals, engineYears, parentCategoryFilter } = input;
  const warnings: string[] = [];

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
    let employerMatch = 0;
    let overflow = 0;
    let goalWithdrawals: BrokerageGoalWithdrawal[] = [];
    let totalWithdrawal = 0;
    let totalTaxCost = 0;
    let proRateFraction: number | null = null;

    if (yr.phase === "accumulation") {
      const accYr = yr as EngineAccumulationYear;
      proRateFraction = accYr.proRateFraction;

      if (parentCategoryFilter && yr.individualAccountBalances.length > 0) {
        // Derive contribution/overflow from filtered individual accounts' breakdown fields.
        const filtered = yr.individualAccountBalances.filter(
          (ia) => ia.parentCategory === parentCategoryFilter,
        );
        contribution = roundToCents(
          filtered.reduce(
            (s, ia) => s + (ia.intentionalContribution ?? ia.contribution),
            0,
          ),
        );
        employerMatch = roundToCents(
          filtered.reduce((s, ia) => s + ia.employerMatch, 0),
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
        employerMatch = brokerageSlot
          ? roundToCents(brokerageSlot.employerMatch)
          : 0;
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

      // Update goal statuses
      for (const gw of accYr.brokerageGoalWithdrawals) {
        const status = goalStatusMap.get(gw.goalId);
        if (!status) continue;
        status.projectedBalance = roundToCents(afterTax + gw.amount);
        status.actualWithdrawal = gw.amount;
        status.shortfall = roundToCents(
          Math.max(0, status.targetAmount - gw.amount),
        );
        status.funded = status.shortfall === 0;
        status.taxCost = gw.taxCost;
      }
    } else if (yr.phase === "decumulation") {
      // Brokerage contributions continue post-retirement (fixed-dollar only)
      const decYr = yr as EngineDecumulationYear;
      contribution = roundToCents(decYr.brokerageContribution);
      if (parentCategoryFilter && yr.individualAccountBalances.length > 0) {
        const filtered = yr.individualAccountBalances.filter(
          (ia) => ia.parentCategory === parentCategoryFilter,
        );
        employerMatch = roundToCents(
          filtered.reduce((s, ia) => s + ia.employerMatch, 0),
        );
      }
    }

    // Growth: when filtering by parentCategory, use individual accounts' growth field directly
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

    // Build per-account breakdown for tooltips
    const filteredAccounts =
      parentCategoryFilter && yr.individualAccountBalances.length > 0
        ? yr.individualAccountBalances.filter(
            (ia) => ia.parentCategory === parentCategoryFilter,
          )
        : yr.individualAccountBalances;

    projectionByYear.push({
      year: yr.year,
      contribution,
      employerMatch,
      overflow,
      growth,
      goalWithdrawals,
      totalWithdrawal,
      totalTaxCost,
      endBalance: roundToCents(afterTax),
      endBasis: roundToCents(afterTaxBasis),
      unrealizedGain: roundToCents(afterTax - afterTaxBasis),
      proRateFraction,
      returnRate: yr.returnRate,
      individualAccounts: filteredAccounts.map((ia) => ({
        name: ia.name,
        category: ia.category,
        balance: ia.balance,
        contribution: ia.contribution,
        employerMatch: ia.employerMatch,
        growth: ia.growth,
        intentionalContribution: ia.intentionalContribution,
        overflowContribution: ia.overflowContribution,
      })),
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
