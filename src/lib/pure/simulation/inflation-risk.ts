import { DEFAULT_SIMULATION_INFLATION_RISK } from "@/lib/constants";

/** The saved Simulation inflation override (Simulation assumptions). */
export type SavedInflationOverrides = { stdDev?: number } | null;

/**
 * The Simulation's inflation risk — the spread of each year's inflation
 * around the plan's own rates — for every route that runs trials (the
 * Simulation, strategy comparison, Coast FIRE and its probe): this run's
 * UI override, else the saved override, else the preset's, else the
 * default. One resolver, so no route quietly ignores the household's
 * setting.
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
