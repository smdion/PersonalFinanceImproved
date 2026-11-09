/**
 * Per projected year, which dollars in each account would draw the early-withdrawal penalty
 * (the penalty-free prefix of its `early-access.ts` slices). Computes the partition only;
 * the router decides policy. Reuses the leaf predicates and `projectRuleOf55` as-is.
 */
import type { AccountCategory } from "@/lib/config/account-types";
import {
  isTaxFreeBucket,
  earlyAccessRuleOf,
  isRetirementMoney,
  getAllCategories,
  getAccountTypeConfig,
} from "@/lib/config/account-types";
import {
  earlyAccessSlices,
  penaltyFreePrefixAmount,
  type EarlyAccessSlice,
} from "@/lib/pure/accounts/early-access";
import { projectRuleOf55 } from "@/lib/pure/accounts/tax-bucket-projection";
import { ageInYear } from "@/lib/utils/date";
import type {
  RuleOf55Status,
  RothBasisMeta,
} from "@/lib/pure/accounts/account-balances.types";
import { PENALTY_FREE_AGE } from "@/lib/constants";
import { roundToCents } from "@/lib/utils/math";
import type { RothBasisState } from "@/lib/pure/accounts/roth-basis-tracking";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import type { EligibilityReason } from "@/lib/config/eligibility-reason";

/** The structural subset of `IndividualAccountInput` this module needs, named locally
 *  so it needn't track that type's unrelated fields. */
export type EligibilityAccountInput = {
  name: string;
  category: AccountCategory;
  taxType: string;
  ownerPersonId?: number;
  ruleOf55?: RuleOf55Status | null;
  rothBasisMeta?: RothBasisMeta | null;
  /** `ownerPersonId`'s birth year, carried directly on the account — see
   *  `IndividualAccountInput.ownerBirthYear`'s docblock for why this isn't
   *  a separate `birthYearByPersonId` lookup. */
  ownerBirthYear?: number;
  /** Passed straight to `projectRuleOf55` (`opts.forceIneligible`); never checked here,
   *  since Rule-of-55-ineligible is not locked (pro_rata is "Rule of 55 OR 59½"). */
  ruleOf55ForceIneligible?: boolean;
  /** The owner's planned retirement year — caps when a still-active job is
   *  assumed to end (see `projectRuleOf55`'s `opts.ownerRetirementYear`). */
  ownerRetirementYear?: number;
  /** Household accepts the penalty on this account (see
   *  `IndividualAccountInput.allowPenalizedWithdrawals`); folded into the "still excluded"
   *  aggregates that `subtractPenaltyExposed` acts on. */
  allowPenalizedWithdrawals?: boolean;
  /** "Retirement" | "Portfolio" | undefined (= Retirement). Portfolio-parented exposure is
   *  left out of the category totals, since `computeNonRetirementExclusion` already excludes
   *  those accounts whole. */
  parentCategory?: string;
};

/** One account's penalty-free and penalty-exposed dollars this projected year;
 *  `penaltyFreeAmount + penaltyExposedAmount` always equals the balance. */
export type AccountEligibility = {
  indKey: string;
  category: AccountCategory;
  taxType: string;
  /** Dollars drawable this year with no penalty: see `penaltyFreePrefixAmount`. */
  penaltyFreeAmount: number;
  /** Balance − penaltyFreeAmount. Every dollar here costs 10% if drawn. */
  penaltyExposedAmount: number;
  /** Which early-access rule decided the verdict above, with the age,
   *  year or basis that drove it. Always present. */
  reason: EligibilityReason;
  /** Start-of-year tracked Roth basis left (contribution + conversion); only with
   *  `indBasis` on a taxFree-bucket account, absent (not zero) when unknown. */
  basisRemaining?: number;
  /** The basis figure rests on a stale or seeded, unreviewed `account_basis` row
   *  (`RothBasisState.stale`/`isSeeded`): it may understate basis, never overstate. */
  basisUncertain?: boolean;
  /** From the input's `allowPenalizedWithdrawals`, always present (default `false`):
   *  an internal record, not a cache-hashed payload field. */
  allowPenalizedWithdrawals: boolean;
};

export type EligibilityRecord = {
  byKey: Map<string, AccountEligibility>;
  /** Sum of every `penaltyExposedAmount`. Zero ⇒ every gate downstream is a
   *  provable no-op — callers use this to skip the exclusion dispatch
   *  entirely rather than running it to a no-op result. */
  totalPenaltyExposed: number;
  penaltyExposedTrad: Record<AccountCategory, number>;
  penaltyExposedRoth: Record<AccountCategory, number>;
  penaltyExposedTotal: Record<AccountCategory, number>;
  /** The same aggregates without accounts that allow penalized withdrawals: what
   *  `subtractPenaltyExposed` excludes from the routable pool. Equal to the above
   *  when no account allows them. */
  penaltyExposedTradStillExcluded: Record<AccountCategory, number>;
  penaltyExposedRothStillExcluded: Record<AccountCategory, number>;
  penaltyExposedTotalStillExcluded: Record<AccountCategory, number>;
  /** Sum of `penaltyExposedTotalStillExcluded` over categories. `routeForMode` gates its
   *  early-out and prices `penaltyAvoidedShortfall` off this, not `totalPenaltyExposed`,
   *  so allowed accounts' dollars aren't blamed for a shortfall. */
  totalPenaltyExposedStillExcluded: number;
  /** Per category with tracked early-access retirement accounts: the most routing may draw
   *  (their penalty-free money plus allowed penalized accounts). Category money no tracked
   *  account holds isn't reachable penalty-free by default. */
  reachableByCategory: Partial<Record<AccountCategory, number>>;
};

function zeroByCategory(): Record<AccountCategory, number> {
  return Object.fromEntries(getAllCategories().map((c) => [c, 0])) as Record<
    AccountCategory,
    number
  >;
}

/** Whether every dollar-bearing slice is penalty-exposed ($0 slices skipped: a $0
 *  "Contribution basis" slice must not unlock a pure-growth Roth IRA). Picks
 *  `eligibilityLocked` and the reason's kind; routing uses `penaltyFreePrefixAmount`. */
function allSlicesLocked(slices: EarlyAccessSlice[]): boolean {
  const dollarBearing = slices.filter((s) => s.amount > 0);
  return dollarBearing.length > 0 && dollarBearing.every((s) => !s.penaltyFree);
}

/**
 * Per-account, per-dollar penalty exposure for one year, from current `indBalance` and each
 * account's owner and "now" Rule of 55. With `indBasis`, Roth basis comes from tracked basis
 * (the same figure the UI shows); without it, from `rothBasisMeta`.
 */
export function computeWithdrawalEligibility(input: {
  year: number;
  indAccounts: EligibilityAccountInput[];
  indBalance: Map<string, number>;
  indKey: IndKeyFn;
  indBasis?: Map<string, RothBasisState>;
}): EligibilityRecord {
  const { year, indAccounts, indBalance, indKey, indBasis } = input;
  const byKey = new Map<string, AccountEligibility>();
  const penaltyExposedTrad = zeroByCategory();
  const penaltyExposedRoth = zeroByCategory();
  const penaltyExposedTotal = zeroByCategory();
  const penaltyExposedTradStillExcluded = zeroByCategory();
  const penaltyExposedRothStillExcluded = zeroByCategory();
  const penaltyExposedTotalStillExcluded = zeroByCategory();
  let totalPenaltyExposed = 0;
  let totalPenaltyExposedStillExcluded = 0;
  const reachableByCategory: Partial<Record<AccountCategory, number>> = {};

  for (const ia of indAccounts) {
    const key = indKey(ia);
    const balance = indBalance.get(key) ?? 0;
    const birthYear = ia.ownerBirthYear;

    let reason: EligibilityReason = { kind: "no_owner" };
    let basisRemaining: number | undefined;
    let basisUncertain: boolean | undefined;
    let penaltyFreeAmount = balance; // default: joint/no-owner accounts are always fully penalty-free
    const trackedBasis = indBasis?.get(key);
    const contributionBasis =
      trackedBasis?.contributionBasis ??
      ia.rothBasisMeta?.contributionBasis ??
      0;
    const conversionBasis =
      trackedBasis?.conversionBasis ?? ia.rothBasisMeta?.conversionBasis ?? 0;
    const latestConversionYear =
      trackedBasis?.latestConversionYear ??
      ia.rothBasisMeta?.latestConversionYear ??
      null;
    // No resolvable owner (joint, or no birth year): no age to gate on, so no
    // early-access exposure; same as computeTaxBucketAnalysis.
    if (birthYear != null) {
      const currentAge = ageInYear(birthYear, year);
      const rule = earlyAccessRuleOf(ia.category);
      const isRoth = isTaxFreeBucket(ia.taxType);
      // Rule of 55 projected to `year` with the resolver the Tax Buckets
      // "at retirement" view uses.
      const projected =
        rule === "employer_plan"
          ? projectRuleOf55(ia.ruleOf55 ?? null, year, birthYear, {
              forceIneligible: ia.ruleOf55ForceIneligible,
              ownerRetirementYear: ia.ownerRetirementYear,
            })
          : null;
      const ruleOf55Met = projected?.eligible ?? false;
      const slices = earlyAccessSlices(rule, {
        balance,
        currentAge,
        currentYear: year,
        isRoth,
        ruleOf55Met,
        contributionBasis,
        conversionBasis,
        latestConversionYear,
      });
      if (slices) penaltyFreeAmount = penaltyFreePrefixAmount(slices);
      if (isRoth && (rule === "ira_59_half" || rule === "employer_plan")) {
        basisRemaining = roundToCents(contributionBasis + conversionBasis);
        basisUncertain = trackedBasis?.stale || trackedBasis?.isSeeded;
      }
      if (rule === "ira_59_half" && slices) {
        // 59½, or a Roth IRA's own ordering: contribution basis is always
        // penalty-free regardless of age.
        const locked = allSlicesLocked(slices);
        const growthExposed = roundToCents(
          Math.max(0, balance - penaltyFreeAmount),
        );
        if (currentAge >= PENALTY_FREE_AGE) {
          reason = { kind: "age_reached", gate: "age_59_half" };
        } else if (isRoth && !locked && growthExposed <= 0.005) {
          reason = { kind: "basis_remaining", basis: basisRemaining ?? 0 };
        } else if (isRoth && !locked) {
          reason = {
            kind: "basis_partial",
            basis: basisRemaining ?? 0,
            growthLocked: growthExposed,
          };
        } else if (isRoth) {
          reason = { kind: "no_basis" };
        } else {
          reason = { kind: "locked", gate: "age_59_half", currentAge };
        }
      } else if (rule === "employer_plan") {
        if (ruleOf55Met) {
          reason =
            projected?.separationYear != null
              ? { kind: "rule_of_55", separationYear: projected.separationYear }
              : { kind: "rule_of_55" };
        } else if (currentAge >= PENALTY_FREE_AGE) {
          reason = { kind: "age_reached", gate: "age_59_half" };
        } else if (ia.ruleOf55ForceIneligible) {
          reason = {
            kind: "locked",
            gate: "rule_of_55_unavailable",
            currentAge,
          };
        } else {
          reason = { kind: "locked", gate: "rule_of_55_or_age", currentAge };
        }
      } else if (rule === "hsa_non_medical" && slices) {
        reason = allSlicesLocked(slices)
          ? { kind: "locked", gate: "hsa_age_65", currentAge }
          : { kind: "age_reached", gate: "hsa_age_65" };
      } else {
        // Rule "none" (brokerage): no age or employer gate, so the whole
        // balance stays penalty-free.
        reason = { kind: "always_available" };
      }
    }

    const penaltyExposedAmount = roundToCents(
      Math.max(0, balance - penaltyFreeAmount),
    );
    byKey.set(key, {
      indKey: key,
      category: ia.category,
      taxType: ia.taxType,
      penaltyFreeAmount,
      penaltyExposedAmount,
      reason,
      ...(basisRemaining != null ? { basisRemaining } : {}),
      ...(basisUncertain ? { basisUncertain } : {}),
      allowPenalizedWithdrawals: ia.allowPenalizedWithdrawals ?? false,
    });

    // A Portfolio-parented account stays out of these aggregates:
    // computeNonRetirementExclusion excludes it wholesale, and counting it
    // here too would remove its dollars twice. Its `byKey` entry stays.
    if (
      isRetirementMoney(ia.parentCategory) &&
      getAccountTypeConfig(ia.category).balanceStructure !== "basis_tracking"
    )
      reachableByCategory[ia.category] = roundToCents(
        (reachableByCategory[ia.category] ?? 0) +
          penaltyFreeAmount +
          (ia.allowPenalizedWithdrawals ? penaltyExposedAmount : 0),
      );
    if (penaltyExposedAmount > 0 && isRetirementMoney(ia.parentCategory)) {
      totalPenaltyExposed += penaltyExposedAmount;
      penaltyExposedTotal[ia.category] += penaltyExposedAmount;
      if (isTaxFreeBucket(ia.taxType)) {
        penaltyExposedRoth[ia.category] += penaltyExposedAmount;
      } else {
        penaltyExposedTrad[ia.category] += penaltyExposedAmount;
      }
      if (!ia.allowPenalizedWithdrawals) {
        totalPenaltyExposedStillExcluded += penaltyExposedAmount;
        penaltyExposedTotalStillExcluded[ia.category] += penaltyExposedAmount;
        if (isTaxFreeBucket(ia.taxType)) {
          penaltyExposedRothStillExcluded[ia.category] += penaltyExposedAmount;
        } else {
          penaltyExposedTradStillExcluded[ia.category] += penaltyExposedAmount;
        }
      }
    }
  }

  return {
    byKey,
    totalPenaltyExposed,
    penaltyExposedTrad,
    penaltyExposedRoth,
    penaltyExposedTotal,
    penaltyExposedTradStillExcluded,
    penaltyExposedRothStillExcluded,
    penaltyExposedTotalStillExcluded,
    totalPenaltyExposedStillExcluded,
    reachableByCategory,
  };
}

/**
 * Per-category Portfolio-parented balances, excluded from retirement routing wholesale (no
 * age gate or opt-out). Never overlaps the penalty partition, so `subtractExcluded` sums both;
 * the accounts still grow and take contributions.
 */
export type NonRetirementExclusion = {
  total: Record<AccountCategory, number>;
  trad: Record<AccountCategory, number>;
  roth: Record<AccountCategory, number>;
  grandTotal: number;
};

export function computeNonRetirementExclusion(
  indAccounts: {
    name: string;
    category: AccountCategory;
    taxType: string;
    ownerPersonId?: number;
    parentCategory?: string;
  }[],
  indBalance: Map<string, number>,
  indKey: IndKeyFn,
): NonRetirementExclusion {
  const total = zeroByCategory();
  const trad = zeroByCategory();
  const roth = zeroByCategory();
  let grandTotal = 0;

  for (const ia of indAccounts) {
    if (isRetirementMoney(ia.parentCategory)) continue;
    const balance = Math.max(0, indBalance.get(indKey(ia)) ?? 0);
    if (balance <= 0) continue;
    total[ia.category] += balance;
    grandTotal += balance;
    if (
      getAccountTypeConfig(ia.category).balanceStructure === "roth_traditional"
    ) {
      if (isTaxFreeBucket(ia.taxType)) roth[ia.category] += balance;
      else trad[ia.category] += balance;
    }
  }

  const roundCategoryMap = (
    m: Record<AccountCategory, number>,
  ): Record<AccountCategory, number> =>
    Object.fromEntries(
      Object.entries(m).map(([k, v]) => [k, roundToCents(v)]),
    ) as Record<AccountCategory, number>;

  return {
    total: roundCategoryMap(total),
    trad: roundCategoryMap(trad),
    roth: roundCategoryMap(roth),
    grandTotal: roundToCents(grandTotal),
  };
}
