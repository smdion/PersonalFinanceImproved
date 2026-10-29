/**
 * Simple tax mode (simulation only, cFIREsim-comparable): retirement money
 * as one tax-free pot. Retirement answers count retirement money only, so
 * Simple is the retirement side of the household collapsed — never Portfolio
 * balances, Portfolio contributions or match, brokerage goals, or injections
 * that land in Portfolio money in the full (Advanced) projection. Its total
 * then equals its retirement balance by construction.
 *
 * Built from the Advanced input while it still has its individual accounts,
 * so lump sums are judged by the same target rule the engine uses
 * (`resolveLumpSumTarget`).
 */
import {
  getAllCategories,
  isOverflowTarget,
  isRetirementMoney,
  zeroBalance,
} from "../config/account-types";
import { roundToCents } from "../utils/math";
import { resolveLumpSumTarget } from "./engine/projection-year-handlers/lump-sum";
import type {
  AccountBalance,
  AccountCategory,
  AccumulationDefaults,
  IndividualAccountInput,
  LumpSum,
  ProjectionInput,
  RetirementContribSlice,
  TaxBuckets,
} from "./types";
export type SimpleTaxModeParts = {
  /** Starting balances of retirement money (by tax type). */
  retirementBuckets: TaxBuckets;
  /** The default contribution profile's retirement slice, plus the
   *  routing splits recomputed from it. */
  defaults: RetirementContribSlice & {
    accountSplits: AccumulationDefaults["accountSplits"];
    taxSplits: AccumulationDefaults["taxSplits"];
  };
};

/** Lump sums that stay retirement money: the account they'd land in is
 *  retirement money; with no individual account to judge by, unless they
 *  are marked as Portfolio savings. */
function withRetirementLumpSums<T extends { lumpSums?: LumpSum[] }>(
  override: T,
  indAccts: readonly IndividualAccountInput[],
): T {
  if (!override.lumpSums) return override;
  return {
    ...override,
    lumpSums: override.lumpSums.filter((ls) => {
      const target = resolveLumpSumTarget(ls, indAccts);
      return target
        ? isRetirementMoney(target.parentCategory)
        : isRetirementMoney(ls.targetParentCategory);
    }),
  };
}

export function toSimpleTaxMode(
  input: ProjectionInput,
  parts: SimpleTaxModeParts,
): ProjectionInput {
  const indAccts = input.individualAccounts ?? [];
  const b = parts.retirementBuckets;
  const total = roundToCents(b.preTax + b.taxFree + b.hsa + b.afterTax);
  const isRetirementSpec = (s: { parentCategory?: string }) =>
    isRetirementMoney(s.parentCategory);
  // The ramp is Portfolio savings whenever there's a real Portfolio
  // brokerage to hold it (the engine's rule); otherwise retirement money.
  const hasPortfolioBrokerage = indAccts.some(
    (ia) =>
      isOverflowTarget(ia.category) &&
      !ia.projectedOnly &&
      !isRetirementMoney(ia.parentCategory),
  );

  return {
    ...input,
    // One tax-free pot: every retirement dollar in the brokerage bucket.
    startingBalances: {
      preTax: 0,
      taxFree: 0,
      hsa: 0,
      afterTax: total,
      afterTaxBasis: total,
    },
    startingAccountBalances: Object.fromEntries(
      getAllCategories().map((cat) => [
        cat,
        isOverflowTarget(cat)
          ? {
              structure: "basis_tracking" as const,
              balance: total,
              basis: total,
            }
          : zeroBalance(cat),
      ]),
    ) as Record<AccountCategory, AccountBalance>,
    accumulationDefaults: {
      ...input.accumulationDefaults,
      accountSplits: parts.defaults.accountSplits,
      taxSplits: parts.defaults.taxSplits,
    },
    decumulationDefaults: {
      ...input.decumulationDefaults,
      distributionTaxRates: {
        ...input.decumulationDefaults.distributionTaxRates,
        traditionalFallbackRate: 0,
        roth: 0,
        hsa: 0,
        brokerage: 0,
        grossUpForTaxes: false,
      },
    },
    contributionSpecs: input.contributionSpecs?.filter(isRetirementSpec),
    baseYearContributions: parts.defaults.baseYearContributions,
    baseYearEmployerMatch: parts.defaults.baseYearEmployerMatch,
    employerMatchRateByCategory: parts.defaults.employerMatchRateByCategory,
    profileSwitches: input.profileSwitches?.map((sw) => {
      // Without its slice a switch would carry all-accounts amounts into
      // Simple — fail loudly rather than simulate Portfolio money.
      if (!sw.retirementOnly)
        throw new Error(
          `Simple tax mode: the ${sw.year} contribution profile switch has no retirement-only amounts`,
        );
      return {
        ...sw,
        contributionSpecs: sw.contributionSpecs.filter(isRetirementSpec),
        ...sw.retirementOnly,
      };
    }),
    // Tax-free means no table-based tax either: with a filing status the
    // engine taxes the pot's gains on the capital-gains brackets (not the
    // 0 brokerage rate above) and adds NIIT; IRMAA and the ACA check read
    // the same gains as MAGI. None of them belong in one tax-free pot.
    filingStatus: undefined,
    enableIrmaaAwareness: false,
    irmaaAwareRothConversions: false,
    enableAcaAwareness: false,
    brokerageGoals: [],
    brokerageContributionRamp: hasPortfolioBrokerage
      ? 0
      : input.brokerageContributionRamp,
    accumulationOverrides: input.accumulationOverrides.map((o) =>
      withRetirementLumpSums(o, indAccts),
    ),
    decumulationOverrides: input.decumulationOverrides.map((o) =>
      withRetirementLumpSums(o, indAccts),
    ),
    // Simple discards account identity: the one pot is the only
    // representation (per-account tracking would route withdrawals against
    // real accounts the aggregate no longer has).
    individualAccounts: [],
  };
}
