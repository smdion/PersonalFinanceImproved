/**
 * Withdrawal-ordering penalty exposure (v0.7.8, PLAN-v0.7.8-v4 Group 2.1;
 * extended by the v0.7.8 penalty-hard-exclusion follow-up) — the
 * per-projected-year computation that tells the decumulation engine's
 * withdrawal routing exactly which dollars, in each individual account,
 * would incur the 10% early-withdrawal penalty this year (Rule of 55, 59½,
 * HSA 65, Roth ordering) — the same rules the Tax Buckets analysis tool
 * already displays, now wired into actual withdrawal routing.
 *
 * Locked designs:
 * `.scratch/docs/plans/DESIGN-DECISION-v0.7.8-withdrawal-ordering-group0.md`
 * (advisor session, 2026-08-26) and
 * `.scratch/docs/plans/DESIGN-DECISION-v0.7.8-penalty-hard-exclusion.md`
 * (advisor session, 2026-08-26, supersedes Group 0 § Q0). Key decisions this
 * module implements:
 *
 * - Group 0 § Q0 ("soft/penalized-but-available") is SUPERSEDED. A
 *   penalty-exposed dollar is no longer treated as reachable-but-
 *   disfavored — by explicit user direction, the router (see
 *   `withdrawal-routing.ts`) now excludes it by default
 *   (`config.avoidPenalizedWithdrawals`, default true). This module still
 *   only computes the per-dollar partition; it does not itself gate
 *   anything — the router decides what to do with the partition.
 * - Penalty-hard-exclusion § Q1 (per-dollar partition, one rule for every
 *   account type): penalty-free capacity is the LEADING, CONTIGUOUSLY
 *   penalty-free PREFIX of an account's `early-access.ts` slices, in the
 *   order that account's own ordering rules release them — not the sum of
 *   every penalty-free slice regardless of position. See
 *   `penaltyFreePrefixAmount`'s docblock.
 * - Penalty-hard-exclusion § Q2: `locked` (old, whole-account concept) and
 *   `penalty-exposed` (this pass) are NOT parallel ideas — every dollar in
 *   an old-style "locked" account is penalty-exposed, but a partially
 *   penalty-exposed account (the case that motivated this whole pass — a
 *   pre-59½ Roth IRA with contribution basis) was never "locked" under the
 *   old whole-account boolean. `eligibilityLocked` in
 *   `IndividualAccountYearBalance` (consumed by the UI) keeps meaning
 *   "every dollar in this account is penalty-exposed" for backward
 *   compatibility with existing reason-string wording; `penaltyExposedAmount`
 *   is the number that actually matters for routing.
 *
 * Leaf predicates (`early-access.ts`) and `projectRuleOf55`
 * (`tax-bucket-projection.ts`) are called verbatim — never reimplemented
 * (RULES.md § Single Computation Path).
 */
import type { AccountCategory } from "@/lib/config/account-types";
import {
  isTaxFreeBucket,
  isHsaCategory,
  isIraCategory,
  isRuleOf55EligibleCategory,
  getAllCategories,
} from "@/lib/config/account-types";
import {
  computeTraditionalIraAccess,
  computeEmployerPlanPreTaxAccess,
  computeEmployerPlanRothAccess,
  computeRothIraAccess,
  computeHsaAccess,
  penaltyFreePrefixAmount,
  type EarlyAccessSlice,
} from "@/lib/pure/early-access";
import { projectRuleOf55 } from "@/lib/pure/tax-bucket-projection";
import { ageInYear } from "@/lib/utils/date";
import type {
  RuleOf55Status,
  RothBasisMeta,
} from "@/lib/pure/tax-bucket-analysis";
import { formatCurrency } from "@/lib/utils/format";
import { PENALTY_FREE_AGE } from "@/lib/constants";
import { roundToCents } from "@/lib/utils/math";
import type { RothBasisState } from "@/lib/pure/roth-basis-tracking";

/** The account shape this module needs — a structural subset of
 *  `IndividualAccountInput` (`lib/calculators/types/shared.ts`), named
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
  /** Rule of 55 forecasting override (v0.7.8) — see
   *  `projectRuleOf55`'s `opts.forceIneligible` docblock
   *  (`tax-bucket-projection.ts`) for the full contract. Passed straight
   *  through to that function; this module never inspects or short-circuits
   *  on it directly — doing so was a real bug caught in advisor review,
   *  since Rule-of-55-ineligible is not the same as locked (the pro_rata
   *  branch below is "Rule of 55 OR 59½"). */
  ruleOf55ForceIneligible?: boolean;
  /** Household is fine paying the penalty on THIS account if it avoids an
   *  otherwise-real shortfall (R41). Only ever `true` when set — see
   *  `IndividualAccountInput.allowPenalizedWithdrawals`'s docblock
   *  (`lib/calculators/types/shared.ts`) for the full contract. This
   *  module doesn't gate on it directly (same "compute the partition,
   *  don't decide policy" boundary as the module docblock's § Q0 note) —
   *  it just carries the flag onto `AccountEligibility` and folds it into
   *  the record's "still excluded" aggregates below, which
   *  `subtractPenaltyExposed` (`engine/balance-utils.ts`) is the one that
   *  actually acts on. */
  allowPenalizedWithdrawals?: boolean;
};

/** Composite-key function — deliberately the same shape as the engine's own
 *  `IndKeyFn` (`engine/individual-account-tracking.ts`) without importing
 *  it: this module lives outside `lib/calculators/engine/`, and reaching
 *  into engine internals from outside is a lint-enforced layering
 *  violation (`tests/lint/violations.test.ts`'s `no-engine-internal-import`
 *  rule). The engine passes its own `makeIndKey()` instance in. */
export type IndKeyFn = (ia: {
  name: string;
  category: string;
  taxType: string;
  ownerPersonId?: number;
}) => string;

/** Dollars of one individual account that are penalty-free this projected
 *  year, and dollars that are not (v0.7.8 penalty-hard-exclusion follow-up
 *  — see module docblock). `penaltyFreeAmount + penaltyExposedAmount ===`
 *  the account's balance, always (acceptance criterion 9). */
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
  /** Human-readable explanation of the eligibility verdict above — which
   *  early-access rule decided it, and (for the pro_rata/basis_first
   *  branches) the concrete age/year that drove the call. Surfaced in the
   *  UI so a household can see WHY the engine drew from — or excluded — a
   *  given account, not just that it did. Always present. */
  reason: string;
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
   *  (R41) — always present (defaults `false`), unlike the input's own
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
   *  `allowPenalizedWithdrawals: true` (R41) — the narrower total that
   *  `subtractPenaltyExposed` actually excludes from the routable pool, so
   *  an allowed account's exposed dollars stay reachable while every other
   *  account's stay excluded. Identical to the aggregates above whenever no
   *  account has the override set (the default), by construction. */
  penaltyExposedTradStillExcluded: Record<AccountCategory, number>;
  penaltyExposedRothStillExcluded: Record<AccountCategory, number>;
  penaltyExposedTotalStillExcluded: Record<AccountCategory, number>;
  /** Scalar sum of `penaltyExposedTotalStillExcluded` across every category
   *  — the R41 counterpart to `totalPenaltyExposed`. `routeForMode` MUST
   *  gate its early-out and price `penaltyAvoidedShortfall` off THIS value,
   *  not `totalPenaltyExposed`: once any account opts in, the two diverge,
   *  and using the blind total would attribute a real household shortfall
   *  to "penalty avoidance" for dollars that were never excluded at all. */
  totalPenaltyExposedStillExcluded: number;
};

function zeroByCategory(): Record<AccountCategory, number> {
  return Object.fromEntries(getAllCategories().map((c) => [c, 0])) as Record<
    AccountCategory,
    number
  >;
}

/** Whether every DOLLAR-BEARING slice `early-access.ts` returns for this
 *  account has `penaltyFree === false` — every dollar in the account is
 *  penalty-exposed. Zero-amount slices are excluded: `computeRothIraAccess`
 *  always emits a "Contribution basis" slice with `penaltyFree: true` even
 *  when `contributionBasis` is 0 (there's genuinely no basis to report a
 *  false status for) — counting that empty slice would make a pure-growth
 *  Roth IRA with $0 basis look "not fully exposed" for an owner of any age,
 *  silently defeating the 59½ gate for exactly the account shape it exists
 *  to gate. Used only for the UI's `eligibilityLocked` flag and reason-text
 *  branching now — routing uses `penaltyFreePrefixAmount` instead (see
 *  module docblock's § Q2 note: these are not the same question). */
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
 * ("now" resolution, threaded by `build-engine-payload.ts` Group 1.1) are
 * external inputs; every eligibility question is re-derived from them
 * fresh for `year` via the same leaf predicates `early-access.ts` and the
 * Tax Buckets tool already use.
 *
 * `indBasis` (tracked Roth basis follow-up, optional): when supplied,
 * Roth basis figures come from `indBasis.get(key)` (a running, per-year
 * tracked balance — see `@/lib/pure/roth-basis-tracking`) instead of each
 * account's static `ia.rothBasisMeta` snapshot. When omitted, behavior is
 * byte-identical to before tracked basis existed — this keeps every
 * non-engine caller and existing test unchanged. Locked design:
 * `.scratch/docs/plans/DESIGN-DECISION-v0.7.8-tracked-basis.md` § Q6 —
 * the gate and the UI number MUST read the same figure (reading the
 * snapshot for the gate while showing tracked basis in the UI would be
 * two numbers for one quantity, the exact Single Computation Path failure
 * this locked design avoids).
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

  for (const ia of indAccts) {
    const key = indKey(ia);
    const balance = indBal.get(key) ?? 0;
    const birthYear = ia.ownerBirthYear;

    let reason = "No individual eligibility rule (joint account)";
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
      if (isIraCategory(ia.category)) {
        // IRA-type: 59½ flat age gate, or Roth IRA's own contribution/
        // conversion/growth ordering (contribution basis is always
        // penalty-free regardless of age).
        const isRoth = isTaxFreeBucket(ia.taxType);
        const slices = isRoth
          ? computeRothIraAccess({
              balance,
              currentAge,
              currentYear: year,
              contributionBasis,
              conversionBasis,
              latestConversionYear,
            })
          : computeTraditionalIraAccess(balance, currentAge);
        const locked = allSlicesLocked(slices);
        penaltyFreeAmount = penaltyFreePrefixAmount(slices);
        if (isRoth) {
          basisRemaining = roundToCents(contributionBasis + conversionBasis);
          basisUncertain = trackedBasis?.stale || trackedBasis?.isSeeded;
        }
        const growthExposed = roundToCents(
          Math.max(0, balance - penaltyFreeAmount),
        );
        if (currentAge >= PENALTY_FREE_AGE) {
          reason = "Eligible — age 59½ or older";
        } else if (isRoth && !locked && growthExposed <= 0.005) {
          reason = `Eligible — ${formatCurrency(basisRemaining ?? 0)} basis remaining, always penalty-free`;
        } else if (isRoth && !locked) {
          // Some of this account is reachable (contribution/conversion
          // basis) and some is not (growth, locked until 59½) — say so
          // plainly rather than "Eligible", which reads as the whole
          // balance being reachable when it isn't.
          reason = `Partially eligible — ${formatCurrency(basisRemaining ?? 0)} basis penalty-free, ${formatCurrency(growthExposed)} growth locked until 59½`;
        } else if (isRoth) {
          reason = "Locked until age 59½ — no basis remaining";
        } else {
          reason = `Locked until age 59½ (currently ${currentAge})`;
        }
      } else if (isRuleOf55EligibleCategory(ia.category)) {
        // 401k/403b: Rule of 55 (projected to `year`, reusing the same
        // resolver the Tax Buckets "at retirement" view uses) OR 59½.
        // Dispatches on cfg.ruleOf55Eligible (a static, category-level
        // "is IRC §72(t)(2)(A)(v) even applicable to this account type"
        // fact), not the coincidentally-equivalent
        // `rothOrderingRules === "pro_rata"` (a Roth-distribution-ordering
        // concept, legally distinct — code review, 2026-08-27).
        const projected = projectRuleOf55(
          ia.ruleOf55 ?? null,
          year,
          birthYear,
          {
            forceIneligible: ia.ruleOf55ForceIneligible,
          },
        );
        const ruleOf55Eligible = projected?.eligible ?? false;
        const isRoth = isTaxFreeBucket(ia.taxType);
        const enteredBasis = contributionBasis + conversionBasis;
        const slices = isRoth
          ? computeEmployerPlanRothAccess(
              balance,
              currentAge,
              ruleOf55Eligible,
              enteredBasis,
            )
          : computeEmployerPlanPreTaxAccess(
              balance,
              currentAge,
              ruleOf55Eligible,
            );
        penaltyFreeAmount = penaltyFreePrefixAmount(slices);
        if (isRoth) {
          basisRemaining = roundToCents(enteredBasis);
          basisUncertain = trackedBasis?.stale || trackedBasis?.isSeeded;
        }
        if (ruleOf55Eligible) {
          reason =
            projected?.separationYear != null
              ? `Eligible — Rule of 55 met (separated ${projected.separationYear})`
              : "Eligible — Rule of 55 met";
        } else if (currentAge >= PENALTY_FREE_AGE) {
          reason = "Eligible — age 59½ or older";
        } else if (ia.ruleOf55ForceIneligible) {
          reason = `Locked until age 59½ — Rule of 55 marked unavailable for forecasting (currently ${currentAge})`;
        } else {
          reason = `Locked until Rule of 55 or age 59½ (currently ${currentAge})`;
        }
      } else if (isHsaCategory(ia.category)) {
        const slices = computeHsaAccess(balance, currentAge);
        penaltyFreeAmount = penaltyFreePrefixAmount(slices);
        reason = allSlicesLocked(slices)
          ? `Locked until age 65 — non-medical withdrawal penalty (currently ${currentAge})`
          : "Eligible — age 65 or older";
      } else {
        // Brokerage (tracksCostBasis) and any category with no
        // early-access concept at all: fully penalty-free.
        // computeBrokerageAccess (early-access.ts) always returns
        // penaltyFree: true for both its slices regardless of age or cost
        // basis — brokerage has no age/employer gate at all — so there is
        // no predicate call whose result this branch would need;
        // `penaltyFreeAmount = balance` here is that fact, not a shortcut
        // around it.
        reason = "Always accessible — no age or employer restriction";
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

    if (penaltyExposedAmount > 0) {
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
  };
}
