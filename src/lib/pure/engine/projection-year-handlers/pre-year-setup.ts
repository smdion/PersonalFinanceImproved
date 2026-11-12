/**
 * runPreYearSetup — shared per-year preparation before the accumulation /
 * decumulation branch. Computes return rate, applies profile switches,
 * projects salary and expenses, dispatches the spending strategy.
 */
import { expenseEndingFactor } from "../expense-endings";
import { socialSecurityForYear } from "../social-security-income";
import { ageInYear } from "../../../utils/date";
import { roundToCents } from "../../../utils/math";
import { firstYearStatedNeed } from "./stated-need";
import { WITHDRAWAL_STRATEGY_CONFIG } from "@/lib/config/withdrawal-strategies";
import { applySpendingStrategy } from "../spending-strategy";
import { buildSpecToAccountMapping } from "../individual-accounts/contributions";
import { resolveReturnRateForAge } from "../growth-application";
import { scopedBalances } from "../balance-utils";
import { computeNonRetirementExclusion } from "@/lib/pure/accounts/eligibility";
import type { ContributionSpec } from "../types/contribution-spec";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

// ---------------------------------------------------------------------------
// Pre-year setup (shared logic before accumulation/decumulation branch)
// ---------------------------------------------------------------------------

/** A spec with no money this year (its owner away, or saving stopped): nothing is left for year 0. */
const NO_MONEY_THIS_YEAR = {
  value: 0,
  baseAnnual: 0,
  salaryFraction: 0,
  configuredAnnual: undefined,
  leftThisYear: undefined,
} satisfies Partial<ContributionSpec>;

/**
 * Shared per-year setup: return rate, profile switch, salary, expenses and spending strategy.
 * Mutates state for those fields; returns the PreYearSetup values the phase handlers need.
 */
export function runPreYearSetup(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  yearIndex: number,
): PreYearSetup {
  const {
    input,
    salaryGrowthRate,
    inflation,
    salaryOverrideMap,
    perPersonSalaryOverrides,
    currentYearBonusAdjustment,
    budgetOverrideMap,
    returnRateMap,
    sortedProfileSwitches,
    hasIndividualAccounts,
    indAccounts,
    indKey,
    indParentCat,
    hasPerPersonSalary,
    activeStrategy,
    activeStrategyParams,
  } = ctx;

  const age = input.currentAge + yearIndex;
  const year = input.asOfDate.getFullYear() + yearIndex;
  // A mid-year retirement defers decumulation to year 1, so
  // accumulation-year.ts pro-rates year 0's contributions and growth by
  // firstYearFraction before the phase boundary.
  const { isAccumulation } = yearPhase(input, year, yearIndex, ctx);

  // Get return rate for this age (fall back to closest configured age at
  // or below it, floored at MIN_RETURN_RATE) -- shared with the
  // RMD-smoothing forward projection via resolveReturnRateForAge.
  const returnRate = resolveReturnRateForAge(returnRateMap, age);

  // Contribution profile switches (sticky-forward; last wins within a year).
  // A year-0 switch replaces baseYearContributions, so year 0 reflects the
  // switched profile's amounts, not paycheck data.
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
      if (hasIndividualAccounts) {
        const rebuilt = buildSpecToAccountMapping(
          state.contributionSpecs,
          indAccounts,
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
        const prevSalary = state.projectedSalaryByPerson.get(pid)!;
        if (yearOverrides?.has(pid)) {
          state.projectedSalaryByPerson.set(
            pid,
            Math.max(0, yearOverrides.get(pid)!),
          );
          continue;
        }
        // This person's own raise; the household rate when none is given.
        const personGrowthRate =
          input.salaryGrowthRateByPerson?.[pid] ?? salaryGrowthRate;
        if (yearIndex > 0 && personGrowthRate > 0) {
          let newSalary = prevSalary * (1 + personGrowthRate);
          if (input.salaryCap !== null)
            newSalary = Math.min(newSalary, input.salaryCap);
          state.projectedSalaryByPerson.set(pid, newSalary);
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
            const personSalary =
              state.projectedSalaryByPerson.get(spec.personId) ?? 0;
            spec.salaryFraction =
              (personSalary * (spec.personPayShare ?? 1)) /
              state.projectedSalary;
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

  // Year-0 bonus adjustment (pinned bonus vs the full-formula one in
  // projectedSalary), applied to a local copy so it never compounds.
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

  // People not at work this year (whole years, ctx.workingYearsByPerson) get no salary and no
  // contributions; tracked salary keeps growing. A salary override above $0 outside their
  // working years means they're at work from then.
  const workingYears = ctx.workingYearsByPerson;
  const baseYear = input.asOfDate.getFullYear();
  const atWork = (personId: number) => {
    const w = workingYears[personId];
    if (!w) return true;
    const inWindow = (y: number) =>
      (w.start === null || y >= w.start) && (w.end === null || y <= w.end);
    if (inWindow(year)) return true;
    for (let y = year; y >= baseYear && !inWindow(y); y--) {
      const own = perPersonSalaryOverrides.get(y)?.get(personId);
      if (own !== undefined) return own > 0;
    }
    return false;
  };
  const away = isAccumulation
    ? Object.keys(workingYears)
        .map(Number)
        .filter((id) => !atWork(id))
    : [];
  let yearSpecs: ContributionSpec[] | undefined;
  let nobodyAtWork = false;
  if (away.length > 0) {
    if (hasPerPersonSalary) {
      for (const id of away) {
        effectiveSalary -= effectiveSalaryByPerson.get(id) ?? 0;
        if (effectiveSalaryByPerson.has(id)) effectiveSalaryByPerson.set(id, 0);
      }
      effectiveSalary = Math.max(0, effectiveSalary);
    } else {
      // Household salary: the one earner (salary isn't tracked per person
      // with fewer than two) is away.
      effectiveSalary = 0;
    }
    // Nobody at work (everyone with pay is away, or the one earner): no
    // pay to save from — joint savings stop too.
    nobodyAtWork = hasPerPersonSalary
      ? [...effectiveSalaryByPerson.keys()].every((id) => away.includes(id))
      : true;
    yearSpecs = state.contributionSpecs?.map((spec) => {
      if (
        nobodyAtWork ||
        (spec.personId != null && away.includes(spec.personId))
      )
        return { ...spec, ...NO_MONEY_THIS_YEAR };
      // The others' share of this year's (smaller) household pay.
      if (
        hasPerPersonSalary &&
        spec.method === "percent_of_salary" &&
        spec.personId != null &&
        effectiveSalary > 0
      )
        return {
          ...spec,
          salaryFraction:
            ((effectiveSalaryByPerson.get(spec.personId) ?? 0) *
              (spec.personPayShare ?? 1)) /
            effectiveSalary,
        };
      return spec;
    });
  }
  const gapYear = away.some((id) => {
    const start = workingYears[id]?.start ?? null;
    return start === null || year >= start;
  });
  const savingStopped =
    nobodyAtWork || (gapYear && input.gapYearStopSaving === true);
  if (savingStopped && !nobodyAtWork)
    yearSpecs = (yearSpecs ?? state.contributionSpecs)?.map((spec) => ({
      ...spec,
      ...NO_MONEY_THIS_YEAR,
      employerShare: 0,
    }));

  // Retirement money only, before the expenses block (the Rate-Seeded seed needs it):
  // Portfolio-parented accounts never size retirement spending. Computed once per
  // decumulation year (PreYearSetup.nonRetirement) so every consumer reads the same figure.
  const nonRetirement =
    !isAccumulation && hasIndividualAccounts
      ? computeNonRetirementExclusion(indAccounts, state.indBalance, indKey)
      : undefined;
  const { allAccountsBalance: totalBalance, retirementBalance } =
    scopedBalances(state.balances, nonRetirement);

  // Fires once, on the first year that isn't a working year (a mid-year
  // retirement included); the budget is grown to then by CPI, not by the
  // post-retirement raise.
  const { decumulationExpensesJustSet } = seedRetirementSpending(
    isAccumulation,
    state,
    input,
    retirementBalance,
    inflation,
    yearIndex,
    ctx,
    year,
  );

  // Apply a budget override (sticky-forward) or inflate expenses, using the
  // post-retirement rate after retirement; balance-sized strategies skip it.
  const strategyUsesRaise =
    WITHDRAWAL_STRATEGY_CONFIG[activeStrategy].usesPostRetirementRaise;
  const effectiveInflation = isAccumulation
    ? inflation.rate(yearIndex)
    : inflation.postRate(yearIndex);
  const expenseInflation =
    !isAccumulation && !strategyUsesRaise ? 0 : effectiveInflation;
  // Rate-Seeded year 1 ignores a same-year budget override, or the scenario
  // would be a no-op whenever one is set; later years' overrides apply.
  const skipOverrideThisYear =
    decumulationExpensesJustSet && input.rateSeededDecumulationYear1 === true;
  if (budgetOverrideMap.has(year) && !skipOverrideThisYear) {
    state.projectedExpenses = budgetOverrideMap.get(year)!;
    state.budgetOnlyExpenses = budgetOverrideMap.get(year)!;
  } else if (yearIndex > 0 && !decumulationExpensesJustSet) {
    state.projectedExpenses = state.projectedExpenses * (1 + expenseInflation);
    // budgetOnlyExpenses grows on its own prior value, never projectedExpenses,
    // which may carry last year's guardrail adjustment.
    state.budgetOnlyExpenses =
      state.budgetOnlyExpenses * (1 + expenseInflation);
  }

  // A loan paid off: its line leaves the budget. Not over a figure typed in
  // for this phase, and a rate-seeded retirement has no budget to take it from.
  const typedFigure = [...budgetOverrideMap.keys()].some(
    (y) =>
      y <= year &&
      (isAccumulation ||
        y >= input.retirementYear ||
        input.decumulationAnnualExpenses == null),
  );
  const rateSeeded =
    !isAccumulation && input.rateSeededDecumulationYear1 === true;
  if (!typedFigure && !rateSeeded) {
    const factor = expenseEndingFactor({
      endings: input.expenseEndings,
      phase: isAccumulation ? "accumulation" : "decumulation",
      year,
      seeded: yearIndex === 0 || decumulationExpensesJustSet,
    });
    state.projectedExpenses *= factor;
    state.budgetOnlyExpenses *= factor;
  }

  // --- Spending Strategy Dispatch ---
  let strategyAction: string | null = null;
  state.portfolioWithdrawal = null;

  if (!isAccumulation && activeStrategy !== "fixed") {
    const { ssIncome, ssIncomeToday, ssGrowthFactor } = socialSecurityForYear(
      input,
      year,
      age,
      inflation.growth(yearIndex),
    );
    const ssForStrategy = { ssIncome, ssIncomeToday, ssGrowthFactor };
    // Use primary person's actual age for RMD factor lookup (not household average)
    const primaryAge =
      input.birthYear != null ? ageInYear(input.birthYear, year) : undefined;
    const result = applySpendingStrategy(activeStrategy, activeStrategyParams, {
      projectedExpenses: state.projectedExpenses,
      portfolioBalance: retirementBalance,
      effectiveInflation,
      cpiInflation: inflation.rate(yearIndex),
      // Year 1 of retirement is this year less the years since it.
      cpiGrowthSinceStart: inflation.shockedGrowthBetween(
        yearIndex - state.spendingState.decumulationYearCount,
        yearIndex,
      ),
      hasBudgetOverride: budgetOverrideMap.has(year),
      yearIndex,
      age,
      primaryPersonAge: primaryAge,
      // A couple's VPW uses the younger spouse's age.
      youngestAge:
        input.perPersonBirthYears && input.perPersonBirthYears.length > 0
          ? ageInYear(Math.max(...input.perPersonBirthYears), year)
          : undefined,
      stockShare: input.stockShareByAge?.[Math.round(age)],
      ...ssForStrategy,
      crossYearState: state.spendingState,
    });
    state.projectedExpenses = result.projectedExpenses;
    // A portfolio-sized amount is the gross withdrawal (Social Security on
    // top) unless the household says Social Security comes out of it.
    if (
      result.amountKind === "portfolio_withdrawal" &&
      activeStrategyParams.ssInAmount !== true
    )
      state.portfolioWithdrawal = result.projectedExpenses;
    strategyAction = result.action;
    Object.assign(state.spendingState, result.updatedState);
  }

  // Always track decumulation year count (0-indexed: first decumulation year = 0).
  // Strategies use this for inflation-adjusted floors without each needing to track it.
  if (!isAccumulation) {
    state.spendingState.decumulationYearCount++;
  }

  return {
    age,
    year,
    isAccumulation,
    returnRate,
    strategyAction,
    retirementBalance,
    totalBalance,
    nonRetirement,
    effectiveSalary,
    effectiveSalaryByPerson,
    hasBonusAdjustment,
    yearSpecs,
    gapYear,
    savingStopped,
  };
}

/** Whether this year runs as a working year (UD-02): retiring in year 0
 *  after its start runs it as a pro-rated working year; any other
 *  retirement year runs whole. */
function yearPhase(
  input: ProjectionContext["input"],
  year: number,
  yearIndex: number,
  ctx: ProjectionContext,
) {
  const isAccumulation =
    year < input.retirementYear ||
    (yearIndex === 0 &&
      year === input.retirementYear &&
      ctx.firstYearFraction < 1);

  return { isAccumulation };
}

/** The first retirement year's spending, set once. UD-01 (pending D2): only
 *  a working year 0 is pro-rated (contributions, match, growth, and a gap
 *  year's draw: budget × its share, goal-draws.ts); a retirement year 0 runs whole. */
function seedRetirementSpending(
  isAccumulation: boolean,
  state: ProjectionLoopState,
  input: ProjectionContext["input"],
  retirementBalance: number,
  inflation: ProjectionContext["inflation"],
  yearIndex: number,
  ctx: ProjectionContext,
  year: number,
) {
  const decumulationExpensesJustSet =
    !isAccumulation &&
    !state.decumulationExpensesSet &&
    (input.decumulationAnnualExpenses != null ||
      input.rateSeededDecumulationYear1 === true);
  if (decumulationExpensesJustSet) {
    // Rate-Seeded: year 1 is the Initial Withdrawal Rate × starting balance,
    // not the budget. Strategies evolve it as they would a budget-seeded
    // year 1; only the starting number differs.
    state.projectedExpenses = input.rateSeededDecumulationYear1
      ? roundToCents(
          input.decumulationDefaults.withdrawalRate * retirementBalance,
        )
      : input.decumulationAnnualExpenses! * inflation.growth(yearIndex);
    // budgetOnlyExpenses seeds identically (a rate-seeded run has no budget
    // to track), before anything downstream changes projectedExpenses.
    state.budgetOnlyExpenses = state.projectedExpenses;
    state.decumulationExpensesSet = true;
    state.firstDecumulationYearStatedNeed = firstYearStatedNeed(
      ctx,
      year,
      yearIndex,
    );
  }

  return { decumulationExpensesJustSet };
}
