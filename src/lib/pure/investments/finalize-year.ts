/** What finalizing a Performance year writes: the finalized annual rows,
 *  next year's opening rows, the year's gross income and the tax-location
 *  split. finalizePerformanceYear writes them in one transaction. */
import { toNumber } from "@/lib/utils/numbers";
import {
  isPortfolioParent,
  type isRetirementParent,
} from "@/lib/config/account-types";
import {
  PERF_CATEGORY_PORTFOLIO,
  type accountTypeToPerformanceCategory,
} from "@/lib/config/display-labels";
import type { PortfolioTaxType } from "@/lib/config/enum-values";
import { findActiveJob, type JobLike } from "@/lib/pure/household/profiles";
import {
  resolvePersonYearIncome,
  type SalaryProfileActiveMap,
} from "@/lib/pure/household/compensation";
import type { AnnualRowLike } from "./returns";
import { getEffectiveCategory } from "./annual-rollups";

type ParentCategory = NonNullable<Parameters<typeof isRetirementParent>[0]>;

/** A category's (or Portfolio's) annual_performance columns once finalized. */
export function finalizedAnnualFields(
  values: AnnualRowLike,
  returnPct: number | null,
) {
  return {
    isFinalized: true,
    isCurrentYear: false,
    isImmutable: true,
    beginningBalance: values.beginningBalance.toFixed(2),
    totalContributions: values.totalContributions.toFixed(2),
    yearlyGainLoss: values.yearlyGainLoss.toFixed(2),
    endingBalance: values.endingBalance.toFixed(2),
    annualReturnPct: returnPct?.toFixed(6) ?? null,
    employerContributions: values.employerContributions.toFixed(2),
    distributions: values.distributions.toFixed(2),
    fees: values.fees.toFixed(2),
    rollovers: values.rollovers.toFixed(2),
    lifetimeGains: values.lifetimeGains.toFixed(2),
    lifetimeContributions: values.lifetimeContributions.toFixed(2),
    lifetimeMatch: values.lifetimeMatch.toFixed(2),
  };
}

/** Next year's account_performance row for an active account: it opens at
 *  this year's ending balance, with no flows yet. */
export function nextYearAccountRow(
  a: {
    institution: string;
    accountLabel: string;
    ownerPersonId: number | null;
    parentCategory: ParentCategory;
    performanceAccountId: number;
    endingBalance: string;
  },
  allPerfAccounts: { id: number; parentCategory: ParentCategory }[],
  nextYear: number,
) {
  const masterAcct = a.performanceAccountId
    ? allPerfAccounts.find((m) => m.id === a.performanceAccountId)
    : null;
  return {
    year: nextYear,
    institution: a.institution,
    accountLabel: a.accountLabel,
    ownerPersonId: a.ownerPersonId,
    parentCategory: masterAcct?.parentCategory ?? a.parentCategory,
    isActive: true,
    performanceAccountId: a.performanceAccountId,
    beginningBalance: a.endingBalance, // prev year ending = next year beginning
    totalContributions: "0",
    yearlyGainLoss: "0",
    endingBalance: a.endingBalance, // start with same as beginning
    employerContributions: "0",
    fees: "0",
    distributions: "0",
  };
}

/** Next year's annual_performance row for a category (Portfolio: every
 *  active account), carrying this year's finalized lifetime totals. */
export function nextYearAnnualRow(
  nextYear: number,
  category: string,
  activeAccounts: (Parameters<typeof getEffectiveCategory>[0] & {
    endingBalance: string;
  })[],
  finalizeLookups: Parameters<typeof getEffectiveCategory>[1],
  finalizedAnnualRows: {
    category: ReturnType<typeof accountTypeToPerformanceCategory>;
    lifetimeGains: string;
    lifetimeContributions: string;
    lifetimeMatch: string;
  }[],
) {
  const catAccounts =
    category === PERF_CATEGORY_PORTFOLIO
      ? activeAccounts
      : activeAccounts.filter(
          (a) => getEffectiveCategory(a, finalizeLookups) === category,
        );

  const beginBal = catAccounts.reduce(
    (sum, a) => sum + toNumber(a.endingBalance),
    0,
  );
  const prev = finalizedAnnualRows.find((r) => r.category === category);

  return {
    year: nextYear,
    category,
    beginningBalance: beginBal.toFixed(2),
    totalContributions: "0",
    yearlyGainLoss: "0",
    endingBalance: beginBal.toFixed(2),
    employerContributions: "0",
    fees: "0",
    distributions: "0",
    lifetimeGains: prev?.lifetimeGains ?? "0",
    lifetimeContributions: prev?.lifetimeContributions ?? "0",
    lifetimeMatch: prev?.lifetimeMatch ?? "0",
    isCurrentYear: true,
    isFinalized: false,
  };
}

/** The household's gross income (salary + bonus) for the finalized year,
 *  and whether anyone's income for it was recorded. */
export function yearGrossIncome(
  year: number,
  currentYear: number,
  allPeople: { id: number }[],
  allJobs: (JobLike & { id: number })[],
  salaryRowByPerson: Map<
    number,
    NonNullable<Parameters<typeof resolvePersonYearIncome>[2]>
  >,
  salaryProfileActiveMap: SalaryProfileActiveMap,
  asOf: Date,
) {
  let grossIncome = 0;
  let anyIncomeRecorded = false;
  for (const person of allPeople) {
    const activeJob = findActiveJob(allJobs, person.id, asOf);
    const income = resolvePersonYearIncome(
      year,
      currentYear,
      salaryRowByPerson.get(person.id),
      activeJob?.id ?? null,
      salaryProfileActiveMap,
    );
    grossIncome += income.salary + income.bonus;
    if (income.recorded) anyIncomeRecorded = true;
  }
  return { grossIncome, anyIncomeRecorded };
}

/** Of the two snapshots bracketing Dec 31, the one nearest it, or none. */
export function nearestToYearEnd<T extends { snapshotDate: string }>(
  yearEndDate: string,
  candidates: (T | undefined)[],
): T[] {
  const daysFromYearEnd = (d: string) =>
    Math.abs(Date.parse(d) - Date.parse(yearEndDate));
  return candidates
    .filter((x) => x !== undefined)
    .sort(
      (a, b) =>
        daysFromYearEnd(a.snapshotDate) - daysFromYearEnd(b.snapshotDate),
    )
    .slice(0, 1);
}

/** A snapshot's accounts summed by tax type, Portfolio-parented apart
 *  from the rest (Retirement). */
export function portfolioByTaxLocationFrom(
  snapAccounts: {
    parentCategory: ParentCategory;
    taxType: PortfolioTaxType;
    amount: string;
  }[],
) {
  const portfolioByTaxLocation: {
    retirement: Record<string, number>;
    portfolio: Record<string, number>;
  } = { retirement: {}, portfolio: {} };

  for (const a of snapAccounts) {
    const bucket = isPortfolioParent(a.parentCategory)
      ? portfolioByTaxLocation.portfolio
      : portfolioByTaxLocation.retirement;
    bucket[a.taxType] = (bucket[a.taxType] ?? 0) + toNumber(a.amount);
  }
  return portfolioByTaxLocation;
}
