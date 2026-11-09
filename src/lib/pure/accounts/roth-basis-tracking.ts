/**
 * Tracked Roth basis per account and projected year: seeded from `rothBasisMeta`, grown by
 * contributions, drawn down by withdrawals (slicing a flow, not a balance). Conversion basis
 * only decreases: `performRothConversion` records no per-account conversion basis.
 */
import { roundToCents } from "@/lib/utils/math";
import type { RothBasisMeta } from "@/lib/pure/accounts/tax-bucket-analysis";

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
  /** `sourceYear < projectionStartYear`: years before the projection aren't modeled,
   *  so tracked basis understates real basis; surfaced as `roth.basisUncertain`. */
  stale: boolean;
};

/** How much of one account's withdrawal this year came from each basis
 *  source vs. growth. Always sums to the withdrawal amount it was sliced
 *  from (conservation invariant). */
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

/** Seeds tracked basis from the "now" `rothBasisMeta`; `meta == null` (no
 *  `account_basis` row) seeds all zeros, grown by modeled contributions. */
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

/** Adds one accumulation year's contribution to contribution basis. Must exclude
 *  employer match (never Roth basis). Never mutates `state`. */
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
 * Slices one withdrawal into contribution basis / conversion basis / growth by the category's
 * `rothOrderingRules`: `basis_first` in that order, `pro_rata` by the basis/balance ratio just
 * before the draw. Never mutates `input.state`.
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

/** Applies a `BasisDraw`, decrementing the running totals, floored at 0 against
 *  rounding residue. Never mutates `state`. */
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

/** Caps basis at the balance after market losses, contribution then conversion (the
 *  order `early-access.ts` uses), so tracked state and the predicates agree;
 *  `balance === 0` clamps both to 0. */
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
