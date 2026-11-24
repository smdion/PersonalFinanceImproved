import type { Db } from "@/lib/db";
import { planEndAge as planEndAgeOf } from "@/lib/pure/household/household-timeline";
import {
  interpolateAllocations,
  weightedGeometricRate,
} from "@/lib/pure/simulation/random";
import { simulationStockShareByAge } from "./simulation-stock-share";

/** A base input run on the Simulation's returns: each age's geometric rate
 *  on the glide path, and the glide path's stock share by age (VPW). */
export async function simulationEngineInput<
  Base extends Parameters<typeof planEndAgeOf>[0] & { currentAge: number },
>(
  db: Db,
  baseEngineInput: Base,
  glidePath: Parameters<typeof interpolateAllocations>[0],
  assetClasses: Parameters<typeof weightedGeometricRate>[0],
) {
  const simulationReturnRates: { label: string; rate: number }[] = [];
  for (
    let a = baseEngineInput.currentAge;
    a <= planEndAgeOf(baseEngineInput);
    a++
  ) {
    const allocations = interpolateAllocations(glidePath, a);
    const blended = weightedGeometricRate(assetClasses, allocations);
    simulationReturnRates.push({ label: `Age ${a}`, rate: blended });
  }
  return {
    ...baseEngineInput,
    returnRates: simulationReturnRates,
    stockShareByAge: await simulationStockShareByAge(
      db,
      baseEngineInput,
      glidePath,
    ),
  };
}
