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
// Contribution priority order validation (v0.5 expert-review M1)
// ---------------------------------------------------------------------------

/**
 * Severity of a contribution-order warning. UI surfaces these as
 * yellow callouts (not errors) — the user is allowed to override.
 */
export type ContributionOrderWarning = {
  severity: "warn" | "info";
  /** The category that's out of place. */
  category: string;
  /** Position in the user's order (0-indexed). */
  position: number;
  /** Human-readable explanation. */
  message: string;
};

/**
 * Validate a user's accumulation order against the CFP Financial Order of
 * Operations heuristic. Returns warnings (never throws) so the user can
 * override if they have a good reason.
 *
 * The default-good order (per CFP best practice for high-savings households):
 *   1. Employer-match-eligible contributions (401k/403b up to match)
 *   2. HSA (triple tax advantage)
 *   3. Tax-advantaged retirement (Roth IRA, Traditional IRA, 401k beyond match)
 *   4. After-tax / brokerage (no tax advantage)
 *
 * The validator does NOT enforce the exact order. It flags two specific
 * mistakes the audit identified:
 *   - Brokerage / taxable accounts come BEFORE any tax-advantaged account
 *   - HSA appears AFTER any non-HSA tax-advantaged account
 *
 * Both are common foot-guns for users who set up the order without thinking
 * about it. The warnings link to a help doc explaining the rationale.
 */
export function validateContributionOrder(
  order: readonly string[],
): ContributionOrderWarning[] {
  const warnings: ContributionOrderWarning[] = [];
  if (order.length === 0) return warnings;

  // Find the first taxable / overflow position. If a tax-advantaged
  // category comes after it, the user is filling taxable before tax-
  // advantaged — flag it.
  let firstOverflowIndex = -1;
  for (let i = 0; i < order.length; i++) {
    const cat = order[i]!;
    if (!categoriesWithIrsLimit().includes(cat as AccountCategory)) {
      // brokerage or other no-IRS-limit category
      if (firstOverflowIndex === -1) firstOverflowIndex = i;
    }
  }

  if (firstOverflowIndex >= 0) {
    // Any tax-advantaged category appearing AFTER the first overflow position
    // means the user is filling taxable first.
    for (let i = firstOverflowIndex + 1; i < order.length; i++) {
      const cat = order[i]!;
      if (categoriesWithIrsLimit().includes(cat as AccountCategory)) {
        warnings.push({
          severity: "warn",
          category: cat,
          position: i,
          message:
            `${cat} (tax-advantaged) appears after ${order[firstOverflowIndex]} ` +
            `in your contribution order. Most CFP guidance recommends filling ` +
            `tax-advantaged accounts before taxable / brokerage to maximize ` +
            `tax savings. Move ${cat} earlier in the list, or document why ` +
            `your situation differs.`,
        });
      }
    }
  }

  // HSA-specific check: HSA has the best tax treatment (triple-advantaged).
  // If HSA appears after a non-HSA tax-advantaged category, flag it.
  const hsaIndex = order.indexOf("hsa");
  if (hsaIndex > 0) {
    const hasEarlierTaxAdvantaged = order.slice(0, hsaIndex).some(
      (c) =>
        // lint-violation-ok: this validator IS the predicate for HSA-specific
        // ordering, intentionally referring to the category by name
        c !== "hsa" && categoriesWithIrsLimit().includes(c as AccountCategory),
    );
    if (hasEarlierTaxAdvantaged) {
      warnings.push({
        severity: "info",
        category: "hsa",
        position: hsaIndex,
        message:
          "HSA appears after another tax-advantaged account in your order. " +
          "HSAs have the best tax treatment of any account type (triple " +
          "tax-advantaged: pre-tax in, tax-free growth, tax-free out for " +
          "qualified medical expenses). Consider moving HSA earlier.",
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// View-aware contribution metrics
// ---------------------------------------------------------------------------

export type AccountViewMetrics = {
  employeeContrib: number;
  employerMatch: number;
  totalContrib: number;
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

function limitMetrics(
  towardLimit: number,
  limit: number,
  salary: number,
): {
  fundingPct: number;
  fundingMissing: number;
  pctOfSalaryToMax: number | null;
} {
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
  projected: { employeeContrib: number; employerMatch: number };
  blended: { employeeContrib: number; employerMatch: number };
  ytdActual: { contributions: number; employerMatch: number } | null;
  limit: number;
  salary: number;
  matchCountsTowardLimit: boolean;
}): Record<ViewMode, AccountViewMetrics> {
  const {
    projected,
    blended,
    ytdActual,
    limit,
    salary,
    matchCountsTowardLimit,
  } = input;

  function buildView(
    emp: number,
    match: number,
    isYtd: boolean,
  ): AccountViewMetrics {
    const total = emp + match;
    const toward = matchCountsTowardLimit ? total : emp;
    const lm = limitMetrics(toward, limit, salary);
    return {
      employeeContrib: roundToCents(emp),
      employerMatch: roundToCents(match),
      totalContrib: roundToCents(total),
      fundingPct: lm.fundingPct,
      fundingMissing: lm.fundingMissing,
      pctOfSalaryToMax: isYtd ? null : lm.pctOfSalaryToMax,
    };
  }

  const projView = buildView(
    projected.employeeContrib,
    projected.employerMatch,
    false,
  );

  if (!ytdActual) {
    return { projected: projView, blended: projView, ytd: projView };
  }

  const blendedView = buildView(
    blended.employeeContrib,
    blended.employerMatch,
    false,
  );
  const ytdView = buildView(
    ytdActual.contributions,
    ytdActual.employerMatch,
    true,
  );

  return { projected: projView, blended: blendedView, ytd: ytdView };
}

export function computeViewAwareTotals(input: {
  projected: {
    retirementWithoutMatch: number;
    retirementWithMatch: number;
    portfolioWithoutMatch: number;
    portfolioWithMatch: number;
  };
  blended: {
    retirementWithoutMatch: number;
    retirementWithMatch: number;
    portfolioWithoutMatch: number;
    portfolioWithMatch: number;
  };
  ytdActuals: {
    retirement: number;
    portfolio: number;
    retirementMatch: number;
    portfolioMatch: number;
  };
  ytdRatio: number;
  totalCompensation: number;
  blendedTotalCompensation?: number;
}): Record<ViewMode, ViewAwareTotals> {
  const { projected, blended, ytdActuals, ytdRatio, totalCompensation } = input;
  const blendedComp = input.blendedTotalCompensation ?? totalCompensation;

  function buildView(src: typeof projected, comp: number): ViewAwareTotals {
    const totalWithout = src.retirementWithoutMatch + src.portfolioWithoutMatch;
    const totalWith = src.retirementWithMatch + src.portfolioWithMatch;
    return {
      retirementWithoutMatch: src.retirementWithoutMatch,
      retirementWithMatch: src.retirementWithMatch,
      portfolioWithoutMatch: src.portfolioWithoutMatch,
      portfolioWithMatch: src.portfolioWithMatch,
      totalWithoutMatch: totalWithout,
      totalWithMatch: totalWith,
      savingsRateWithMatch: (safeDivide(totalWith, comp) ?? 0) as number,
      savingsRateWithoutMatch: (safeDivide(totalWithout, comp) ?? 0) as number,
    };
  }

  const projView = buildView(projected, totalCompensation);

  const hasActuals =
    ytdActuals.retirement > 0 ||
    ytdActuals.portfolio > 0 ||
    ytdActuals.retirementMatch > 0 ||
    ytdActuals.portfolioMatch > 0;

  if (!hasActuals) {
    return { projected: projView, blended: projView, ytd: projView };
  }

  const blendedView = buildView(blended, blendedComp);

  const ytdRetWithout = roundToCents(ytdActuals.retirement);
  const ytdRetWith = roundToCents(
    ytdActuals.retirement + ytdActuals.retirementMatch,
  );
  const ytdPortWithout = roundToCents(ytdActuals.portfolio);
  const ytdPortWith = roundToCents(
    ytdActuals.portfolio + ytdActuals.portfolioMatch,
  );
  const ytdCompensation = totalCompensation * ytdRatio;
  const ytdView = buildView(
    {
      retirementWithoutMatch: ytdRetWithout,
      retirementWithMatch: ytdRetWith,
      portfolioWithoutMatch: ytdPortWithout,
      portfolioWithMatch: ytdPortWith,
    },
    ytdCompensation > 0 ? ytdCompensation : totalCompensation,
  );

  return { projected: projView, blended: blendedView, ytd: ytdView };
}
