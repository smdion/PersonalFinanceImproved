/**
 * Roth distribution taxability — splits a year's Roth withdrawals into the
 * taxable-growth portion (non-qualified distributions) and the tax-free
 * portion (contribution basis, conversion basis, and growth from qualified
 * distributions), from the per-account `BasisDraw`s `roth-basis-tracking.ts`
 * already computed.
 *
 * v0.7.8 follow-up to the tracked-basis pass — see
 * `.scratch/docs/plans/DESIGN-DECISION-v0.7.8-roth-tax-basis.md` (locked
 * design, advisor-reviewed). Scope is deliberately narrow: this module
 * decides ONLY whether an account's already-computed `growthDrawn` is
 * taxable. It never re-slices a withdrawal — `drawFromBasis` in
 * `roth-basis-tracking.ts` remains the one place that happens.
 *
 * "Qualified" here means the same thing `early-access.ts`'s
 * `computeRothIraAccess` already means by it: `age >= PENALTY_FREE_AGE`.
 * Deliberately NOT the full IRS 5-year-rule test — see the design doc's Q2
 * for why a stricter local definition would create a second, conflicting
 * definition of "qualified" elsewhere in the app (a Single Computation Path
 * violation), and for the three documented limitations (L1-L3) this
 * approximation carries. Rule of 55 does NOT make a distribution qualified
 * for tax purposes — it only ever exempts the 10% penalty (a separate,
 * still-unmodeled cost — see the design doc's Q1) — so it plays no role
 * here.
 */
import type { BasisDraw } from "@/lib/pure/roth-basis-tracking";
import { ageInYear } from "@/lib/utils/date";
import { PENALTY_FREE_AGE } from "@/lib/constants";
import { roundToCents } from "@/lib/utils/math";

export type RothTaxSplit = {
  /** Growth drawn from accounts whose distribution is NOT qualified —
   *  ordinary income. */
  taxableGrowth: number;
  /** Everything else withdrawn from Roth this year — contribution basis,
   *  conversion basis, and growth from qualified distributions. */
  taxFreeAmount: number;
  /** Per-account breakdown, for the UI disclosure and fixture assertions. */
  byKey: Map<string, { taxableGrowth: number; qualified: boolean }>;
};

/**
 * Splits this year's Roth withdrawals (already sliced into BasisDraws) into
 * taxable-growth vs. tax-free, per account and in aggregate.
 *
 * An account with no resolvable `ownerBirthYear` (joint account) is treated
 * as qualified — matching `withdrawal-eligibility.ts`'s identical "no age to
 * gate on" handling for the same accounts, so the two modules never
 * disagree about the same account.
 */
export function splitRothWithdrawalForTax(input: {
  accounts: { indKey: string; ownerBirthYear?: number }[];
  draws: Map<string, BasisDraw>;
  year: number;
}): RothTaxSplit {
  const { accounts, draws, year } = input;
  const byKey = new Map<
    string,
    { taxableGrowth: number; qualified: boolean }
  >();
  let taxableGrowth = 0;
  let taxFreeAmount = 0;

  for (const acct of accounts) {
    const draw = draws.get(acct.indKey);
    if (!draw) continue;
    const qualified =
      acct.ownerBirthYear == null ||
      ageInYear(acct.ownerBirthYear, year) >= PENALTY_FREE_AGE;
    const acctTaxableGrowth = qualified ? 0 : draw.growthDrawn;
    const acctTaxFree =
      draw.contributionDrawn +
      draw.conversionDrawn +
      (draw.growthDrawn - acctTaxableGrowth);
    byKey.set(acct.indKey, { taxableGrowth: acctTaxableGrowth, qualified });
    taxableGrowth += acctTaxableGrowth;
    taxFreeAmount += acctTaxFree;
  }

  return {
    taxableGrowth: roundToCents(taxableGrowth),
    taxFreeAmount: roundToCents(taxFreeAmount),
    byKey,
  };
}
