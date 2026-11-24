import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { planEndAge as planEndAgeOf } from "@/lib/pure/household/household-timeline";
import {
  classifyAssetClasses,
  stockShareByAge,
} from "@/lib/pure/simulation/stock-share";

/** The glide path's stock share at each age of the plan, which VPW sizes
 *  by, from the stored asset-class buckets. */
export async function simulationStockShareByAge(
  db: Db,
  baseEngineInput: Parameters<typeof planEndAgeOf>[0],
  glidePath: Parameters<typeof stockShareByAge>[0],
) {
  const classBuckets = await db.select().from(schema.assetClassBuckets);
  return (
    stockShareByAge(
      glidePath,
      classifyAssetClasses(classBuckets),
      baseEngineInput.currentAge,
      planEndAgeOf(baseEngineInput),
    ) ?? undefined
  );
}
