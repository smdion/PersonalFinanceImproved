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
  /**
   * `(1 + inflationRate) ^ (year - fplYear)` (the poverty levels'
   * coverage year, bracket-growth.ts `taxTableYears`) — grows the ACA
   * subsidy cliff (400% FPL) forward instead of holding it flat nominal.
   * REQUIRED, not optional: making this required rather than defaulting to
   * 1 means a future caller can't silently skip growth by omission. Growth
   * is applied at the single point of use
   * (`getAcaSubsidyCliff(householdSize, fplByHousehold) * fplGrowthFactor`)
   * — mathematically identical to growing each FPL cell first
   * (fpl*4*k === (fpl*k)*4). */
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

  // Grow the 400%-FPL cliff forward instead of holding it flat nominal —
  // mathematically identical to growing each FPL cell first and
  // multiplying by 4 after (fpl*4*k === (fpl*k)*4). `fplByHousehold` is
  // the coverage year's poverty levels.
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
    // A ranking change to avoid this was
    // considered and rejected — brokerage gains aren't actually "free" MAGI
    // below the cliff either (the premium tax credit phases out
    // continuously as MAGI rises toward 400% FPL), so preferring brokerage
    // over Roth basis would cost more than it saves. This warning instead
    // reports whether re-sourcing the overage from Roth (which doesn't
    // touch MAGI at all) would have kept the household under the cliff —
    // actionable information without the engine silently re-ordering
    // withdrawals against a value it can't fully price.
    const brokerageCouldCoverOverage = income.realizedGains >= overage;
    const attribution = brokerageCouldCoverOverage
      ? ` — sourcing $${overage.toFixed(0)} less from brokerage (and more from Roth) would keep MAGI under the cliff`
      : "";
    warnings.push(
      // Phase 4: acaCliff is now a grown (non-integer) float -- round
      // before formatting so this sentence doesn't mix cents (from a
      // grown cliff) with the whole-dollar MAGI/overage figures either
      // side of it.
      `ACA: MAGI $${projectedMagi.toFixed(0)} exceeds $${Math.round(acaCliff).toLocaleString()} cliff by $${overage.toFixed(0)} — subsidy lost${attribution}`,
    );
  }

  return { acaSubsidyPreserved, acaMagiHeadroom, warnings };
}
