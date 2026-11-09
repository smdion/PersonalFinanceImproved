import {
  type SimulationPreset,
  loadSimulationPreset,
  presetAssetClasses,
} from "./simulation-preset";
import type { SimulationPresetKey } from "@/lib/constants";
import { glidePathFromRows } from "@/lib/pure/simulation/stock-share";
import {
  type SimulationNotConfigured,
  simulationNotConfigured,
} from "@/lib/pure/simulation/monte-carlo";
import { eq, asc } from "drizzle-orm";
import { toNumber } from "@/lib/utils/numbers";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import {
  resolveInflationRisk,
  type SavedInflationOverrides,
} from "@/lib/pure/simulation/inflation-risk";

/** Read the saved inflation override (null when none is saved). */
export async function loadSavedInflationOverrides(
  db: Db,
): Promise<SavedInflationOverrides> {
  const row = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "mc_inflation_overrides"))
    .then((r) => r[0] ?? null);
  const value = (row?.value ?? null) as { stdDev?: unknown } | null;
  return value && typeof value.stdDev === "number"
    ? { stdDev: value.stdDev }
    : null;
}

/**
 * The Simulation's inputs (asset classes, correlations, glide path, inflation risk) under
 * `presetKey`; without one, the raw table values (computeMonteCarloProjection applies the
 * run's preset itself, with the run's asset-class changes on top).
 */
export async function buildSimulationInputs(
  db: Db,
  presetKey?: SimulationPresetKey,
): Promise<{
  mcAssetClasses: {
    id: number;
    name: string;
    meanReturn: number;
    stdDev: number;
  }[];
  mcCorrelations: { classAId: number; classBId: number; correlation: number }[];
  mcGlidePath: { age: number; allocations: Record<number, number> }[];
  effectiveInflationRisk: { stdDev: number };
  /** The preset used; null without `presetKey`. */
  preset: SimulationPreset | null;
  /** Why these inputs can't run a Simulation (simulationNotConfigured),
   *  or null when they can. */
  notConfigured: SimulationNotConfigured | null;
  /** Raw saved inflation override — null if none saved. Callers that surface
   *  this to the client (e.g. computeMonteCarloProjection) use this as-is. */
  savedInflationOverrides: SavedInflationOverrides;
}> {
  const [
    assetClasses,
    assetCorrelations,
    glidePathRows,
    savedInflationOverrides,
    preset,
  ] = await Promise.all([
    db
      .select()
      .from(schema.assetClassParams)
      .where(eq(schema.assetClassParams.isActive, true))
      .orderBy(asc(schema.assetClassParams.sortOrder)),
    db.select().from(schema.assetClassCorrelations),
    db.select().from(schema.glidePathAllocations),
    loadSavedInflationOverrides(db),
    presetKey ? loadSimulationPreset(db, presetKey) : Promise.resolve(null),
  ]);

  const rawClasses = assetClasses.map((ac) => ({
    id: ac.id,
    name: ac.name,
    meanReturn: toNumber(ac.meanReturn),
    stdDev: toNumber(ac.stdDev),
  }));
  const mcAssetClasses = preset
    ? presetAssetClasses(rawClasses, preset)
    : rawClasses;

  const mcCorrelations = assetCorrelations.map((c) => ({
    classAId: c.classAId,
    classBId: c.classBId,
    correlation: toNumber(c.correlation),
  }));

  const mcGlidePath = preset?.glidePath ?? glidePathFromRows(glidePathRows);

  const effectiveInflationRisk = resolveInflationRisk({
    saved: savedInflationOverrides,
    presetStdDev: preset?.inflationStdDev ?? null,
  });

  return {
    mcAssetClasses,
    mcCorrelations,
    mcGlidePath,
    effectiveInflationRisk,
    preset,
    notConfigured: simulationNotConfigured(preset, mcAssetClasses, mcGlidePath),
    savedInflationOverrides,
  };
}
