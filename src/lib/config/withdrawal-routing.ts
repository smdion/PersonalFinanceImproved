/**
 * Withdrawal routing mode — labels + descriptions, one source for every
 * surface that names or explains `withdrawalRoutingMode` ("bracket_filling"
 * | "waterfall" | "percentage"): the Retirement page's Withdrawal Routing
 * panel (decumulation-config.tsx), the Taxes-in-Retirement profile section
 * (persisted default), and the Tax Optimization withdrawal-strategy
 * comparison. Previously each hand-wrote its own copy — the comparison
 * page's own label, "Tax-optimized," appeared nowhere else, which is why a
 * user who saw it win there had no way to find or set it on their profile.
 *
 * "Withdrawal Routing" (not "Withdrawal Strategy") deliberately, everywhere
 * — `withdrawalStrategy` (Guyton-Klinger, fixed, etc., `withdrawal-
 * strategies.ts`) is a DIFFERENT, already-named concept: HOW MUCH to
 * withdraw each year. This governs FROM WHICH accounts. Reusing "Strategy"
 * for both is how the naming split happened in the first place.
 */
import type { RoutingMode } from "@/lib/calculators/types";

export const WITHDRAWAL_ROUTING_MODES = [
  "bracket_filling",
  "waterfall",
  "percentage",
] as const satisfies readonly RoutingMode[];

/** The household-wide default when nothing else specifies one — matches
 *  `retirement_settings.withdrawal_routing_mode`'s DB default and
 *  `decumulationDefaultsInputSchema`'s hardcoded fallback in `_shared.ts`.
 *  Single source so the three can't drift to different literals. */
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
      "Tax-optimal: Traditional up to your bracket ceiling, then whichever of Roth or Brokerage (graduated LTCG) costs less that year, HSA last. Includes RMDs, SS taxation, Roth conversions, and IRMAA/ACA awareness.",
    waterfall: "Drain accounts in a fixed priority order you set.",
    percentage: "Split withdrawals by fixed percentages across accounts.",
  };

export function withdrawalRoutingModeLabel(mode: RoutingMode): string {
  return WITHDRAWAL_ROUTING_MODE_LABELS[mode];
}
