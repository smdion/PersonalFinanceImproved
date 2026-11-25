/**
 * Tracked Roth basis per account and projected year: seeded from `rothBasisMeta`, grown by
 * contributions, drawn down by withdrawals (slicing a flow, not a balance). Conversion basis
 * only decreases: `performRothConversion` records no per-account conversion basis.
 */
import { roundToCents } from "@/lib/utils/math";
import type { RothBasisMeta } from "@/lib/pure/accounts/account-balances.types";
import type { ConversionLayer } from "@/lib/pure/accounts/early-access";

/** Running per-account Roth basis state for one projected year. */
export type RothBasisState = {
  contributionBasis: number;
  conversionBasis: number;
  latestConversionYear: number | null;
  /** Conversion basis by conversion, oldest first (they come out first in,
   *  first out: Reg. 1.408A-6 A-8), summing to `conversionBasis`. Absent:
   *  one layer at `latestConversionYear` (stored basis keeps one year). */
  conversionLayers?: readonly ConversionLayer[];
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

/** Keeps `total` dollars of `layers`, from the front (the oldest) or from
 *  the back (the newest), in their order. */
function layersCappedTo(
  layers: readonly ConversionLayer[],
  keepFromFront: boolean,
  total: number,
): ConversionLayer[] {
  const ordered = keepFromFront ? layers : [...layers].reverse();
  let left = Math.max(0, total);
  const kept: ConversionLayer[] = [];
  for (const layer of ordered) {
    const amount = roundToCents(Math.min(layer.amount, left));
    left = roundToCents(left - amount);
    if (amount > 0) kept.push({ year: layer.year, amount });
  }
  return keepFromFront ? kept : kept.reverse();
}

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

/** The share of a `pro_rata` Roth draw that returns basis: basis over the balance just before
 *  the draw, at most 1; none from an empty balance. */
export function proRataBasisShare(basis: number, balance: number): number {
  return balance > 0 ? Math.min(1, basis / balance) : 0;
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
  const ratio = proRataBasisShare(totalBasis, balanceBeforeWithdrawal);
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
  const conversionBasis = Math.max(
    0,
    roundToCents(state.conversionBasis - draw.conversionDrawn),
  );
  return {
    ...state,
    contributionBasis: Math.max(
      0,
      roundToCents(state.contributionBasis - draw.contributionDrawn),
    ),
    conversionBasis,
    // Oldest conversions come out first: the layers left are the newest.
    ...(state.conversionLayers && {
      conversionLayers: layersCappedTo(
        state.conversionLayers,
        false,
        conversionBasis,
      ),
    }),
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
    // The cap keeps the oldest conversions, as `computeRothIraAccess` does.
    ...(state.conversionLayers && {
      conversionLayers: layersCappedTo(
        state.conversionLayers,
        true,
        cappedConversion,
      ),
    }),
  };
}
