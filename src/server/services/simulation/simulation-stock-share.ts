import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import {
  planEndAge as planEndAgeOf,
  type PlanYears,
} from "@/lib/pure/household/household-timeline";
import {
  classifyAssetClasses,
  stockShareByAge,
} from "@/lib/pure/simulation/stock-share";
import type { GlidePathEntry } from "@/lib/pure/simulation/random";

/** The glide path's stock share at each age of the plan (VPW sizes by it). */
export async function simulationStockShareByAge(
  db: Db,
  plan: PlanYears,
  glidePath: GlidePathEntry[],
) {
  const classBuckets = await db.select().from(schema.assetClassBuckets);
  const classes = classifyAssetClasses(classBuckets);
  const toAge = planEndAgeOf(plan);
  return (
    stockShareByAge(glidePath, classes, plan.currentAge, toAge) ?? undefined
  );
}
