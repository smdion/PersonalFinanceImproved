/** What a projection run reads beside the engine payload. */

import { loadSimulationPreset } from "@/server/services/simulation/simulation-preset";
import { DEFAULT_SIMULATION } from "@/lib/constants";
import {
  stockShareByAge,
  classifyAssetClasses,
} from "@/lib/pure/simulation/stock-share";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";

/**
 * The stock allocation (percent, one decimal) the Default preset's glide
 * path assumes at `currentAge` — the same stock share VPW sizes by
 * (lib/pure/simulation/stock-share.ts: a class is stocks when any of its buckets is).
 * Null when there's no glide path or no class is mapped to buckets, so the
 * PlanHealthCard skips the glide-path warning.
 */
export async function computeCurrentStockAllocationPercent(
  db: Db,
  currentAge: number,
): Promise<number | null> {
  const [preset, bucketRows] = await Promise.all([
    loadSimulationPreset(db, DEFAULT_SIMULATION.preset),
    db.select().from(schema.assetClassBuckets),
  ]);
  const share = stockShareByAge(
    preset.glidePath,
    classifyAssetClasses(bucketRows),
    currentAge,
    currentAge,
  )?.[Math.floor(currentAge)];
  return share === undefined ? null : Math.round(share * 1000) / 10;
}
