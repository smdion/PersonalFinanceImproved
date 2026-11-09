/** ACA: checks if MAGI crosses the ACA subsidy cliff (pre-65 retirees). */
import { roundToCents } from "../../utils/math";
import { getAcaSubsidyCliff } from "../../config/aca-tables";
import type { MagiIncome } from "@/lib/pure/tax/year-income";

export interface AcaInput {
  enableAcaAwareness: boolean | undefined;
  /** Whether ALL household members are <65. */
  allPersonsUnder65: boolean;
  householdSize: number;
  /** The year's income; ACA's MAGI adds the whole Social Security benefit. */
  income: MagiIncome<"aca">;
  /** `(1 + inflationRate) ^ (year - fplYear)` (bracket-growth.ts `taxTableYears`); grows the
   *  400%-FPL cliff forward. Required so no caller skips growth by omission. */
  fplGrowthFactor: number;
  /** The coverage year's poverty levels (`fpl_by_household`). */
  fplByHousehold: Record<number, number>;
}

interface AcaResult {
  acaSubsidyPreserved: boolean;
  acaMagiHeadroom: number;
  warnings: string[];
}

/**
 * Check if projected MAGI stays below the ACA subsidy cliff.
 * Reports headroom and warns if cliff is exceeded.
 */
export function checkAca(input: AcaInput): AcaResult {
  const {
    enableAcaAwareness,
    allPersonsUnder65,
    householdSize,
    income,
    fplGrowthFactor,
    fplByHousehold,
  } = input;

  const warnings: string[] = [];

  if (!enableAcaAwareness || !allPersonsUnder65) {
    return { acaSubsidyPreserved: false, acaMagiHeadroom: 0, warnings };
  }

  // Grow the 400%-FPL cliff forward (same as growing each FPL cell first);
  // `fplByHousehold` is the coverage year's poverty levels.
  const acaCliff =
    getAcaSubsidyCliff(householdSize, fplByHousehold) * fplGrowthFactor;
  // Today's term order (float ties at the cliff); yearMagi once it rounds to cents.
  const projectedMagi =
    income.traditionalDraws +
    income.rothConversions +
    income.realizedGains +
    income.rothTaxableGrowth +
    income.socialSecurity.gross;
  const acaMagiHeadroom = roundToCents(Math.max(0, acaCliff - projectedMagi));
  const acaSubsidyPreserved = projectedMagi < acaCliff;

  if (!acaSubsidyPreserved) {
    const overage = roundToCents(projectedMagi - acaCliff);
    // Brokerage gains also erode the premium credit below the cliff, so the
    // engine doesn't re-rank withdrawals; it reports whether sourcing the
    // overage from Roth (no MAGI) would have stayed under the cliff.
    const brokerageCouldCoverOverage = income.realizedGains >= overage;
    const attribution = brokerageCouldCoverOverage
      ? ` — sourcing $${overage.toFixed(0)} less from brokerage (and more from Roth) would keep MAGI under the cliff`
      : "";
    warnings.push(
      // acaCliff is a grown (non-integer) float: round it so this sentence
      // doesn't mix cents with the whole-dollar MAGI/overage figures
      // either side of it.
      `ACA: MAGI $${projectedMagi.toFixed(0)} exceeds $${Math.round(acaCliff).toLocaleString()} cliff by $${overage.toFixed(0)} — subsidy lost${attribution}`,
    );
  }

  return { acaSubsidyPreserved, acaMagiHeadroom, warnings };
}
