/**
 * Pure business logic for IRS contribution limit resolution and view-aware metrics.
 * No DB or I/O dependency.
 */
import type { AccountCategory } from "@/lib/config/account-types";
import {
  getAccountTypeConfig,
  categoriesWithIrsLimit,
  getLimitGroup,
  isPayrollFicaExemptCategory,
  isRetirementParent,
} from "@/lib/config/account-types";
import { HSA_FAMILY_COVERAGE } from "@/lib/config/enum-values";
import { requireLimit } from "@/server/helpers/settings";
import { safeDivide } from "@/lib/utils/math";
import { ageInYearFromDob } from "@/lib/pure/household/age";
import type { ViewMode } from "@/lib/pure/types/shared";
export { formatEmployerMatch } from "./contributions/contribution-amount";
export * from "./contributions/view-metrics";
import type { ViewAwareTotals } from "./contributions/view-metrics";
export * from "./contributions/contribution-order";

/** The limit row an account's base IRS limit comes from: the coverage
 *  variant (family HSA) when it applies, else the base key. */
export function irsLimitBaseKey(
  keys: { base: string; coverageVariant?: string | null },
  hsaCoverageType: string | null,
): string {
  return keys.coverageVariant && hsaCoverageType === HSA_FAMILY_COVERAGE
    ? keys.coverageVariant
    : keys.base;
}

/**
 * Resolve the IRS contribution limit for an account type, factoring in
 * coverage variants (HSA family vs individual) and age-based catchup/super-catchup.
 */
export function resolveIrsLimit(
  accountType: string,
  age: number,
  hsaCoverageType: string | null,
  limitsRecord: Record<string, number>,
): number {
  if (!categoriesWithIrsLimit().includes(accountType as AccountCategory))
    return 0;
  const cfg = getAccountTypeConfig(accountType as AccountCategory);
  const keys = cfg.irsLimitKeys;
  if (!keys) return 0;

  let limit = requireLimit(
    limitsRecord,
    irsLimitBaseKey(keys, hsaCoverageType),
  );

  if (
    cfg.superCatchupAgeRange &&
    age >= cfg.superCatchupAgeRange[0] &&
    age <= cfg.superCatchupAgeRange[1]
  ) {
    if (keys.superCatchup) limit += limitsRecord[keys.superCatchup] ?? 0;
  } else if (cfg.catchupAge !== null && age >= cfg.catchupAge && keys.catchup) {
    limit += limitsRecord[keys.catchup] ?? 0;
  }

  return limit;
}

/**
 * resolveIrsLimit, or null when the year's tax data lacks the limit row
 * (a restore or a demo schema can be missing newer keys) — for readers that
 * should hide a figure rather than throw.
 */
export function irsLimitOrNull(
  accountType: string,
  age: number,
  hsaCoverageType: string | null,
  limitsRecord: Record<string, number>,
): number | null {
  if (!categoriesWithIrsLimit().includes(accountType as AccountCategory))
    return null;
  const keys = getAccountTypeConfig(
    accountType as AccountCategory,
  ).irsLimitKeys;
  if (!keys) return null;
  if (limitsRecord[irsLimitBaseKey(keys, hsaCoverageType)] === undefined)
    return null;
  return resolveIrsLimit(accountType, age, hsaCoverageType, limitsRecord);
}

/**
 * What sizes a person's FICA-exempt caps: the limits for a tax year and the
 * person's age at Dec 31 of that year (catch-up eligibility). Age null when
 * the person isn't known — the cap then can't be sized (see
 * payrollFicaExemptCap), never guessed at age 0.
 */
export function ficaCapContext(
  limits: Record<string, number>,
  dateOfBirth: string | null,
  taxYear: number,
): { limits: Record<string, number>; ageAtYearEnd: number | null } {
  return {
    limits,
    ageAtYearEnd:
      dateOfBirth === null ? null : ageInYearFromDob(dateOfBirth, taxYear),
  };
}

/**
 * The yearly cap on an account's payroll contributions that are not FICA
 * wages (account-type config `payrollFicaExempt` — HSA via a §125
 * cafeteria plan, IRS Pub 15 / 15-B): the IRS limit for the person's
 * coverage and age, less the employer's money, which counts toward the
 * same limit. `null` = contributions to this account type are FICA wages.
 *
 * When the coverage isn't recorded (an account type whose limit depends on
 * it) or the limit isn't in the tax data, the cap can't be sized, so the
 * whole payroll contribution is treated as exempt (Infinity) rather than
 * guessed at the lower limit. One rule for the paycheck and the annual tax.
 */
export function payrollFicaExemptCap(
  accountType: string,
  ageAtYearEnd: number | null,
  hsaCoverageType: string | null,
  limitsRecord: Record<string, number>,
  employerAnnual: number,
): number | null {
  if (!isPayrollFicaExemptCategory(accountType)) return null;
  const keys = getAccountTypeConfig(
    accountType as AccountCategory,
  ).irsLimitKeys;
  if (!keys || ageAtYearEnd === null) return Infinity;
  if (keys.coverageVariant && hsaCoverageType === null) return Infinity;
  if (limitsRecord[irsLimitBaseKey(keys, hsaCoverageType)] === undefined)
    return Infinity;
  return Math.max(
    0,
    resolveIrsLimit(accountType, ageAtYearEnd, hsaCoverageType, limitsRecord) -
      employerAnnual,
  );
}

/**
 * Resolve prior-year IRS limit for an account type.
 * Uses prior-year age (one year younger) and prior-year limits record.
 */
export function resolvePriorYearLimit(
  accountType: string,
  age: number,
  hsaCoverageType: string | null,
  priorYearLimitsRecord: Record<string, number>,
): number {
  if (!categoriesWithIrsLimit().includes(accountType as AccountCategory))
    return 0;
  const cfg = getAccountTypeConfig(accountType as AccountCategory);
  if (!cfg.supportsPriorYearContrib) return 0;
  const keys = cfg.irsLimitKeys;
  if (!keys) return 0;

  const baseKey = irsLimitBaseKey(keys, hsaCoverageType);

  const priorYearAge = age - 1;
  let limit = priorYearLimitsRecord[baseKey] ?? 0;

  if (
    cfg.superCatchupAgeRange &&
    priorYearAge >= cfg.superCatchupAgeRange[0] &&
    priorYearAge <= cfg.superCatchupAgeRange[1]
  ) {
    if (keys.superCatchup)
      limit += priorYearLimitsRecord[keys.superCatchup] ?? 0;
  } else if (
    cfg.catchupAge !== null &&
    priorYearAge >= cfg.catchupAge &&
    keys.catchup
  ) {
    limit += priorYearLimitsRecord[keys.catchup] ?? 0;
  }

  return limit;
}

/** Minimal shape for a contribution account used in sibling total computation. */
type SiblingContrib = {
  accountType: string;
  annualContribution: number;
  employerMatch: number;
};

/**
 * Compute the total annual contributions from sibling accounts in the same IRS limit group,
 * optionally including employer match when the account type counts it toward the limit.
 */
export function computeSiblingTotal(
  contribs: SiblingContrib[],
  currentIndex: number,
  matchCountsTowardLimit: boolean,
): number {
  const currentType = contribs[currentIndex]!.accountType;
  const group = getLimitGroup(currentType as AccountCategory);
  if (!group) return 0;

  let total = 0;
  for (let j = 0; j < contribs.length; j++) {
    if (j === currentIndex) continue;
    if (getLimitGroup(contribs[j]!.accountType as AccountCategory) !== group)
      continue;
    total += contribs[j]!.annualContribution;
    if (matchCountsTowardLimit) {
      total += contribs[j]!.employerMatch;
    }
  }
  return total;
}

/**
 * Determine if a prior-year contribution amount is eligible to be applied.
 * Requires: in the IRS prior-year window, account type supports it, and amount > 0.
 */
export function isEligibleForPriorYear(
  inPriorYearWindow: boolean,
  accountType: string,
  priorYearAmount: number,
): boolean {
  if (!inPriorYearWindow || priorYearAmount <= 0) return false;
  if (!categoriesWithIrsLimit().includes(accountType as AccountCategory))
    return false;
  const cfg = getAccountTypeConfig(accountType as AccountCategory);
  return cfg.supportsPriorYearContrib === true;
}

/** One account's share of a household savings breakdown — the subset of
 * the contribution-summary snapshot the helper below reads. */
type SavingsAccount = {
  parentCategory: string;
  employeeContrib: number;
  tradContrib: number;
  taxFreeContrib: number;
  afterTaxContrib: number;
  hsaContrib: number;
  views: Record<ViewMode, { employeeContrib: number; totalContrib: number }>;
};

/** A person shape sufficient to derive a household savings rate — the
 * subset of the contribution-summary router output the dashboard reads. */
export type SavingsRatePerson = {
  totalCompensation?: number | null;
  salary?: number | null;
  accountTypes: SavingsAccount[];
  totals: {
    views: Record<
      ViewMode,
      Pick<
        ViewAwareTotals,
        | "retirementWithoutMatch"
        | "retirementWithMatch"
        | "portfolioWithoutMatch"
        | "portfolioWithMatch"
        | "compensation"
      >
    >;
  };
};

/** Sum of each person's total compensation (falls back to salary). Compute
 * once and reuse — callers typically need it both to decide `excludeMatch`
 * (via `isHighIncomeHousehold`) and to weight the rate itself. */
export function householdTotalCompensation(
  people: Pick<SavingsRatePerson, "totalCompensation" | "salary">[],
): number {
  return people.reduce((s, d) => s + (d.totalCompensation ?? d.salary ?? 0), 0);
}

/** Household-level "is this a high earner" gate — whether employer match is
 * excluded from the headline savings rate by default. A line not known yet
 * (still loading) is never crossed; surfaces that judge with it wait. */
export function isHighIncomeHousehold(
  householdTotalComp: number,
  highIncomeThreshold: number | undefined,
): boolean {
  return (
    highIncomeThreshold !== undefined &&
    householdTotalComp >= highIncomeThreshold
  );
}

export type SavingsGroup = "retirement" | "portfolio";

const TREATMENTS = [
  ["preTax", "tradContrib"],
  ["taxFree", "taxFreeContrib"],
  ["afterTax", "afterTaxContrib"],
  ["hsa", "hsaContrib"],
] as const;
export type SavingsTreatment = (typeof TREATMENTS)[number][0];

/**
 * The household savings rate for a view, and what it's made of: every
 * person's and every joint account's contributions over the compensation
 * the view divides by (YTD: earned so far), split by goal group
 * (Retirement / Portfolio — parentCategory) and, within each, by tax
 * treatment. Treatments come from the paycheck setup, so each group's split
 * is scaled to the view's employee dollars; the employer match (when
 * included) is its own line. Shares are fractions of compensation, and a
 * group's lines add up to the group.
 */
export function householdSavings(
  people: SavingsRatePerson[],
  jointAccounts: SavingsAccount[],
  viewMode: ViewMode,
  {
    excludeMatch,
    includePortfolio = true,
  }: {
    excludeMatch: boolean;
    /** false: Retirement accounts only (Portfolio money left out of the rate). */
    includePortfolio?: boolean;
  },
) {
  const compensation = people.reduce(
    (s, d) => s + d.totals.views[viewMode].compensation,
    0,
  );
  const share = (n: number) => safeDivide(n, compensation, 0);
  const groupOf = (a: SavingsAccount): SavingsGroup =>
    isRetirementParent(a.parentCategory) ? "retirement" : "portfolio";
  const groups = (["retirement", "portfolio"] as const).map((group) => {
    const persons = people.map((d) => d.totals.views[viewMode]);
    const joint = jointAccounts.filter((a) => groupOf(a) === group);
    const employee =
      persons.reduce((s, v) => s + v[`${group}WithoutMatch`], 0) +
      joint.reduce((s, a) => s + a.views[viewMode].employeeContrib, 0);
    const withMatch =
      persons.reduce((s, v) => s + v[`${group}WithMatch`], 0) +
      joint.reduce((s, a) => s + a.views[viewMode].totalContrib, 0);
    const accounts = [
      ...people.flatMap((d) =>
        d.accountTypes.filter((a) => groupOf(a) === group),
      ),
      ...joint,
    ];
    const plan = accounts.reduce((s, a) => s + a.employeeContrib, 0);
    const scale = safeDivide(employee, plan, 0);
    const lines: { key: SavingsTreatment | "match"; share: number }[] =
      TREATMENTS.map(([key, field]) => ({
        key,
        share: share(accounts.reduce((s, a) => s + a[field], 0) * scale),
      }));
    if (!excludeMatch)
      lines.push({ key: "match", share: share(withMatch - employee) });
    const total = excludeMatch ? employee : withMatch;
    return {
      group,
      total,
      share: share(total),
      lines: lines.filter((l) => l.share > 0),
    };
  });
  const counted = groups.filter(
    (g) => g.total !== 0 && (includePortfolio || g.group !== "portfolio"),
  );
  const total = counted.reduce((s, g) => s + g.total, 0);
  return {
    compensation,
    total,
    rate: share(total),
    groups: counted,
  };
}

export type HouseholdSavings = ReturnType<typeof householdSavings>;
