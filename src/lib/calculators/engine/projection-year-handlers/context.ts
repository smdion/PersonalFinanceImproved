/**
 * buildProjectionContext — builds the immutable context for a projection run.
 */
import type { ProjectionInput, AccountCategory } from "../../types";
import {
  getAllCategories,
  categoriesWithIrsLimit,
  isOverflowTarget,
} from "../../../config/account-types";
import { MONTHS_PER_YEAR } from "../../../constants";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import { getStrategyDefaults } from "@/lib/config/withdrawal-strategies";
import { makeIndKey } from "../individual-account-tracking";
import { getRmdStartAge } from "../../../config/rmd-tables";
import type { BrokerageGoal, ProjectionContext } from "./types";

// ---------------------------------------------------------------------------
// Context and state builders
// ---------------------------------------------------------------------------

/**
 * Build the immutable projection context from input and validated rates.
 */
export function buildProjectionContext(
  input: ProjectionInput,
  validated: {
    salaryGrowthRate: number;
    inflationRate: number;
    postRetirementInflationRate: number;
  },
): ProjectionContext {
  const ACCOUNT_CATEGORIES: AccountCategory[] = getAllCategories();
  const OVERFLOW_CATEGORY: AccountCategory =
    ACCOUNT_CATEGORIES.find(isOverflowTarget)!;
  const TAX_ADVANTAGED = new Set<AccountCategory>(categoriesWithIrsLimit());

  // Pre-sort profile switches
  const sortedProfileSwitches = [...(input.profileSwitches ?? [])].sort(
    (a, b) => a.year - b.year,
  );

  // Sort overrides by year
  const sortedAccOverrides = [...input.accumulationOverrides].sort(
    (a, b) => a.year - b.year,
  );
  const sortedDecOverrides = [...input.decumulationOverrides].sort(
    (a, b) => a.year - b.year,
  );

  // Build salary override map (household-level fallback)
  const salaryOverrideMap = new Map<number, number>();
  for (const o of input.salaryOverrides) salaryOverrideMap.set(o.year, o.value);

  // Build per-person salary override map: year -> personId -> value
  const perPersonSalaryOverrides = new Map<number, Map<number, number>>();
  if (input.perPersonSalaryOverrides) {
    for (const o of input.perPersonSalaryOverrides) {
      if (!perPersonSalaryOverrides.has(o.year))
        perPersonSalaryOverrides.set(o.year, new Map());
      perPersonSalaryOverrides.get(o.year)!.set(o.personId, o.value);
    }
  }
  const hasPerPersonSalary =
    input.salaryByPerson && Object.keys(input.salaryByPerson).length > 0;

  const currentYearBonusAdjustment = new Map<number, number>();
  if (input.currentYearBonusAdjustment) {
    for (const [personId, delta] of Object.entries(
      input.currentYearBonusAdjustment,
    )) {
      currentYearBonusAdjustment.set(Number(personId), delta);
    }
  }

  // Each person's working years: their job's (input.workingYearsByPerson),
  // ending by the year before their own retirement when that comes before
  // the household's — a partial retirement. Outside them the person has no
  // pay and their contributions stop (pre-year-setup), fixed-dollar ones
  // included; the other person keeps working.
  const workingYearsByPerson: Record<
    number,
    { start: number | null; end: number | null }
  > = { ...input.workingYearsByPerson };
  if (input.retirementAgeByPerson && hasPerPersonSalary) {
    const baseYear = input.asOfDate.getFullYear();
    const householdRetYear =
      baseYear + (input.retirementAge - input.currentAge);
    for (const [pidStr, retAge] of Object.entries(
      input.retirementAgeByPerson,
    )) {
      const pid = Number(pidStr);
      const personBirthYear = input.socialSecurityEntries?.find(
        (e) => e.personId === pid,
      )?.birthYear;
      if (personBirthYear == null) continue;
      const retirementYear = personBirthYear + retAge;
      if (retirementYear >= householdRetYear) continue;
      const job = workingYearsByPerson[pid];
      workingYearsByPerson[pid] = {
        start: job?.start ?? null,
        end: Math.min(job?.end ?? Infinity, retirementYear - 1),
      };
    }
  }

  // Build budget override map (monthly budget -> annual; sticky-forward)
  const budgetOverrideMap = new Map<number, number>();
  for (const o of input.budgetOverrides)
    budgetOverrideMap.set(o.year, o.value * MONTHS_PER_YEAR);

  // Build brokerage goals by year (sorted by priority within each year)
  const brokerageGoalsByYear = new Map<number, BrokerageGoal[]>();
  if (input.brokerageGoals) {
    for (const g of input.brokerageGoals) {
      if (!brokerageGoalsByYear.has(g.targetYear))
        brokerageGoalsByYear.set(g.targetYear, []);
      brokerageGoalsByYear.get(g.targetYear)!.push(g);
    }
    brokerageGoalsByYear.forEach((goals) => {
      goals.sort((a, b) => a.priority - b.priority);
    });
  }

  // Build return rate map (age -> rate)
  const returnRateMap = new Map<number, number>();
  for (const r of input.returnRates) {
    // Extract age from label like "Age 39"
    const ageMatch = r.label.match(/(\d+)/);
    if (ageMatch) returnRateMap.set(Number(ageMatch[1]), r.rate);
  }

  const yearsToProject = Math.max(0, input.projectionEndAge - input.currentAge);

  // First-year pro-rating: remaining contributable months.
  // If past mid-month (day > 15), current month's contribution is assumed done → exclude it.
  // Otherwise include it (e.g., Jan 1 → 12 months, Jul 1 → 6 months, Mar 30 → 9 months).
  const pastMidMonth = input.asOfDate.getDate() > 15;
  const monthsRemaining =
    MONTHS_PER_YEAR - input.asOfDate.getMonth() - (pastMidMonth ? 1 : 0);
  const firstYearFraction = monthsRemaining / MONTHS_PER_YEAR;

  const rmdStartAge =
    input.birthYear != null ? getRmdStartAge(input.birthYear) : null;

  // Per-person RMD start ages (from SS entries or individual accounts with ownerPersonId)
  const rmdStartAgeByPerson = new Map<
    number,
    { startAge: number; birthYear: number }
  >();
  if (input.socialSecurityEntries) {
    for (const entry of input.socialSecurityEntries) {
      rmdStartAgeByPerson.set(entry.personId, {
        startAge: getRmdStartAge(entry.birthYear),
        birthYear: entry.birthYear,
      });
    }
  }

  // Individual account tracking
  const indAccts = input.individualAccounts ?? [];
  const hasIndividualAccounts = indAccts.length > 0;
  const indKey = makeIndKey();
  const indParentCat = new Map<string, string>();
  for (const ia of indAccts) {
    if (ia.parentCategory) indParentCat.set(indKey(ia), ia.parentCategory);
  }

  // Spending strategy tracking
  const activeStrategy: WithdrawalStrategyType =
    input.decumulationDefaults.withdrawalStrategy ?? "fixed";
  const activeStrategyParams: Record<string, number | boolean> = {
    ...getStrategyDefaults(activeStrategy),
    ...(input.decumulationDefaults.strategyParams?.[activeStrategy] ?? {}),
  };

  return {
    input,
    salaryGrowthRate: validated.salaryGrowthRate,
    inflationRate: validated.inflationRate,
    validatedPostRetirementInflation: validated.postRetirementInflationRate,
    salaryOverrideMap,
    perPersonSalaryOverrides,
    currentYearBonusAdjustment,
    budgetOverrideMap,
    returnRateMap,
    brokerageGoalsByYear,
    sortedAccOverrides,
    sortedDecOverrides,
    sortedProfileSwitches,
    hasIndividualAccounts,
    indAccts,
    indKey,
    indParentCat,
    hasPerPersonSalary: !!hasPerPersonSalary,
    workingYearsByPerson,
    activeStrategy,
    activeStrategyParams,
    firstYearFraction,
    rmdStartAge,
    rmdStartAgeByPerson,
    yearsToProject,
    ACCOUNT_CATEGORIES,
    OVERFLOW_CATEGORY,
    TAX_ADVANTAGED,
  };
}
