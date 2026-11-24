/** A Roth conversion's room this year: the bracket target it fills to and the income under that target's top. */
import { roundToCents } from "../../utils/math";
import { incomeCapForMarginalRate } from "./tax-estimation";
import type { WithholdingBracket } from "./tax-estimation";

interface ConversionRoomInput {
  /** The household's `rothConversionTarget` (never 0 here: 0 opts out before). */
  configTarget: number | undefined;
  rothBracketTarget: number | undefined;
  yearTaxableIncome: number;
  taxBrackets: WithholdingBracket[];
  standardDeduction?: number;
  /** This year's RMD-smoothing minimum; positive raises the target up to the ceiling. */
  rmdSmoothingTarget?: number;
  rmdSmoothingMaxBracketTarget?: number;
}

/** The target's room, rounded to cents (≥ 0); null when the household has no target and
 *  smoothing supplies none. */
export function conversionRoomFor(input: ConversionRoomInput): number | null {
  const {
    yearTaxableIncome,
    taxBrackets,
    standardDeduction,
    rmdSmoothingTarget,
    rmdSmoothingMaxBracketTarget,
  } = input;
  let conversionTarget = input.configTarget ?? input.rothBracketTarget;
  if (rmdSmoothingTarget !== undefined && rmdSmoothingTarget > 0) {
    // The lowest marginal rate whose cap fits this year's income plus the
    // smoothing target (incomeCapForMarginalRate over each bracket, in
    // order). The top bracket's cap is Infinity, so some rate always fits.
    const neededIncome = yearTaxableIncome + rmdSmoothingTarget;
    let minimumRateNeeded: number | undefined;
    for (const b of taxBrackets) {
      if (
        incomeCapForMarginalRate(b.rate, taxBrackets, standardDeduction) >=
        neededIncome
      ) {
        minimumRateNeeded = b.rate;
        break;
      }
    }
    if (minimumRateNeeded != null) {
      // Can only RAISE the effective ceiling above whatever the household
      // already configured, never lower it -- a household already above
      // rmdSmoothingMaxBracketTarget keeps their own higher target.
      const effectiveCeiling = Math.max(
        conversionTarget ?? -Infinity,
        rmdSmoothingMaxBracketTarget ?? -Infinity,
      );
      conversionTarget = Math.min(
        Math.max(conversionTarget ?? -Infinity, minimumRateNeeded),
        effectiveCeiling,
      );
    }
  }
  if (conversionTarget == null) return null;

  const bracketCap = incomeCapForMarginalRate(
    conversionTarget,
    taxBrackets,
    standardDeduction,
  );
  return roundToCents(Math.max(0, bracketCap - yearTaxableIncome));
}
