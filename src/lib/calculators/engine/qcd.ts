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
 * Approximation (documented, not IRS-exact): the engine's RMD calculation
 * pools ALL pre-tax accounts (401k + IRA + 403b) into one per-person
 * Traditional balance — it does not model the IRS's real per-account-type
 * RMD math (all IRAs aggregated one way, each 401k calculated separately).
 * Since QCDs are IRA-only, this module caps the QCD-eligible amount at
 * `min(cap, personRmdAmount, personIraTraditionalBalance)` rather than
 * attempting a full per-account-type RMD split, which this engine doesn't
 * do anywhere today. See PLAN-rmd-excess-handling.md for the full
 * rationale.
 *
 * Only meaningful when individual accounts are tracked — same limitation
 * per-person RMD tracking itself already has (there's no person-level
 * granularity without it).
 */
import { roundToCents } from "../../utils/math";
import { QCD_ANNUAL_CAP_PER_PERSON } from "../../constants";

export interface QcdPersonInput {
  personId: number;
  /** This person's RMD requirement for the year, already computed
   *  (pooled across all their pre-tax accounts). */
  rmdAmount: number;
  /** This person's Traditional balance held specifically in IRA-category
   *  accounts — the only portion eligible for QCD.
   *
   *  Timing note (advisor review, R46): `rmdAmount` is derived from
   *  `priorYearEndTradByPerson`, a snapshot taken before this year's
   *  `applyIndividualGrowth` runs, while the caller reads this balance
   *  live from `indBal` at QCD-computation time (also before this year's
   *  growth, since QCD runs first) — the two are time-equivalent for a
   *  fresh projection year. Pre-existing engine behavior, not introduced
   *  by this cap; noted here since QCD is the first feature to actually
   *  depend on the two being comparable. */
  iraTraditionalBalance: number;
}

export interface QcdPersonResult {
  personId: number;
  qcdAmount: number;
}

/**
 * Compute each person's QCD amount for the year. Returns only entries
 * with a positive amount. Empty array when `qcdMaximize` is off or no
 * person has both an RMD and IRA Traditional balance to draw it from.
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
          Math.min(
            p.rmdAmount,
            p.iraTraditionalBalance,
            QCD_ANNUAL_CAP_PER_PERSON,
          ),
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
