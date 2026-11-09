/**
 * Roth distribution taxability: whether each account's already-drawn `growthDrawn` (from
 * roth-basis-tracking.ts) is taxable. "Qualified" is `computeRothIraAccess`'s `age >=
 * PENALTY_FREE_AGE`, not the 5-year rule; Rule of 55 waives only the penalty, so it's not used.
 */
import type { BasisDraw } from "@/lib/pure/accounts/roth-basis-tracking";
import { ageInYear } from "@/lib/utils/date";
import { PENALTY_FREE_AGE } from "@/lib/constants";
import { roundToCents } from "@/lib/utils/math";

type RothTaxSplit = {
  /** Growth drawn from accounts whose distribution is NOT qualified —
   *  ordinary income. */
  taxableGrowth: number;
  /** Everything else withdrawn from Roth this year — contribution basis,
   *  conversion basis, and growth from qualified distributions. */
  taxFreeAmount: number;
  /** Per-account breakdown, for the UI disclosure and fixture assertions. */
  byKey: Map<string, { taxableGrowth: number; qualified: boolean }>;
};

/** A Roth distribution's growth is tax-free for this owner this year. */
export function isQualifiedRothOwner(
  ownerBirthYear: number | undefined,
  year: number,
): boolean {
  return (
    ownerBirthYear == null ||
    ageInYear(ownerBirthYear, year) >= PENALTY_FREE_AGE
  );
}

/**
 * Splits this year's Roth withdrawals (BasisDraws) into taxable growth vs tax-free, per account
 * and in total. No `ownerBirthYear` (joint) counts as qualified, as in `eligibility.ts`.
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

  for (const account of accounts) {
    const draw = draws.get(account.indKey);
    if (!draw) continue;
    const qualified = isQualifiedRothOwner(account.ownerBirthYear, year);
    const accountTaxableGrowth = qualified ? 0 : draw.growthDrawn;
    const accountTaxFree =
      draw.contributionDrawn +
      draw.conversionDrawn +
      (draw.growthDrawn - accountTaxableGrowth);
    byKey.set(account.indKey, {
      taxableGrowth: accountTaxableGrowth,
      qualified,
    });
    taxableGrowth += accountTaxableGrowth;
    taxFreeAmount += accountTaxFree;
  }

  return {
    taxableGrowth: roundToCents(taxableGrowth),
    taxFreeAmount: roundToCents(taxFreeAmount),
    byKey,
  };
}
