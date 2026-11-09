/** Advisor report action items, from structured engine and simulation fields only, never
 *  by matching `warnings[]` text; the engine's warnings pass through verbatim as
 *  disclosures. */
import type {
  ProjectionResult,
  EngineDecumulationYear,
} from "@/lib/pure/engine/types/index";
import type { MonteCarloResult } from "@/lib/pure/simulation/monte-carlo.types";

interface ActionItem {
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
      title: "Improve your projection's success rate",
      detail:
        "Your simulation succeeds in less than 85% of tested market conditions. Consider increasing your savings rate, lowering your Retirement budget, delaying retirement, or reviewing your investment allocation.",
    });
  }

  if (mcResult.penaltyAvoidedShortfallRate > PENALTY_SHORTFALL_RATE_THRESHOLD) {
    items.push({
      title: "Build more penalty-free money before retirement",
      detail: `In ${Math.round(mcResult.penaltyAvoidedShortfallRate * 100)}% of tested market conditions, this projection couldn't fully fund a year's spending without either taking a penalized early withdrawal or going short — building up Roth basis or taxable brokerage savings before age 59½ would give this projection more flexibility.`,
    });
  }

  const rmdShortfallYears = decumulationYears.filter(
    (y) => y.rmdShortfallAmount > 0,
  );
  if (rmdShortfallYears.length > 0) {
    items.push({
      title: "Review Required Minimum Distribution capacity",
      detail: `In ${rmdShortfallYears.length} year${rmdShortfallYears.length !== 1 ? "s" : ""}, this projection's Traditional accounts couldn't fully cover a required distribution — this can trigger a 25% excise tax on the shortfall. Consider Roth conversions in earlier years to reduce future Traditional balances.`,
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
