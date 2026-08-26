/**
 * Tracked (not snapshot) Roth basis draw-down — v0.7.8 follow-up to
 * PLAN-v0.7.8-v4's engine-aware withdrawal ordering.
 *
 * Locked design: `.scratch/docs/plans/DESIGN-DECISION-v0.7.8-tracked-basis.md`
 * (advisor session, 2026-08-26). Replaces the one-time `rothBasisMeta`
 * snapshot `withdrawal-eligibility.ts` previously read with a running,
 * per-account, per-projected-year balance that GROWS with modeled
 * contributions (accumulation phase) and SHRINKS as withdrawals actually
 * take basis dollars (decumulation phase).
 *
 * This module answers "how much basis is left, and how much of THIS
 * withdrawal was basis" — a different question from
 * `withdrawal-eligibility.ts` ("is this account gated this year"), so it's
 * a separate module with a separate consumer (the accumulation-phase
 * handler only needs this one).
 *
 * Deliberately NOT a second call to `early-access.ts`'s
 * `computeRothIraAccess`/`computeEmployerPlanRothAccess`: those slice a
 * *balance* (answering "of this account's current balance, how much is
 * basis"); `drawFromBasis` slices a *flow* (answering "of the $X just
 * withdrawn, how much was basis"). Feeding a withdrawal amount into the
 * balance-slicing predicates as if it were the balance would silently
 * produce the wrong answer for pro-rata accounts, where the basis fraction
 * of a distribution depends on the basis/balance ratio, not the raw basis
 * figure. `drawFromBasis` is the dollar-flow dual of the same ordering
 * rules those predicates already encode — same rule, different question —
 * verified against them by the "full distribution" equivalence test in
 * `tests/pure/roth-basis-tracking.test.ts`.
 *
 * Conversion basis is DECREMENT-ONLY this pass: `performRothConversion`
 * (engine/post-withdrawal-optimizer.ts) moves money at the aggregate/
 * category level only and never touches individual account balances, so
 * there is no per-account conversion number to accrue from yet. See the
 * design doc's Q2b for why this is a separate, pre-existing engine gap
 * (also a likely contributor to the `[DIAG] Roth divergence` warning) and
 * not something this pass can fix without conflating two behavior changes
 * in one diff.
 */
import { roundToCents } from "@/lib/utils/math";
import type { RothBasisMeta } from "@/lib/pure/tax-bucket-analysis";

/** Running per-account Roth basis state for one projected year. */
export type RothBasisState = {
  contributionBasis: number;
  conversionBasis: number;
  latestConversionYear: number | null;
  /** `account_basis.year` this state was seeded from; null when the
   *  household has no row for this account at all (basis starts at 0 and
   *  grows only from modeled contributions). */
  sourceYear: number | null;
  /** From `account_basis.isSeeded` — a carried-forward, never-reviewed
   *  row. Carried into the UI disclosure, not acted on differently here. */
  isSeeded: boolean;
  /** `sourceYear != null && sourceYear < projectionStartYear`. Years
   *  between the basis row and the projection's own year 0 are not
   *  modeled by the engine, so tracked basis understates real basis by
   *  whatever was contributed in that unmodeled gap. Surfaced, never
   *  silently swallowed — see `IndividualAccountYearBalance.rothBasisUncertain`. */
  stale: boolean;
};

/** How much of one account's withdrawal this year came from each basis
 *  source vs. growth. Always sums to the withdrawal amount it was sliced
 *  from (conservation invariant — see the design doc's acceptance
 *  criterion 7). */
export type BasisDraw = {
  contributionDrawn: number;
  conversionDrawn: number;
  growthDrawn: number;
};

const ZERO_DRAW: BasisDraw = {
  contributionDrawn: 0,
  conversionDrawn: 0,
  growthDrawn: 0,
};

/** Seeds tracked basis from the "now" snapshot (`rothBasisMeta`, threaded
 *  per-account by `build-engine-payload.ts` Group 1.1). `meta == null`
 *  (no `account_basis` row at all) seeds an all-zero state rather than
 *  crashing or inventing a figure — basis then grows purely from modeled
 *  contributions going forward. */
export function initRothBasisState(
  meta: RothBasisMeta | null,
  projectionStartYear: number,
): RothBasisState {
  if (!meta) {
    return {
      contributionBasis: 0,
      conversionBasis: 0,
      latestConversionYear: null,
      sourceYear: null,
      isSeeded: false,
      stale: false,
    };
  }
  return {
    contributionBasis: meta.contributionBasis,
    conversionBasis: meta.conversionBasis,
    latestConversionYear: meta.latestConversionYear,
    sourceYear: meta.year,
    isSeeded: meta.isSeeded,
    stale: meta.year < projectionStartYear,
  };
}

/** Adds one projected accumulation year's contribution to the running
 *  contribution-basis total. `contributionThisYear` must already exclude
 *  employer match — match is never Roth basis, regardless of which
 *  tax-type row it lands on (same rule `tax-bucket-projection.ts`'s
 *  `projectContributionBasis` enforces; see the design doc's Q2a and
 *  acceptance criterion 5). Never mutates `state`. */
export function accrueContributionBasis(
  state: RothBasisState,
  contributionThisYear: number,
): RothBasisState {
  if (contributionThisYear <= 0) return state;
  return {
    ...state,
    contributionBasis: roundToCents(
      state.contributionBasis + contributionThisYear,
    ),
  };
}

/**
 * Slices ONE account's withdrawal into contribution-basis / conversion-
 * basis / growth, by the account category's own `rothOrderingRules`
 * (`getAccountTypeConfig(category).rothOrderingRules` — read, never
 * hardcoded). Pure — does not mutate `input.state`.
 *
 * `basis_first` (IRA-type — Roth IRA ordering): contribution basis is
 * drawn before conversion basis, before growth — the same ordering
 * `early-access.ts`'s `computeRothIraAccess` encodes as balance slices.
 *
 * `pro_rata` (401k/403b Roth sub-election — IRS pro-rata rule): the basis
 * fraction of THIS withdrawal is proportional to the basis/balance ratio
 * immediately before the withdrawal, same rule
 * `computeEmployerPlanRothAccess` encodes for the balance as a whole.
 */
export function drawFromBasis(input: {
  state: RothBasisState;
  orderingRule: "basis_first" | "pro_rata";
  balanceBeforeWithdrawal: number;
  withdrawal: number;
}): BasisDraw {
  const { state, orderingRule, balanceBeforeWithdrawal, withdrawal } = input;
  if (withdrawal <= 0) return ZERO_DRAW;

  if (orderingRule === "basis_first") {
    const contributionDrawn = roundToCents(
      Math.min(withdrawal, state.contributionBasis),
    );
    const conversionDrawn = roundToCents(
      Math.min(withdrawal - contributionDrawn, state.conversionBasis),
    );
    const growthDrawn = roundToCents(
      withdrawal - contributionDrawn - conversionDrawn,
    );
    return { contributionDrawn, conversionDrawn, growthDrawn };
  }

  // pro_rata
  const totalBasis = state.contributionBasis + state.conversionBasis;
  const ratio =
    balanceBeforeWithdrawal > 0
      ? Math.min(1, totalBasis / balanceBeforeWithdrawal)
      : 0;
  const basisDrawn = withdrawal * ratio;
  const contributionShareOfBasis =
    totalBasis > 0 ? state.contributionBasis / totalBasis : 0;
  const contributionDrawn = roundToCents(basisDrawn * contributionShareOfBasis);
  const conversionDrawn = roundToCents(basisDrawn - contributionDrawn);
  const growthDrawn = roundToCents(
    withdrawal - contributionDrawn - conversionDrawn,
  );
  return { contributionDrawn, conversionDrawn, growthDrawn };
}

/** Applies a `BasisDraw` computed by `drawFromBasis`, decrementing the
 *  running totals. Floors at 0 (a rounding residual should never push
 *  basis negative, but this is the same defensive floor `subtractPenaltyExposed`/
 *  drift-safety, not an expected path). Never mutates `state`. */
export function applyBasisDraw(
  state: RothBasisState,
  draw: BasisDraw,
): RothBasisState {
  return {
    ...state,
    contributionBasis: Math.max(
      0,
      roundToCents(state.contributionBasis - draw.contributionDrawn),
    ),
    conversionBasis: Math.max(
      0,
      roundToCents(state.conversionBasis - draw.conversionDrawn),
    ),
  };
}

/** Market losses can push an account's balance below its tracked basis.
 *  `early-access.ts`'s predicates already `Math.min` basis against balance
 *  (`computeRothIraAccess`'s `cappedContribution`/`cappedConversion`,
 *  `computeEmployerPlanRothAccess`'s `basisFraction`) — this mirrors that
 *  same contribution-then-conversion clamp order so tracked state and the
 *  balance-slicing predicates never disagree about how much basis a
 *  shrunk account can still have. Also the hook for a zeroed-out (dust-
 *  cleaned) account: `balance === 0` clamps both fields to 0. */
export function clampBasisToBalance(
  state: RothBasisState,
  balance: number,
): RothBasisState {
  const totalBasis = state.contributionBasis + state.conversionBasis;
  if (totalBasis <= balance) return state;
  const cappedContribution = Math.max(
    0,
    Math.min(state.contributionBasis, balance),
  );
  const cappedConversion = Math.max(
    0,
    Math.min(state.conversionBasis, balance - cappedContribution),
  );
  return {
    ...state,
    contributionBasis: roundToCents(cappedContribution),
    conversionBasis: roundToCents(cappedConversion),
  };
}
