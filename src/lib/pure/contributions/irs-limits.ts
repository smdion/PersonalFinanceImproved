/** IRS contribution limit resolution, pure: no DB or I/O. */
import type { AccountCategory } from "@/lib/config/account-types";
import {
  getAccountTypeConfig,
  categoriesWithIrsLimit,
  getLimitGroup,
  isPayrollFicaExemptCategory,
} from "@/lib/config/account-types";
import { HSA_FAMILY_COVERAGE } from "@/lib/config/enum-values";
import { requireLimit } from "@/lib/pure/tax/tax-limits";
import { limitAge } from "@/lib/pure/household/age";

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
 * A tax year's limits and the person's age at Dec 31 (catch-up), for FICA-exempt caps.
 * Age null when unknown: the cap then can't be sized, never guessed at age 0.
 */
export function ficaCapContext(
  limits: Record<string, number>,
  dateOfBirth: string | null,
  taxYear: number,
): { limits: Record<string, number>; ageAtYearEnd: number | null } {
  return {
    limits,
    ageAtYearEnd: dateOfBirth === null ? null : limitAge(dateOfBirth, taxYear),
  };
}

/**
 * Yearly cap on payroll contributions that aren't FICA wages (`payrollFicaExempt`, e.g. §125
 * HSA): the IRS limit for coverage and age less employer money. `null` = FICA wages;
 * Infinity when coverage or the limit is unknown. Paycheck and annual tax share this rule.
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
type SiblingContribution = {
  accountType: string;
  annualContribution: number;
  employerMatch: number;
};

/**
 * Compute the total annual contributions from sibling accounts in the same IRS limit group,
 * optionally including employer match when the account type counts it toward the limit.
 */
export function computeSiblingTotal(
  contribs: SiblingContribution[],
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
