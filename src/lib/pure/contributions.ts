/**
 * Pure business logic for IRS contribution limit resolution.
 * Extracted from contribution router — no DB or I/O dependency.
 */
import type { AccountCategory } from "@/lib/config/account-types";
import {
  getAccountTypeConfig,
  categoriesWithIrsLimit,
  getLimitGroup,
} from "@/lib/config/account-types";
import { requireLimit } from "@/server/helpers/settings";

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

  let baseKey = keys.base;
  if (keys.coverageVariant && hsaCoverageType === "family")
    baseKey = keys.coverageVariant;

  let limit = requireLimit(limitsRecord, baseKey);

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

  let baseKey = keys.base;
  if (keys.coverageVariant && hsaCoverageType === "family")
    baseKey = keys.coverageVariant;

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
export type SiblingContrib = {
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
