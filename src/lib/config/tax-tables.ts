// Long-term capital gains tax math. The brackets themselves are yearly
// data (tax-data/us-federal/ → `ltcg_brackets`), passed in by the
// caller — none are built in.
//
// Key: LTCG brackets use total taxable income (ordinary + capital gains),
// NOT just capital gains alone.

import type { ReturnFilingStatus } from "./filing-status";

/** LTCG brackets by filing status, as stored (`ltcg_brackets`): each
 *  threshold is that bracket's ceiling; `null` is the open top bracket. */
export type LtcgBracketTable = Record<
  string,
  { threshold: number | null; rate: number }[]
>;

/** The filing status's brackets. Every complete year has every status
 *  (resolveTaxParams), so a missing one is a caller bug — never guessed. */
function bracketsFor(
  brackets: LtcgBracketTable,
  filingStatus: ReturnFilingStatus,
): { threshold: number; rate: number }[] {
  const raw = brackets[filingStatus];
  if (!raw || raw.length === 0)
    throw new Error(`No LTCG brackets for filing status ${filingStatus}`);
  // Normalize null thresholds to Infinity (the stored open top bracket).
  return raw.map((b) => ({ threshold: b.threshold ?? Infinity, rate: b.rate }));
}

/**
 * Get the effective LTCG tax rate based on total taxable income and filing status.
 * Uses the income level (ordinary + gains) to determine which LTCG bracket applies.
 *
 * For simplicity, returns a single rate (the marginal rate at the given income level).
 * A blended rate would be more accurate for large gains spanning brackets, but the
 * single-rate approximation is sufficient for projection purposes.
 *
 * @param brackets The year's LTCG brackets (`ltcg_brackets`, resolved).
 */
export function getLtcgRate(
  totalTaxableIncome: number,
  filingStatus: ReturnFilingStatus,
  brackets: LtcgBracketTable,
): number {
  const table = bracketsFor(brackets, filingStatus);
  // The top bracket is open (ltcgBracketsSchema), so this always finds one.
  return (table.find((b) => totalTaxableIncome <= b.threshold) ?? table.at(-1)!)
    .rate;
}

/**
 * The LTCG rate that applies to the NEXT dollar above `taxableIncome` — the
 * exclusive counterpart to `getLtcgRate`. Use when pricing a slice of gains
 * that STARTS at a given income level, notably one landing exactly on
 * another bracket's own ceiling (as `ltcgRoomForRate` computes by
 * construction — `zeroGainsRoom`'s callers add it back onto ordinary
 * income to price the tier beyond it). `getLtcgRate`'s inclusive `<=`
 * answers a different, also-correct question — "what bracket is a real
 * dollar SITTING AT" (income exactly at the 0% ceiling genuinely IS taxed
 * at 0%) — and returning the bracket BELOW for a "what's next" query
 * silently under-prices that entire next tier — this
 * exact substitution mispriced brokerage as 0%/NIIT-only well past its
 * real 15% rate for any household whose ordinary income left room in the
 * 0% zone, causing `rankWithdrawalTiers` to disagree with the real tax
 * charge `computeLtcgTax` correctly applies — RULES.md single-computation-
 * path). Both functions are correct for their own question; do not
 * consolidate them.
 *
 * Deliberately NOT a rate-keyed "next bracket above targetRate" walk (that
 * approach was tried and rejected — it returns a flat 0.15 for every
 * income level, silently under-pricing a household already past the 15%
 * ceiling too, who should get 0.20). Same single-rate-per-tier
 * approximation as `getLtcgRate` otherwise (a tier spanning 15% into 20%
 * still prices entirely at whichever bracket the START of that tier
 * lands in) — acceptable for ordering, not exact-cent pricing.
 */
export function ltcgRateForNextDollar(
  taxableIncome: number,
  filingStatus: ReturnFilingStatus,
  brackets: LtcgBracketTable,
): number {
  const table = bracketsFor(brackets, filingStatus);
  return (table.find((b) => taxableIncome < b.threshold) ?? table.at(-1)!).rate;
}

/**
 * Compute progressive LTCG tax by stacking capital gains on top of ordinary income.
 *
 * LTCG brackets are based on total taxable income (ordinary + gains). Gains sit on
 * top of ordinary income in the bracket stack, so low-income filers may have some
 * gains in the 0% bracket even if they also have gains in the 15% bracket.
 *
 * Example (MFJ 2026, thresholds $98,900 / $613,700):
 *   ordinary = $80,000, gains = $30,000
 *   → $18,900 of gains taxed at 0% (fills up to $98,900)
 *   → $11,100 of gains taxed at 15%
 *   → total tax = $1,665  (vs. flat 15% × $30k = $4,500)
 *
 * @returns The total LTCG tax amount (not a rate).
 */
export function computeLtcgTax(
  ordinaryTaxableIncome: number,
  capitalGains: number,
  filingStatus: ReturnFilingStatus,
  brackets: LtcgBracketTable,
): number {
  if (capitalGains <= 0) return 0;
  const table = bracketsFor(brackets, filingStatus);

  let tax = 0;
  let gainsRemaining = capitalGains;
  // "floor" is the bottom of the current bracket segment for gains
  let floor = Math.max(0, ordinaryTaxableIncome);

  for (const b of table) {
    if (gainsRemaining <= 0) break;
    if (floor >= b.threshold) continue; // ordinary income already past this bracket

    const room = b.threshold - floor;
    const taxable = Math.min(gainsRemaining, room);
    tax += taxable * b.rate;
    gainsRemaining -= taxable;
    floor += taxable;
  }

  return Math.round(tax * 100) / 100; // round to cents
}

/**
 * How much LTCG headroom remains before crossing above `targetRate`, given
 * ordinary taxable income already occupying the bottom of the stack.
 *
 * NOT a reuse of `incomeCapForMarginalRate` (ordinary W-4 brackets) — the
 * two tables use opposite threshold semantics. Ordinary brackets store the
 * bracket's floor (matched with `>=` in `estimateEffectiveTaxRate`); LTCG
 * brackets store the bracket's ceiling (matched with `<=` in `getLtcgRate`
 * above). Casting one against the other silently returns the wrong number
 * (verified: overstates MFJ 0%-LTCG headroom by $514,800) — this function
 * exists so nothing needs to make that mistake.
 */
export function ltcgRoomForRate(
  targetRate: number,
  ordinaryTaxableIncome: number,
  filingStatus: ReturnFilingStatus,
  brackets: LtcgBracketTable,
): number {
  const table = bracketsFor(brackets, filingStatus);
  for (const b of table) {
    // LTCG brackets store the bracket's OWN ceiling (unlike ordinary
    // brackets, which store the NEXT bracket's floor) — so the room for
    // staying AT `targetRate` is that bracket's own threshold, found via
    // `>=` (the first bracket whose rate reaches targetRate), not `>`.
    if (b.rate >= targetRate) {
      return Math.max(0, b.threshold - ordinaryTaxableIncome);
    }
  }
  return Infinity;
}
