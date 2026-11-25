/** A Roth conversion's room this year: the bracket target it fills to and the income under that target's top. */
import { roundToCents } from "../../utils/math";
import { incomeCapForMarginalRate } from "./tax-estimation";
import type { WithholdingBracket } from "./tax-estimation";
import { getAllCategories } from "../../config/account-types";
import type {
  AccountBalances,
  TaxBuckets,
} from "../accounts/account-balances.types";
import type { NonRetirementExclusion } from "@/lib/pure/accounts/eligibility";

/** The Traditional money a conversion can draw on: the pre-tax balance less Portfolio-parented
 *  Traditional, which isn't retirement money (with exclusion data; else all of it). */
export function convertiblePreTax(
  balances: Pick<TaxBuckets, "preTax">,
  accountBalance: AccountBalances,
  nonRetirement: NonRetirementExclusion | undefined,
): number {
  if (!nonRetirement) return balances.preTax;
  const excluded = getAllCategories().reduce((sum, category) => {
    if (accountBalance[category].structure !== "roth_traditional") return sum;
    return sum + nonRetirement.trad[category];
  }, 0);
  return roundToCents(balances.preTax - excluded);
}

/** A resolved conversion target of 0 turns conversions off, whichever setting it came from;
 *  routing's reservation and the conversion both read this. */
export const conversionOff = (target: number | undefined) => target === 0;

/** What routing's conversion reservation reads, as `performRothConversion` resolves it: the
 *  target (the year's override first), whether the year converts (`conversionOff`), and
 *  the Traditional it can draw on before this year's draws. */
export function conversionRoutingInputs(
  config: { rothConversionTarget?: number; rothBracketTarget?: number },
  taxRates: {
    enableRothConversions?: boolean;
    rothConversionTarget?: number;
    rothBracketTarget?: number;
  },
  source: Readonly<Parameters<typeof convertiblePreTax>>,
) {
  const conversionTarget =
    config.rothConversionTarget ??
    taxRates.rothConversionTarget ??
    config.rothBracketTarget ??
    taxRates.rothBracketTarget;
  return {
    conversionTarget,
    conversionsEnabled:
      taxRates.enableRothConversions && !conversionOff(conversionTarget),
    conversionSource: convertiblePreTax(...source),
  };
}

interface ConversionRoomInput {
  /** Conversions on: the household's own target's room is the floor under smoothing's. */
  enableRothConversions: boolean | undefined;
  /** The household's `rothConversionTarget` (it and its fallback never 0 here: 0 opts out before). */
  configTarget: number | undefined;
  rothBracketTarget: number | undefined;
  yearTaxableIncome: number;
  taxBrackets: WithholdingBracket[];
  standardDeduction?: number;
  /** This year's RMD-smoothing minimum; positive raises the target up to the ceiling. */
  rmdSmoothingTarget?: number;
  rmdSmoothingMaxBracketTarget?: number;
}

/** The target's room, rounded to cents (≥ 0); with smoothing, the smoothing target within that
 *  room, or the household's own room when larger. Null when there is no target at all. */
export function conversionRoomFor(input: ConversionRoomInput): number | null {
  const {
    yearTaxableIncome,
    taxBrackets,
    standardDeduction,
    rmdSmoothingTarget,
    rmdSmoothingMaxBracketTarget,
  } = input;
  const ownTarget = input.configTarget ?? input.rothBracketTarget;
  let conversionTarget = ownTarget;
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

  const roomUnder = (target: number) =>
    roundToCents(
      Math.max(
        0,
        incomeCapForMarginalRate(target, taxBrackets, standardDeduction) -
          yearTaxableIncome,
      ),
    );
  const room = roomUnder(conversionTarget);
  if (rmdSmoothingTarget === undefined || rmdSmoothingTarget <= 0) return room;
  // Smoothing converts its own target, up to income + target in a raised
  // bracket (never that bracket's top); a household converting on its own
  // keeps its own room as the floor.
  const ownRoom =
    input.enableRothConversions && ownTarget != null ? roomUnder(ownTarget) : 0;
  return Math.max(ownRoom, Math.min(rmdSmoothingTarget, room));
}
