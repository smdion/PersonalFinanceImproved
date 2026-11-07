/**
 * Withdrawal-ordering penalty exposure — the
 * per-projected-year computation that tells the decumulation engine's
 * withdrawal routing exactly which dollars, in each individual account,
 * would incur the 10% early-withdrawal penalty this year (Rule of 55, 59½,
 * HSA 65, Roth ordering) — the same rules the Tax Buckets analysis tool
 * displays.
 *
 * Key decisions this module implements:
 *
 * - A penalty-exposed dollar is not reachable-but-disfavored: the router
 *   (see `withdrawal-routing/`) excludes it by default
 *   (`config.avoidPenalizedWithdrawals`, default true). This module only
 *   computes the per-dollar partition; it does not itself gate anything —
 *   the router decides what to do with the partition.
 * - Per-dollar partition, one rule for every account type: penalty-free
 *   capacity is the LEADING, CONTIGUOUSLY
 *   penalty-free PREFIX of an account's `early-access.ts` slices, in the
 *   order that account's own ordering rules release them — not the sum of
 *   every penalty-free slice regardless of position. See
 *   `penaltyFreePrefixAmount`'s docblock.
 * - `locked` (whole-account) and `penalty-exposed` (per dollar) are NOT
 *   parallel ideas — every dollar in a "locked" account is penalty-exposed,
 *   but a partially penalty-exposed account (e.g. a pre-59½ Roth IRA with
 *   contribution basis) isn't "locked". `draw.eligibilityLocked` means
 *   "every dollar in this account is penalty-exposed", and `draw.reason` is
 *   a structured `EligibilityReason` (worded by `describeEligibility`);
 *   `penaltyExposedAmount` is the number that matters for routing.
 *
 * Leaf predicates (`early-access.ts`) and `projectRuleOf55`
 * (`tax-bucket-projection.ts`) are called verbatim — never reimplemented
 * (RULES.md § Single Computation Path).
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
} from "@/lib/pure/accounts/tax-bucket-analysis";
import { PENALTY_FREE_AGE } from "@/lib/constants";
import { roundToCents } from "@/lib/utils/math";
import type { RothBasisState } from "@/lib/pure/accounts/roth-basis-tracking";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import type { EligibilityReason } from "@/lib/config/eligibility-reason";

/** The account shape this module needs — a structural subset of
 *  `IndividualAccountInput` (`lib/pure/accounts/account-balances.types.ts`), named
 *  locally rather than importing that type so this module (and the engine,
 *  its only intended caller) don't have to agree on every unrelated field
 *  `IndividualAccountInput` carries. */
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
  /** Rule of 55 forecasting override — see
   *  `projectRuleOf55`'s `opts.forceIneligible` docblock
   *  (`tax-bucket-projection.ts`) for the full contract. Passed straight
   *  through to that function; this module never inspects or short-circuits
   *  on it directly: Rule-of-55-ineligible is not the same as locked (the
   *  pro_rata branch below is "Rule of 55 OR 59½"). */
  ruleOf55ForceIneligible?: boolean;
  /** The owner's planned retirement year — caps when a still-active job is
   *  assumed to end (see `projectRuleOf55`'s `opts.ownerRetirementYear`). */
  ownerRetirementYear?: number;
  /** Household is fine paying the penalty on THIS account if it avoids an
   *  otherwise-real shortfall. Only ever `true` when set — see
   *  `IndividualAccountInput.allowPenalizedWithdrawals`'s docblock
   *  (`lib/pure/accounts/account-balances.types.ts`) for the full contract. This
   *  module doesn't gate on it directly (it computes the partition; the
   *  router decides policy) —
   *  it just carries the flag onto `AccountEligibility` and folds it into
   *  the record's "still excluded" aggregates below, which
   *  `subtractPenaltyExposed` (`engine/balance-utils.ts`) is the one that
   *  actually acts on. */
  allowPenalizedWithdrawals?: boolean;
  /** "Retirement" | "Portfolio" | undefined (undefined means Retirement,
   *  same convention as `build-engine-payload.ts`'s
   *  `a.parentCategory ?? "Retirement"`). Not used by this module's own
   *  age/penalty logic — carried through so the aggregation step below can
   *  exclude a Portfolio-parented account's penalty exposure from the
   *  category-level totals (see `computeNonRetirementExclusion`,
   *  which handles Portfolio-parented accounts as a wholly separate,
   *  unconditional exclusion; this field's only job here is to keep the
   *  two exclusion sources from double-counting the same dollar). */
  parentCategory?: string;
};

/** Dollars of one individual account that are penalty-free this projected
 *  year, and dollars that are not (see module docblock).
 *  `penaltyFreeAmount + penaltyExposedAmount ===`
 *  the account's balance, always. */
export type AccountEligibility = {
  indKey: string;
  category: AccountCategory;
  taxType: string;
  /** Dollars drawable this year with NO 10% penalty — the leading,
   *  contiguously penalty-free prefix of this account's early-access
   *  slices, in their own ordering-rule release order. See
   *  `penaltyFreePrefixAmount`. */
  penaltyFreeAmount: number;
  /** Balance − penaltyFreeAmount. Every dollar here costs 10% if drawn. */
  penaltyExposedAmount: number;
  /** Which early-access rule decided the verdict above, with the age,
   *  year or basis that drove it. Always present. */
  reason: EligibilityReason;
  /** Start-of-year tracked Roth basis remaining (contribution + conversion
   *  combined) — present only when `indBasis` was supplied and this is a
   *  taxFree-bucket account. Absent (not zero) when tracked basis isn't
   *  available, so a caller never mistakes "we don't know" for "$0 left". */
  basisRemaining?: number;
  /** True when the tracked-basis figure rests on a stale (pre-projection)
   *  or auto-seeded, never-reviewed `account_basis` row — see
   *  `RothBasisState.stale`/`isSeeded`. The figure may understate real
   *  basis; never overstates it. */
  basisUncertain?: boolean;
  /** Copied straight from `EligibilityAccountInput.allowPenalizedWithdrawals`
   *  — always present (defaults `false`), unlike the input's own
   *  omit-when-false convention, since this is an internal record read by
   *  the engine rather than a cache-hashed payload field. */
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
  /** Same three aggregates, but excluding any account with
   *  `allowPenalizedWithdrawals: true` — the narrower total that
   *  `subtractPenaltyExposed` actually excludes from the routable pool, so
   *  an allowed account's exposed dollars stay reachable while every other
   *  account's stay excluded. Identical to the aggregates above whenever no
   *  account has the override set (the default), by construction. */
  penaltyExposedTradStillExcluded: Record<AccountCategory, number>;
  penaltyExposedRothStillExcluded: Record<AccountCategory, number>;
  penaltyExposedTotalStillExcluded: Record<AccountCategory, number>;
  /** Scalar sum of `penaltyExposedTotalStillExcluded` across every category
   *  — the counterpart to `totalPenaltyExposed`. `routeForMode` MUST
   *  gate its early-out and price `penaltyAvoidedShortfall` off THIS value,
   *  not `totalPenaltyExposed`: once any account opts in, the two diverge,
   *  and using the blind total would attribute a real household shortfall
   *  to "penalty avoidance" for dollars that were never excluded at all. */
  totalPenaltyExposedStillExcluded: number;
  /** Per category with tracked retirement accounts under an early-access
   *  rule (not brokerage): the most routing may draw from it — those
   *  accounts' penalty-free money plus any account allowed a penalized
   *  draw. Money in the category no tracked account holds (e.g. a Roth
   *  401(k) contribution with no Roth 401(k) account yet) isn't reachable
   *  without penalty by default; uncapped, it was drawn as if it were. */
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
 * Computes per-account, per-dollar penalty exposure for one projected year.
 *
 * `indBal` supplies each account's *current* projected balance (not its
 * `startingBalance` — that's an accumulation-phase input, stale by the time
 * decumulation runs). Each account's own `ownerBirthYear` and `ruleOf55`
 * ("now" resolution, threaded by `engine-payload/individual-accounts.ts`) are
 * external inputs; every eligibility question is re-derived from them
 * fresh for `year` via the same leaf predicates `early-access.ts` and the
 * Tax Buckets tool already use.
 *
 * `indBasis` (tracked Roth basis follow-up, optional): when supplied,
 * Roth basis figures come from `indBasis.get(key)` (a running, per-year
 * tracked balance — see `@/lib/pure/accounts/roth-basis-tracking`) instead of each
 * account's static `ia.rothBasisMeta` snapshot. When omitted, behavior is
 * byte-identical to before tracked basis existed — this keeps every
 * non-engine caller and existing test unchanged. The gate and the UI
 * number MUST read the same figure (reading the
 * snapshot for the gate while showing tracked basis in the UI would be
 * two numbers for one quantity, the exact Single Computation Path failure
 * this avoids).
 */
export function computeWithdrawalEligibility(input: {
  year: number;
  indAccts: EligibilityAccountInput[];
  indBal: Map<string, number>;
  indKey: IndKeyFn;
  indBasis?: Map<string, RothBasisState>;
}): EligibilityRecord {
  const { year, indAccts, indBal, indKey, indBasis } = input;
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

  for (const ia of indAccts) {
    const key = indKey(ia);
    const balance = indBal.get(key) ?? 0;
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
    // No resolvable owner (joint account, or an owner with no birth-year
    // record) — no age to gate on, so nothing here can be penalty-exposed
    // by an early-access rule. Matches computeTaxBucketAnalysis's identical
    // joint-account handling.
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
 * Per-category totals of Portfolio-parented account balances. A
 * Portfolio-parented account (e.g. a taxable brokerage the household
 * doesn't consider part of the retirement plan) is excluded from
 * retirement withdrawal routing WHOLESALE and unconditionally — no age
 * gate, no penalty, no opt-out lever. This is a fully separate exclusion
 * from `computeWithdrawalEligibility`'s penalty-exposure partition (which
 * explicitly does NOT count a Portfolio-parented account's exposure — see
 * that function's `isRetirementParent` gate — so the two sources never
 * overlap on the same dollar and can be summed together safely by
 * `subtractExcluded`, `balance-utils.ts`).
 *
 * Portfolio-parented accounts are NOT removed from `indAccts`/`indBal`
 * themselves — they still receive contributions and growth normally; only
 * the routing-time VIEW computed here excludes their balance. Mirrors
 * `computeWithdrawalEligibility`'s "recomputed fresh every year from
 * current indBal" discipline, not a persistent removal.
 */
export type NonRetirementExclusion = {
  total: Record<AccountCategory, number>;
  trad: Record<AccountCategory, number>;
  roth: Record<AccountCategory, number>;
  grandTotal: number;
};

export function computeNonRetirementExclusion(
  indAccts: {
    name: string;
    category: AccountCategory;
    taxType: string;
    ownerPersonId?: number;
    parentCategory?: string;
  }[],
  indBal: Map<string, number>,
  indKey: IndKeyFn,
): NonRetirementExclusion {
  const total = zeroByCategory();
  const trad = zeroByCategory();
  const roth = zeroByCategory();
  let grandTotal = 0;

  for (const ia of indAccts) {
    if (isRetirementMoney(ia.parentCategory)) continue;
    const balance = Math.max(0, indBal.get(indKey(ia)) ?? 0);
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
