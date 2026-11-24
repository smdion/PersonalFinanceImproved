import type { Db } from "@/lib/db";
import {
  planEndAge as planEndAgeOf,
  type PlanYears,
} from "@/lib/pure/household/household-timeline";
import {
  interpolateAllocations,
  weightedGeometricRate,
  type GlidePathEntry,
  type WeightedAssetClass,
} from "@/lib/pure/simulation/random";
import { simulationStockShareByAge } from "./simulation-stock-share";

/** A base input run on the Simulation's returns: each age's geometric rate
 *  on the glide path, and the glide path's stock share by age (VPW). */
export async function simulationEngineInput<Base extends PlanYears>(
  db: Db,
  input: Base,
  glidePath: GlidePathEntry[],
  assetClasses: readonly WeightedAssetClass[],
) {
  const simulationReturnRates: { label: string; rate: number }[] = [];
  for (let a = input.currentAge; a <= planEndAgeOf(input); a++) {
    const allocations = interpolateAllocations(glidePath, a);
    const blended = weightedGeometricRate(assetClasses, allocations);
    simulationReturnRates.push({ label: `Age ${a}`, rate: blended });
  }
  return {
    ...input,
    returnRates: simulationReturnRates,
    stockShareByAge: await simulationStockShareByAge(db, input, glidePath),
  };
}
