/**
 * Qualified Charitable Distributions (QCD) — R46.
 *
 * A QCD is a direct transfer from a Traditional IRA to a qualified charity
 * that satisfies part of the owner's RMD without counting as taxable
 * income. It's a proactive election on the RMD itself — NOT a rule for
 * what happens to spending "excess" — so this runs BEFORE tax gross-up
 * and routing, not after (see `rmdExcessHandling` /
 * `reinvestRmdExcess` in `balance-deduction.ts` for the separate,
 * unrelated "what to do with leftover money" question).
 *
 * Not capped by the RMD amount (advisor review, 2026-08-29): IRC
 * §408(d)(8) caps a QCD at the annual per-person dollar limit, full stop —
 * it is legal, and a real tax-planning move, to QCD MORE than the year's
 * RMD (the excess just doesn't count toward satisfying it, but is still
 * excluded from taxable income). `qcdMaximize` means what it says. The
 * only real caps are the IRA balance actually available and the annual
 * IRS limit.
 *
 * Approximation (documented, not IRS-exact): the engine's RMD calculation
 * pools ALL pre-tax accounts (401k + IRA + 403b) into one per-person
 * Traditional balance — it does not model the IRS's real per-account-type
 * RMD math (all IRAs aggregated one way, each 401k calculated separately).
 * Since QCDs are IRA-only, this module caps the QCD-eligible amount at
 * `min(cap, personIraTraditionalBalance)` rather than attempting a full
 * per-account-type RMD split, which this engine doesn't do anywhere
 * today. See PLAN-rmd-excess-handling.md for the full rationale.
 *
 * Only meaningful when individual accounts are tracked — same limitation
 * per-person RMD tracking itself already has (there's no person-level
 * granularity without it). Callers should include anyone at or above
 * `QCD_MIN_ELIGIBILITY_AGE` (constants.ts), not just people who've
 * already reached their RMD start age — QCD eligibility (70½) predates
 * SECURE 2.0's RMD-age delay (72/73/75), and the years before RMDs are
 * required are QCD's highest-value window for shrinking a future one.
 */
import { roundToCents } from "../../utils/math";
import { QCD_ANNUAL_CAP_PER_PERSON } from "../../constants";

export interface QcdPersonInput {
  personId: number;
  /** This person's Traditional balance held specifically in IRA-category
   *  accounts — the only portion eligible for QCD.
   *
   *  Timing note (advisor review, R46): the caller reads this balance
   *  live from `indBal` at QCD-computation time, before this year's
   *  growth runs (QCD runs first) — time-equivalent to the RMD
   *  snapshot's own timing for a fresh projection year. Pre-existing
   *  engine behavior, not introduced by this module. */
  iraTraditionalBalance: number;
}

export interface QcdPersonResult {
  personId: number;
  qcdAmount: number;
}

/**
 * Compute each person's QCD amount for the year. Returns only entries
 * with a positive amount. Empty array when `qcdMaximize` is off or no
 * person has an IRA Traditional balance to draw it from. Callers decide
 * who's eligible to pass in (age 70½+, per `QCD_MIN_ELIGIBILITY_AGE`) —
 * this function doesn't gate on age or RMD status itself.
 */
export function computeQcdAmounts(
  qcdMaximize: boolean,
  people: QcdPersonInput[],
): QcdPersonResult[] {
  if (!qcdMaximize) return [];
  return people
    .map((p) => ({
      personId: p.personId,
      qcdAmount: roundToCents(
        Math.max(
          0,
          Math.min(p.iraTraditionalBalance, QCD_ANNUAL_CAP_PER_PERSON),
        ),
      ),
    }))
    .filter((r) => r.qcdAmount > 0.01);
}

/** Sum of all per-person QCD amounts — the total to deduct from the
 *  household's aggregate IRA Traditional balance and to subtract from
 *  the RMD requirement `enforceRmd` still needs to satisfy via a real
 *  taxable distribution. */
export function totalQcdAmount(results: QcdPersonResult[]): number {
  return roundToCents(results.reduce((sum, r) => sum + r.qcdAmount, 0));
}
