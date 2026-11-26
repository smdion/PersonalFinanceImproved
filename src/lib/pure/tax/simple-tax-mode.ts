/**
 * Simple tax mode (simulation only, cFIREsim-comparable): retirement money as one tax-free pot,
 * with nothing that lands in Portfolio money in the Advanced projection. Built from the Advanced
 * input while it has its accounts, so lump sums follow the run's resolver (`resolveLumpSums`).
 */
import {
  buildCategoryRecord,
  isOverflowTarget,
  isRetirementMoney,
  zeroBalance,
} from "../../config/account-types";
import { PERF_CATEGORY_RETIREMENT } from "../../config/display-labels";
import { roundToCents } from "../../utils/math";
import { rampIsPortfolioSaving } from "../accounts/brokerage-ramp";
import {
  lumpSumParts,
  resolveLumpSums,
  runLumpSums,
  syntheticOpeningParts,
} from "../engine";
import { isHeldPart } from "../accounts/account-part";
import type {
  AccumulationDefaults,
  ContributionSpec,
  ProjectionInput,
  RetirementContributionSlice,
} from "../engine/types";
import type { TaxBuckets } from "../accounts/account-balances.types";
import type { LumpSum } from "../engine/types";
import type { ResolvedLumpSums } from "../engine";
export type SimpleTaxModeParts = {
  /** Starting balances of retirement money (by tax type). */
  retirementBuckets: TaxBuckets;
  /** The default contribution profile's retirement slice, plus the
   *  routing splits recomputed from it. */
  defaults: RetirementContributionSlice & {
    accountSplits: AccumulationDefaults["accountSplits"];
    taxSplits: AccumulationDefaults["taxSplits"];
  };
};

/** A spec in Simple pays the synthetic pot: Simple discards account
 *  identity, for specs as for parts. */
function onThePot(spec: ContributionSpec): ContributionSpec {
  return { ...spec, account: { kind: "synthetic" } };
}

/** Lump sums that stay retirement money: the part they'd land in, as the
 *  run resolves it, is retirement money; with no account to judge by,
 *  unless they are marked as Portfolio savings. */
function withRetirementLumpSums<T extends { lumpSums?: LumpSum[] }>(
  override: T,
  resolved: ResolvedLumpSums,
): T {
  if (!override.lumpSums) return override;
  return {
    ...override,
    lumpSums: override.lumpSums.filter((ls) => {
      const [run] = runLumpSums([ls], resolved.targets);
      const [part] = lumpSumParts(run!, resolved.parts);
      return part
        ? isRetirementMoney(part.parentCategory)
        : isRetirementMoney(ls.targetParentCategory);
    }),
  };
}

export function toSimpleTaxMode(
  input: ProjectionInput,
  parts: SimpleTaxModeParts,
): ProjectionInput {
  // The real accounts: a household with none passes synthetic parts.
  const indAccounts = input.individualAccounts.filter(isHeldPart);
  const lumpSums = resolveLumpSums(input);
  const b = parts.retirementBuckets;
  const total = roundToCents(b.preTax + b.taxFree + b.hsa + b.afterTax);
  const isRetirementSpec = (s: { parentCategory?: string }) =>
    isRetirementMoney(s.parentCategory);
  // The ramp is Portfolio savings when it lands in a Portfolio brokerage
  // (the engine's rule); otherwise retirement money.
  const hasPortfolioBrokerage = rampIsPortfolioSaving(indAccounts);

  return {
    ...input,
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
    contributionSpecs: input.contributionSpecs
      ?.filter(isRetirementSpec)
      .map(onThePot),
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
        contributionSpecs: sw.contributionSpecs
          .filter(isRetirementSpec)
          .map(onThePot),
        ...sw.retirementOnly,
      };
    }),
    // Tax-free means no table-based tax either: no capital-gains brackets, NIIT, IRMAA or ACA
    // MAGI on the pot's gains.
    filingStatus: undefined,
    enableIrmaaAwareness: false,
    irmaaAwareRothConversions: false,
    enableAcaAwareness: false,
    brokerageGoals: [],
    brokerageContributionRamp: hasPortfolioBrokerage
      ? 0
      : input.brokerageContributionRamp,
    accumulationOverrides: input.accumulationOverrides.map((o) =>
      withRetirementLumpSums(o, lumpSums),
    ),
    decumulationOverrides: input.decumulationOverrides.map((o) =>
      withRetirementLumpSums(o, lumpSums),
    ),
    // Simple discards account identity: one tax-free pot, every retirement
    // dollar in the brokerage category, held by synthetic parts (the
    // household's rules, no per-account rows).
    individualAccounts: syntheticOpeningParts(
      buildCategoryRecord((cat) =>
        isOverflowTarget(cat)
          ? {
              structure: "basis_tracking" as const,
              balance: total,
              basis: total,
            }
          : zeroBalance(cat),
      ),
      () => PERF_CATEGORY_RETIREMENT,
    ),
  };
}
