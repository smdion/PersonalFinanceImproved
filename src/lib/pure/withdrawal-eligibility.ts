/**
 * Withdrawal-ordering eligibility (v0.7.8, PLAN-v0.7.8-v4 Group 2.1) — the
 * per-projected-year gate that lets the decumulation engine's withdrawal
 * routing prefer penalty-free sources (Rule of 55, 59½, HSA 65, Roth
 * ordering) the same way the Tax Buckets analysis tool already displays,
 * currently completely disconnected from actual withdrawal routing.
 *
 * Locked design: `.scratch/docs/plans/DESIGN-DECISION-v0.7.8-withdrawal-ordering-group0.md`
 * (advisor session, 2026-08-26). Key decisions this module implements:
 *
 * - Q0 (soft/penalized-but-available): a "locked" account is never actually
 *   unreachable — it's a *preference*, never a prohibition. This module
 *   computes eligible/locked dollar amounts; it does not gate feasibility.
 * - Q3 part 2 (derivation direction): `eligibleBalances` is NOT derived here
 *   by summing this module's own eligible amounts — `indBal`/`acctBal` are
 *   separately-maintained tracks known to drift, and summing would break
 *   byte-identity for every household even when nothing is locked. This
 *   module returns *locked* amounts only; the caller subtracts them from
 *   `acctBal` (`engine/balance-utils.ts`'s `subtractLocked`).
 * - Q2 (basis deferred): `lockedAmount` is always 0 or the full account
 *   balance in this pass — never a partial slice. Dollar-partitioned
 *   (`AccountEligibility` carries both `eligibleAmount`/`lockedAmount`, not
 *   a boolean) so the deferred tracked-basis follow-up doesn't need to
 *   reshape this type.
 *
 * Leaf predicates (`early-access.ts`) and `projectRuleOf55`
 * (`tax-bucket-projection.ts`) are called verbatim — never reimplemented
 * (RULES.md § Single Computation Path).
 */
import type { AccountCategory } from "@/lib/config/account-types";
import {
  getAccountTypeConfig,
  isTaxFreeBucket,
  isHsaCategory,
  getAllCategories,
} from "@/lib/config/account-types";
import {
  computeTraditionalIraAccess,
  computeEmployerPlanPreTaxAccess,
  computeEmployerPlanRothAccess,
  computeRothIraAccess,
  computeHsaAccess,
} from "@/lib/pure/early-access";
import { projectRuleOf55 } from "@/lib/pure/tax-bucket-projection";
import { ageInYear } from "@/lib/utils/date";
import type {
  RuleOf55Status,
  RothBasisMeta,
} from "@/lib/pure/tax-bucket-analysis";
import { formatCurrency } from "@/lib/utils/format";
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
 *  year, and dollars that are not. Deliberately dollar-partitioned rather
 *  than a boolean — see the module docblock's Q2 note. In this pass
 *  `lockedAmount` is always either 0 or the full account balance. */
export type AccountEligibility = {
  indKey: string;
  category: AccountCategory;
  taxType: string;
  eligibleAmount: number;
  lockedAmount: number;
  /** Human-readable explanation of the locked/eligible verdict above —
   *  which early-access rule decided it, and (for the pro_rata/basis_first
   *  branches) the concrete age/year that drove the call. Surfaced in the
   *  UI (v0.7.8, PLAN-v0.7.8-v4 follow-up) so a household can see WHY the
   *  engine drew from — or avoided — a given account, not just that it did.
   *  Always present, for both locked and eligible verdicts: "why eligible"
   *  is as useful to show as "why locked". */
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
};

export type EligibilityRecord = {
  byKey: Map<string, AccountEligibility>;
  /** Sum of every `lockedAmount`. Zero ⇒ every gate downstream is a
   *  provable no-op — callers use this to skip the two-pass dispatch
   *  entirely rather than running it to a no-op result. */
  totalLocked: number;
  lockedTrad: Record<AccountCategory, number>;
  lockedRoth: Record<AccountCategory, number>;
  lockedTotal: Record<AccountCategory, number>;
};

function zeroByCategory(): Record<AccountCategory, number> {
  return Object.fromEntries(getAllCategories().map((c) => [c, 0])) as Record<
    AccountCategory,
    number
  >;
}

/** Whether every DOLLAR-BEARING slice `early-access.ts` returns for this
 *  account has `penaltyFree === false` — the account is locked iff nothing
 *  about it can be withdrawn without a penalty this year. Zero-amount
 *  slices are excluded: `computeRothIraAccess` always emits a "Contribution
 *  basis" slice with `penaltyFree: true` even when `contributionBasis` is
 *  0 (there's genuinely no basis to report a false status for) — counting
 *  that empty slice would make a pure-growth Roth IRA with $0 basis look
 *  "not locked" for an owner of any age, silently defeating the 59½ gate
 *  for exactly the account shape it exists to gate. */
function allSlicesLocked(
  slices: { amount: number; penaltyFree: boolean }[],
): boolean {
  const dollarBearing = slices.filter((s) => s.amount > 0);
  return dollarBearing.length > 0 && dollarBearing.every((s) => !s.penaltyFree);
}

/**
 * Computes per-account withdrawal eligibility for one projected year.
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
  const lockedTrad = zeroByCategory();
  const lockedRoth = zeroByCategory();
  const lockedTotal = zeroByCategory();
  let totalLocked = 0;

  for (const ia of indAccts) {
    const key = indKey(ia);
    const balance = indBal.get(key) ?? 0;
    const cfg = getAccountTypeConfig(ia.category);
    const birthYear = ia.ownerBirthYear;

    let locked = false;
    let reason = "No individual eligibility rule (joint account)";
    let basisRemaining: number | undefined;
    let basisUncertain: boolean | undefined;
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
    // record) — no age to gate on, so nothing here can be "locked" by an
    // early-access rule. Matches computeTaxBucketAnalysis's identical
    // joint-account handling.
    if (birthYear != null) {
      const currentAge = ageInYear(birthYear, year);
      if (cfg.rothOrderingRules === "basis_first") {
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
        locked = allSlicesLocked(slices);
        if (isRoth) {
          basisRemaining = roundToCents(contributionBasis + conversionBasis);
          basisUncertain = trackedBasis?.stale || trackedBasis?.isSeeded;
        }
        if (currentAge >= 59.5) {
          reason = "Eligible — age 59½ or older";
        } else if (isRoth && !locked) {
          reason = `Eligible — ${formatCurrency(basisRemaining ?? 0)} basis remaining, always penalty-free`;
        } else if (isRoth) {
          reason = "Locked until age 59½ — no basis remaining";
        } else {
          reason = `Locked until age 59½ (currently ${currentAge})`;
        }
      } else if (cfg.rothOrderingRules === "pro_rata") {
        // 401k/403b: Rule of 55 (projected to `year`, reusing the same
        // resolver the Tax Buckets "at retirement" view uses) OR 59½.
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
        locked = allSlicesLocked(slices);
        if (isRoth) {
          basisRemaining = roundToCents(enteredBasis);
          basisUncertain = trackedBasis?.stale || trackedBasis?.isSeeded;
        }
        if (ruleOf55Eligible) {
          reason =
            projected?.separationYear != null
              ? `Eligible — Rule of 55 met (separated ${projected.separationYear})`
              : "Eligible — Rule of 55 met";
        } else if (currentAge >= 59.5) {
          reason = "Eligible — age 59½ or older";
        } else if (ia.ruleOf55ForceIneligible) {
          reason = `Locked until age 59½ — Rule of 55 marked unavailable for forecasting (currently ${currentAge})`;
        } else {
          reason = `Locked until Rule of 55 or age 59½ (currently ${currentAge})`;
        }
      } else if (isHsaCategory(ia.category)) {
        locked = allSlicesLocked(computeHsaAccess(balance, currentAge));
        reason = locked
          ? `Locked until age 65 — non-medical withdrawal penalty (currently ${currentAge})`
          : "Eligible — age 65 or older";
      } else {
        // Brokerage (tracksCostBasis) and any category with no
        // early-access concept at all: locked stays false.
        // computeBrokerageAccess (early-access.ts) always returns
        // penaltyFree: true for both its slices regardless of age or cost
        // basis — brokerage has no age/employer gate at all — so there is
        // no predicate call whose result this branch would need;
        // hardcoding `locked = false` here is that fact, not a shortcut
        // around it.
        reason = "Always accessible — no age or employer restriction";
      }
    }

    const eligibleAmount = locked ? 0 : balance;
    const lockedAmount = locked ? balance : 0;
    byKey.set(key, {
      indKey: key,
      category: ia.category,
      taxType: ia.taxType,
      eligibleAmount,
      lockedAmount,
      reason,
      ...(basisRemaining != null ? { basisRemaining } : {}),
      ...(basisUncertain ? { basisUncertain } : {}),
    });

    if (lockedAmount > 0) {
      totalLocked += lockedAmount;
      lockedTotal[ia.category] += lockedAmount;
      if (isTaxFreeBucket(ia.taxType)) {
        lockedRoth[ia.category] += lockedAmount;
      } else {
        lockedTrad[ia.category] += lockedAmount;
      }
    }
  }

  return { byKey, totalLocked, lockedTrad, lockedRoth, lockedTotal };
}
