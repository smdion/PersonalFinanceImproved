/**
 * Qualified Charitable Distributions: an RMD election applied before gross-up and routing, capped
 * by the IRA balance and the annual limit (IRC §408(d)(8)), not by the RMD. Eligibility starts at
 * `AGE_RULES.qcd` (70½), before RMD age; needs individual accounts.
 */
import { roundToCents } from "../../utils/math";

interface QcdPersonInput {
  personId: number;
  /** This person's Traditional balance in IRA-category accounts, the only QCD-eligible money,
   *  read live from `indBalance` before this year's growth. */
  iraTraditionalBalance: number;
}

interface QcdPersonResult {
  personId: number;
  qcdAmount: number;
}

/**
 * Each person's positive QCD amount for the year; empty when `qcdMaximize` is off or no one has
 * an IRA Traditional balance. Callers pass only eligible people (age is not gated here).
 */
export function computeQcdAmounts(
  qcdMaximize: boolean,
  people: QcdPersonInput[],
  /** The year's per-person QCD limit (`qcd_annual_limit`, grown). */
  annualLimitPerPerson: number,
): QcdPersonResult[] {
  if (!qcdMaximize) return [];
  return people
    .map((p) => ({
      personId: p.personId,
      qcdAmount: roundToCents(
        Math.max(0, Math.min(p.iraTraditionalBalance, annualLimitPerPerson)),
      ),
    }))
    .filter((r) => r.qcdAmount > 0.01);
}

/** Total QCD: deducted from the IRA Traditional aggregate and from the RMD `enforceRmd` must
 *  still satisfy with a taxable distribution. */
export function totalQcdAmount(results: QcdPersonResult[]): number {
  return roundToCents(results.reduce((sum, r) => sum + r.qcdAmount, 0));
}
