/** ACA: checks if MAGI crosses the ACA subsidy cliff (pre-65 retirees). */
import { roundToCents } from "../../utils/math";
import { getAcaSubsidyCliff } from "../../config/aca-tables";
import { yearMagi, type MagiIncome } from "@/lib/pure/tax/year-income";
import type { AcaStatus } from "./types/projection-result";

export interface AcaInput {
  enableAcaAwareness: boolean | undefined;
  /** Whether anyone in the household is under 65. Medicare ends the credit
   *  only for the person on it (IRC 36B(c)(2)(B); Reg. 1.36B-2(c)(2)), so a
   *  spouse under 65 is still checked, on the household's whole income. */
  anyPersonUnder65: boolean;
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
  acaStatus: AcaStatus;
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
    anyPersonUnder65,
    householdSize,
    income,
    fplGrowthFactor,
    fplByHousehold,
  } = input;

  const warnings: string[] = [];

  if (!enableAcaAwareness || !anyPersonUnder65) {
    return { acaStatus: "not_checked", acaMagiHeadroom: 0, warnings };
  }

  // Grow the 400%-FPL cliff forward (same as growing each FPL cell first);
  // `fplByHousehold` is the coverage year's poverty levels.
  const acaCliff =
    getAcaSubsidyCliff(householdSize, fplByHousehold) * fplGrowthFactor;
  const projectedMagi = yearMagi(income, "aca");
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

  return {
    acaStatus: acaSubsidyPreserved ? "kept" : "lost",
    acaMagiHeadroom,
    warnings,
  };
}
