/**
 * runPreYearSetup — shared per-year preparation before the accumulation /
 * decumulation branch. Computes return rate, applies profile switches,
 * projects salary and expenses, dispatches the spending strategy.
 *
 * Extracted from the old single-file `projection-year-handlers.ts` in the
 * v0.5.2 refactor. Pure relocation — no logic changes.
 */
import { ageInYear } from "../../../utils/date";
import { roundToCents } from "../../../utils/math";
import { WITHDRAWAL_STRATEGY_CONFIG } from "@/lib/config/withdrawal-strategies";
import { applySpendingStrategy } from "../spending-strategy";
import { buildSpecToAccountMapping } from "../individual-account-tracking";
import { resolveReturnRateForAge } from "../growth-application";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

// ---------------------------------------------------------------------------
// Pre-year setup (shared logic before accumulation/decumulation branch)
// ---------------------------------------------------------------------------

/**
 * Runs the shared per-year setup: return rate lookup, profile switch,
 * salary projection, expense projection, and spending strategy dispatch.
 *
 * Mutates state for salary, expenses, contribution specs, and profile fields.
 * Returns the computed PreYearSetup values needed by the phase handlers.
 */
export function runPreYearSetup(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  yearIndex: number,
): PreYearSetup {
  const {
    input,
    salaryGrowthRate,
    inflationRate,
    validatedPostRetirementInflation,
    salaryOverrideMap,
    perPersonSalaryOverrides,
    currentYearBonusAdjustment,
    budgetOverrideMap,
    returnRateMap,
    sortedProfileSwitches,
    hasIndividualAccounts,
    indAccts,
    indKey,
    indParentCat,
    hasPerPersonSalary,
    activeStrategy,
    activeStrategyParams,
  } = ctx;

  const age = input.currentAge + yearIndex;
  const year = input.asOfDate.getFullYear() + yearIndex;
  // Treat yearIndex=0 as a final partial accumulation year when the person is
  // retiring mid-calendar-year (retirementAge === currentAge and the as-of
  // date is before year-end). This defers decumulation to yearIndex=1 so that
  // accumulation-year.ts can pro-rate contributions and growth by
  // firstYearFraction before the phase boundary is crossed.
  const isAccumulation =
    age < input.retirementAge ||
    (yearIndex === 0 &&
      age === input.retirementAge &&
      ctx.firstYearFraction < 1);

  // Get return rate for this age (fall back to closest configured age at
  // or below it, floored at MIN_RETURN_RATE) -- shared with R47's
  // RMD-smoothing forward projection via resolveReturnRateForAge.
  const returnRate = resolveReturnRateForAge(returnRateMap, age);

  // Check for contribution profile switch at this year (sticky-forward).
  // If multiple switches share the same year, last one wins (sorted ascending).
  // Note: a switch at year 0 replaces baseYearContributions used by the
  // useRealContribs path -- the year-0 pro-rated amounts will reflect the
  // switched profile's base amounts, not actual paycheck data.
  for (const ps of sortedProfileSwitches) {
    if (ps.year > year) break;
    if (ps.year === year) {
      // Switch contribution structure only -- salary continues unaffected.
      // A profile switch changes which accounts receive contributions and
      // how much, but the household salary trajectory stays the same.
      state.contributionSpecs = ps.contributionSpecs.map((s) => ({ ...s }));
      state.activeEmployerMatchRateByCategory = ps.employerMatchRateByCategory;
      state.activeBaseYearContributions = ps.baseYearContributions;
      state.activeBaseYearEmployerMatch = ps.baseYearEmployerMatch;
      state.activeEmployerMatchByParentCat = ps.employerMatchByParentCat;
      // Update contribution rate ceiling for the new profile
      state.accumulationDefaults.contributionRate = ps.contributionRate;
      // Rebuild spec-to-account mapping for the new specs
      if (hasIndividualAccounts && state.contributionSpecs) {
        const rebuilt = buildSpecToAccountMapping(
          state.contributionSpecs,
          indAccts,
          indKey,
          indParentCat,
        );
        state.specToAccount.clear();
        rebuilt.specToAccount.forEach((v, k) => state.specToAccount.set(k, v));
        state.accountsWithSpecs.clear();
        rebuilt.accountsWithSpecs.forEach((v) =>
          state.accountsWithSpecs.add(v),
        );
      }
    }
  }

  // Salary projection (only during accumulation)
  if (isAccumulation) {
    if (hasPerPersonSalary) {
      // Per-person salary tracking: grow each person independently, apply per-person overrides
      const yearOverrides = perPersonSalaryOverrides.get(year);
      const personIds = Array.from(state.projectedSalaryByPerson.keys());
      for (const pid of personIds) {
        const prevSal = state.projectedSalaryByPerson.get(pid)!;
        if (yearOverrides?.has(pid)) {
          state.projectedSalaryByPerson.set(
            pid,
            Math.max(0, yearOverrides.get(pid)!),
          );
        } else if (yearIndex > 0 && salaryGrowthRate > 0) {
          let newSal = prevSal * (1 + salaryGrowthRate);
          if (input.salaryCap !== null)
            newSal = Math.min(newSal, input.salaryCap);
          state.projectedSalaryByPerson.set(pid, newSal);
        }
      }
      // Recompute combined salary from per-person totals
      state.projectedSalary = 0;
      personIds.forEach((pid) => {
        state.projectedSalary += state.projectedSalaryByPerson.get(pid) ?? 0;
      });
      // Also update salaryFraction on each spec to reflect current proportions
      if (state.contributionSpecs && state.projectedSalary > 0) {
        for (const spec of state.contributionSpecs) {
          if (spec.method === "percent_of_salary" && spec.personId != null) {
            const personSal =
              state.projectedSalaryByPerson.get(spec.personId) ?? 0;
            spec.salaryFraction = personSal / state.projectedSalary;
          }
        }
      }
    } else {
      // Household-level salary tracking (original behavior)
      if (salaryOverrideMap.has(year)) {
        state.projectedSalary = Math.max(0, salaryOverrideMap.get(year)!);
      } else if (yearIndex > 0 && salaryGrowthRate > 0) {
        state.projectedSalary = Math.max(
          0,
          state.projectedSalary * (1 + salaryGrowthRate),
        );
        if (input.salaryCap !== null) {
          state.projectedSalary = Math.min(
            state.projectedSalary,
            input.salaryCap,
          );
        }
      }
    }
  }

  // Year-0-only bonus adjustment (current-year pinned bonus vs. the
  // full-formula bonus already baked into state.projectedSalary/
  // projectedSalaryByPerson). Applied to a local effectiveSalary — never to
  // state itself — so it doesn't compound into future years' growth.
  let effectiveSalary = state.projectedSalary;
  const effectiveSalaryByPerson = new Map(state.projectedSalaryByPerson);
  let hasBonusAdjustment = false;
  if (isAccumulation && year === input.asOfDate.getFullYear()) {
    for (const [personId, delta] of currentYearBonusAdjustment) {
      if (delta === 0) continue;
      hasBonusAdjustment = true;
      effectiveSalary += delta;
      if (effectiveSalaryByPerson.has(personId)) {
        effectiveSalaryByPerson.set(
          personId,
          effectiveSalaryByPerson.get(personId)! + delta,
        );
      }
    }
  }

  // Hoisted above the expenses block (was originally computed just before
  // the strategy dispatch below) — the Rate-Seeded year-1 seed needs the
  // starting balance available at seed time, not after.
  const preTotalBalance =
    state.balances.preTax +
    state.balances.taxFree +
    state.balances.hsa +
    state.balances.afterTax;

  // Reset expenses to decumulation budget on the FIRST decumulation year.
  // Do NOT key on `age === retirementAge`: that check fails in the mid-year
  // case (retirementAge === currentAge) because by yearIndex=1 the age has already
  // advanced past retirementAge. Instead, fire exactly once on the first year
  // isAccumulation is false, tracked by state.decumulationExpensesSet.
  // Budget values are in today's dollars -- inflate to retirement-year nominal
  // dollars using CPI (inflationRate), NOT the post-retirement raise rate.
  const decumulationExpensesJustSet =
    !isAccumulation &&
    !state.decumulationExpensesSet &&
    (input.decumulationAnnualExpenses != null ||
      input.rateSeededDecumulationYear1 === true);
  if (decumulationExpensesJustSet) {
    // Rate-Seeded scenario (advisor review, 2026-08-28): ignore the stated
    // budget entirely for year 1 -- seed from the household's Initial
    // Withdrawal Rate × starting balance instead. Every strategy's ongoing
    // per-year mechanism (applySpendingStrategy below, unchanged) evolves
    // this exactly the same way it evolves a budget-seeded year 1 -- this
    // only changes where the number starts.
    state.projectedExpenses = input.rateSeededDecumulationYear1
      ? roundToCents(
          input.decumulationDefaults.withdrawalRate * preTotalBalance,
        )
      : input.decumulationAnnualExpenses! *
        Math.pow(1 + inflationRate, yearIndex);
    // budgetOnlyExpenses seeds identically -- a rate-seeded run has no
    // independent "budget" concept to track (it deliberately ignores the
    // budget entirely), so both start from the same rate-seed value; for
    // a normal run this is the same budget-derived number projectedExpenses
    // just got, before anything downstream can mutate the latter.
    state.budgetOnlyExpenses = state.projectedExpenses;
    state.decumulationExpensesSet = true;
  }

  // Apply budget override (sticky-forward) or inflate expenses
  // Use post-retirement raise rate for expense growth after retirement.
  // Skip inflation entirely for strategies that don't use post-retirement raise
  // (their spending is computed from portfolio balance, not inflated expenses).
  const strategyUsesRaise =
    WITHDRAWAL_STRATEGY_CONFIG[activeStrategy].usesPostRetirementRaise;
  const effectiveInflation = isAccumulation
    ? inflationRate
    : validatedPostRetirementInflation;
  const expenseInflation =
    !isAccumulation && !strategyUsesRaise ? 0 : effectiveInflation;
  // Rate-Seeded year 1 deliberately ignores a same-year budget override too
  // -- the scenario exists specifically to answer "what if the budget/
  // override didn't drive this," so letting an override immediately
  // clobber the rate seed on the very year it's set would silently make
  // the scenario a no-op for any household with a year-1 decumulation
  // override configured (advisor review, 2026-08-28). Overrides in LATER
  // years still apply normally -- only the starting point is affected.
  const skipOverrideThisYear =
    decumulationExpensesJustSet && input.rateSeededDecumulationYear1 === true;
  if (budgetOverrideMap.has(year) && !skipOverrideThisYear) {
    state.projectedExpenses = budgetOverrideMap.get(year)!;
    state.budgetOnlyExpenses = budgetOverrideMap.get(year)!;
  } else if (yearIndex > 0 && !decumulationExpensesJustSet) {
    state.projectedExpenses = state.projectedExpenses * (1 + expenseInflation);
    // budgetOnlyExpenses grows on its OWN prior value, never on
    // projectedExpenses -- by this point in a later year, projectedExpenses
    // may already carry last year's guardrail adjustment (Spending
    // Strategy Dispatch below mutates it in place), which must never leak
    // into the budget-only line.
    state.budgetOnlyExpenses =
      state.budgetOnlyExpenses * (1 + expenseInflation);
  }

  // --- Spending Strategy Dispatch ---
  let strategyAction: string | null = null;

  if (!isAccumulation && activeStrategy !== "fixed") {
    // Use primary person's actual age for RMD factor lookup (not household average)
    const primaryAge =
      input.birthYear != null ? ageInYear(input.birthYear, year) : undefined;
    const result = applySpendingStrategy(activeStrategy, activeStrategyParams, {
      projectedExpenses: state.projectedExpenses,
      portfolioBalance: preTotalBalance,
      effectiveInflation,
      cpiInflation: inflationRate,
      hasBudgetOverride: budgetOverrideMap.has(year),
      yearIndex,
      age,
      primaryPersonAge: primaryAge,
      crossYearState: state.spendingState,
    });
    state.projectedExpenses = result.projectedExpenses;
    strategyAction = result.action;
    Object.assign(state.spendingState, result.updatedState);
  }

  // Always track decumulation year count (0-indexed: first decumulation year = 0).
  // Strategies use this for inflation-adjusted floors without each needing to track it.
  if (!isAccumulation) {
    state.spendingState.decumulationYearCount++;
  }

  const totalBalance = preTotalBalance;

  return {
    age,
    year,
    isAccumulation,
    returnRate,
    strategyAction,
    totalBalance,
    effectiveSalary,
    effectiveSalaryByPerson,
    hasBonusAdjustment,
  };
}
