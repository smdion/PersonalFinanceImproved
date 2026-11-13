/** ACA: checks if MAGI crosses the ACA subsidy cliff (pre-65 retirees). */
import { roundToCents } from "../../utils/math";
import { getAcaSubsidyCliff } from "../../config/aca-tables";
import { yearMagi, type MagiIncome } from "@/lib/pure/tax/year-income";
import type { EngineDecumulationYear } from "./types/projection-result";

export interface AcaInput {
  enableAcaAwareness: boolean | undefined;
  /** Anyone under 65 (Medicare ends the credit only for the person on it). */
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
  acaStatus: EngineDecumulationYear["acaStatus"];
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
  const acaStatus = projectedMagi < acaCliff ? "kept" : "lost";

  if (acaStatus === "lost") {
    const overage = roundToCents(projectedMagi - acaCliff);
    // Brokerage gains also erode the premium credit below the cliff, so the
    // engine doesn't re-rank withdrawals; it reports whether sourcing the
    // overage from Roth (no MAGI) would have stayed under the cliff.
    const brokerageCouldCoverOverage = income.realizedGains >= overage;
    const attribution = brokerageCouldCoverOverage
      ? ` — sourcing $${overage.toFixed(0)} less from brokerage (and more from Roth) would keep MAGI under the cliff`
      : "";
    warnings.push(
      // acaCliff is a grown float: round it to match the whole-dollar
      // MAGI/overage figures either side of it.
      `ACA: MAGI $${projectedMagi.toFixed(0)} exceeds $${Math.round(acaCliff).toLocaleString()} cliff by $${overage.toFixed(0)} — subsidy lost${attribution}`,
    );
  }

  return { acaStatus, acaMagiHeadroom, warnings };
}
