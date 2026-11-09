/** Labels + descriptions for `withdrawalRoutingMode`, for every surface that names it. Always
 *  "Withdrawal Routing" (FROM WHICH accounts), never "Strategy": `withdrawalStrategy`
 *  (withdrawal-strategies.ts) is HOW MUCH to withdraw. */
import type { RoutingMode } from "@/lib/pure/engine/types";

export const WITHDRAWAL_ROUTING_MODES = [
  "bracket_filling",
  "waterfall",
  "percentage",
] as const satisfies readonly RoutingMode[];

/** The household-wide default when nothing else specifies one: the DB
 *  default of `retirement_settings.withdrawal_routing_mode`, and the
 *  projection form's starting value. */
export const DEFAULT_WITHDRAWAL_ROUTING_MODE: RoutingMode = "bracket_filling";

export const WITHDRAWAL_ROUTING_MODE_LABELS: Record<RoutingMode, string> = {
  bracket_filling: "Bracket Filling",
  waterfall: "Waterfall",
  percentage: "Percentage",
};

/** One clause per mode — this exact wording is what "Bracket Filling" (the
 *  engine mode) and "Tax-optimized" (what the comparison used to call the
 *  same mode) had drifted into having their own version of. */
export const WITHDRAWAL_ROUTING_MODE_DESCRIPTIONS: Record<RoutingMode, string> =
  {
    bracket_filling:
      "Tax-optimal: Traditional up to your bracket ceiling, then whichever of Roth, HSA or Brokerage (graduated LTCG) costs less that year. Includes RMDs, SS taxation, Roth conversions, and IRMAA/ACA awareness.",
    waterfall: "Drain accounts in a fixed priority order you set.",
    percentage: "Split withdrawals by fixed percentages across accounts.",
  };
