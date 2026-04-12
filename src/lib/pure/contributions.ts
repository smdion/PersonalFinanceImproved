/**
 * Pure business logic for IRS contribution limit resolution and view-aware metrics.
 * Extracted from contribution router — no DB or I/O dependency.
 */
import type { AccountCategory } from "@/lib/config/account-types";
import {
  getAccountTypeConfig,
  categoriesWithIrsLimit,
  getLimitGroup,
} from "@/lib/config/account-types";
import { requireLimit } from "@/server/helpers/settings";
import { safeDivide, roundToCents } from "@/lib/utils/math";
import type { ViewMode } from "@/lib/calculators/types";

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

// ---------------------------------------------------------------------------
// View-aware contribution metrics
// ---------------------------------------------------------------------------

export type AccountViewMetrics = {
  fundingPct: number;
  fundingMissing: number;
  pctOfSalaryToMax: number | null;
};

export type ViewAwareTotals = {
  retirementWithoutMatch: number;
  retirementWithMatch: number;
  portfolioWithoutMatch: number;
  portfolioWithMatch: number;
  totalWithoutMatch: number;
  totalWithMatch: number;
  savingsRateWithMatch: number;
  savingsRateWithoutMatch: number;
};

function accountMetrics(
  towardLimit: number,
  limit: number,
  salary: number,
): AccountViewMetrics {
  if (limit <= 0)
    return { fundingPct: 0, fundingMissing: 0, pctOfSalaryToMax: null };
  const missing = Math.max(0, limit - towardLimit);
  const pctOfSalaryToMax =
    salary > 0 && missing > 0
      ? roundToCents((missing / salary) * 100 * 100) / 100
      : salary > 0
        ? 0
        : null;
  return {
    fundingPct: towardLimit / limit,
    fundingMissing: missing,
    pctOfSalaryToMax,
  };
}

export function computeViewAwareAccountMetrics(input: {
  towardLimit: number;
  limit: number;
  salary: number;
  ytdActual: { contributions: number; employerMatch: number } | null;
  ytdRatio: number;
  matchCountsTowardLimit: boolean;
}): Record<ViewMode, AccountViewMetrics> {
  const {
    towardLimit,
    limit,
    salary,
    ytdActual,
    ytdRatio,
    matchCountsTowardLimit,
  } = input;
  const projected = accountMetrics(towardLimit, limit, salary);

  if (!ytdActual || ytdRatio <= 0) {
    return { projected, blended: projected, ytd: projected };
  }

  const ytdToward =
    ytdActual.contributions +
    (matchCountsTowardLimit ? ytdActual.employerMatch : 0);

  const remaining = 1 - ytdRatio;
  const blendedToward = ytdToward + towardLimit * remaining;
  const blended = accountMetrics(blendedToward, limit, salary);

  const ytd = accountMetrics(ytdToward, limit, salary);
  // pctOfSalaryToMax is forward-looking — not meaningful for historical YTD
  ytd.pctOfSalaryToMax = null;

  return { projected, blended, ytd };
}

export function computeViewAwareTotals(input: {
  projected: {
    retirementWithoutMatch: number;
    retirementWithMatch: number;
    portfolioWithoutMatch: number;
    portfolioWithMatch: number;
  };
  ytdActuals: { retirement: number; portfolio: number; match: number };
  ytdRatio: number;
  totalCompensation: number;
}): Record<ViewMode, ViewAwareTotals> {
  const { projected, ytdActuals, ytdRatio, totalCompensation } = input;
  const projTotalWithout =
    projected.retirementWithoutMatch + projected.portfolioWithoutMatch;
  const projTotalWith =
    projected.retirementWithMatch + projected.portfolioWithMatch;

  const projView: ViewAwareTotals = {
    retirementWithoutMatch: projected.retirementWithoutMatch,
    retirementWithMatch: projected.retirementWithMatch,
    portfolioWithoutMatch: projected.portfolioWithoutMatch,
    portfolioWithMatch: projected.portfolioWithMatch,
    totalWithoutMatch: projTotalWithout,
    totalWithMatch: projTotalWith,
    savingsRateWithMatch: (safeDivide(projTotalWith, totalCompensation) ??
      0) as number,
    savingsRateWithoutMatch: (safeDivide(projTotalWithout, totalCompensation) ??
      0) as number,
  };

  const hasActuals =
    ytdActuals.retirement > 0 ||
    ytdActuals.portfolio > 0 ||
    ytdActuals.match > 0;

  if (!hasActuals || ytdRatio <= 0) {
    return { projected: projView, blended: projView, ytd: projView };
  }

  const remaining = 1 - ytdRatio;

  const blendedRetWithout = roundToCents(
    ytdActuals.retirement + projected.retirementWithoutMatch * remaining,
  );
  const blendedRetWith = roundToCents(
    ytdActuals.retirement +
      ytdActuals.match +
      projected.retirementWithMatch * remaining,
  );
  const blendedPortWithout = roundToCents(
    ytdActuals.portfolio + projected.portfolioWithoutMatch * remaining,
  );
  const blendedPortWith = roundToCents(
    ytdActuals.portfolio + projected.portfolioWithMatch * remaining,
  );
  const blendedTotalWithout = blendedRetWithout + blendedPortWithout;
  const blendedTotalWith = blendedRetWith + blendedPortWith;

  const blendedView: ViewAwareTotals = {
    retirementWithoutMatch: blendedRetWithout,
    retirementWithMatch: blendedRetWith,
    portfolioWithoutMatch: blendedPortWithout,
    portfolioWithMatch: blendedPortWith,
    totalWithoutMatch: blendedTotalWithout,
    totalWithMatch: blendedTotalWith,
    savingsRateWithMatch: (safeDivide(blendedTotalWith, totalCompensation) ??
      0) as number,
    savingsRateWithoutMatch: (safeDivide(
      blendedTotalWithout,
      totalCompensation,
    ) ?? 0) as number,
  };

  const ytdRetWithout = roundToCents(ytdActuals.retirement);
  const ytdRetWith = roundToCents(ytdActuals.retirement + ytdActuals.match);
  const ytdPortWithout = roundToCents(ytdActuals.portfolio);
  const ytdPortWith = roundToCents(ytdActuals.portfolio);
  const ytdTotalWithout = ytdRetWithout + ytdPortWithout;
  const ytdTotalWith = ytdRetWith + ytdPortWith;
  const ytdCompensation = totalCompensation * ytdRatio;

  const ytdView: ViewAwareTotals = {
    retirementWithoutMatch: ytdRetWithout,
    retirementWithMatch: ytdRetWith,
    portfolioWithoutMatch: ytdPortWithout,
    portfolioWithMatch: ytdPortWith,
    totalWithoutMatch: ytdTotalWithout,
    totalWithMatch: ytdTotalWith,
    savingsRateWithMatch: (safeDivide(ytdTotalWith, ytdCompensation) ??
      0) as number,
    savingsRateWithoutMatch: (safeDivide(ytdTotalWithout, ytdCompensation) ??
      0) as number,
  };

  return { projected: projView, blended: blendedView, ytd: ytdView };
}
