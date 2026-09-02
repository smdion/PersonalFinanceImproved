/** Action-items section of the advisor report — recommendations derived
 *  from STRUCTURED engine/Monte Carlo fields only (irmaaCost,
 *  acaMagiHeadroom, acaSubsidyPreserved, rmdShortfallAmount/
 *  rmdExcessAmount, penaltyAvoidedShortfallRate), never by pattern-
 *  matching the free-form `warnings[]` strings — those have no typed
 *  link to this code and could drift silently if matched on text
 *  (RULES.md single-computation-path). The engine's own warnings are
 *  passed through separately, verbatim, as disclosures rather than
 *  parsed into recommendations. */
import type {
  ProjectionResult,
  EngineDecumulationYear,
} from "@/lib/calculators/types/engine-projection";
import type { MonteCarloResult } from "@/lib/calculators/types/monte-carlo";

export interface ActionItem {
  title: string;
  detail: string;
}

export interface ActionItemsSection {
  items: ActionItem[];
  /** Engine-generated warning strings, passed through verbatim — NOT
   *  parsed into recommendations above. Disclosure only. */
  disclosures: string[];
}

const PENALTY_SHORTFALL_RATE_THRESHOLD = 0.05;
const SUCCESS_RATE_THRESHOLD = 0.85;

export function buildActionItems(
  projectionResult: ProjectionResult,
  mcResult: MonteCarloResult,
  decumulationYears: EngineDecumulationYear[],
): ActionItemsSection {
  const items: ActionItem[] = [];

  if (mcResult.successRate < SUCCESS_RATE_THRESHOLD) {
    items.push({
      title: "Improve your plan's success rate",
      detail:
        "Your simulation succeeds in less than 85% of tested market conditions. Consider increasing your savings rate, reducing planned retirement spending, delaying retirement, or reviewing your investment allocation.",
    });
  }

  if (mcResult.penaltyAvoidedShortfallRate > PENALTY_SHORTFALL_RATE_THRESHOLD) {
    items.push({
      title: "Build more penalty-free money before retirement",
      detail: `In ${Math.round(mcResult.penaltyAvoidedShortfallRate * 100)}% of tested market conditions, this plan couldn't fully fund a year's spending without either taking a penalized early withdrawal or going short — building up Roth basis or taxable brokerage savings before age 59½ would give this plan more flexibility.`,
    });
  }

  const rmdShortfallYears = decumulationYears.filter(
    (y) => y.rmdShortfallAmount > 0,
  );
  if (rmdShortfallYears.length > 0) {
    items.push({
      title: "Review Required Minimum Distribution capacity",
      detail: `In ${rmdShortfallYears.length} year${rmdShortfallYears.length !== 1 ? "s" : ""}, this plan's Traditional accounts couldn't fully cover a required distribution — this can trigger a 25% excise tax on the shortfall. Consider Roth conversions in earlier years to reduce future Traditional balances.`,
    });
  }

  const acaLostYears = decumulationYears.filter(
    (y) => y.acaSubsidyPreserved === false,
  );
  if (acaLostYears.length > 0) {
    items.push({
      title: "Review income timing around your ACA subsidy cliff",
      detail: `Your ACA premium subsidy is projected to be lost in ${acaLostYears.length} year${acaLostYears.length !== 1 ? "s" : ""}. Adjusting withdrawal timing, Roth conversion amounts, or capital-gains realization in those years could help preserve it.`,
    });
  }

  return { items, disclosures: [...projectionResult.warnings] };
}
