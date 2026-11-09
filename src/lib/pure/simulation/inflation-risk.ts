import { DEFAULT_SIMULATION_INFLATION_RISK } from "@/lib/constants";

/** The saved Simulation inflation override (Simulation assumptions). */
export type SavedInflationOverrides = { stdDev?: number } | null;

/**
 * The Simulation's inflation risk (spread of each year's inflation around the plan's rates) for
 * every route that runs trials: this run's UI override, else the saved override, else the
 * preset's, else the default.
 */
export function resolveInflationRisk(opts: {
  ui?: { stdDev: number } | null;
  saved: SavedInflationOverrides;
  presetStdDev?: number | null;
}): { stdDev: number } {
  return {
    stdDev:
      opts.ui?.stdDev ??
      opts.saved?.stdDev ??
      opts.presetStdDev ??
      DEFAULT_SIMULATION_INFLATION_RISK.stdDev,
  };
}
