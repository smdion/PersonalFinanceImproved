/** A projection run's household data and engine payload, and what it reads
 *  beside them. */

import { engineProfileOptions } from "@/lib/pure/household/profile-selection";
import type { ProfileSelection } from "@/lib/pure/household/profile-selection.schema";
import {
  buildEnginePayload,
  fetchRetirementData,
} from "@/server/services/projection/engine-payload/build-engine-payload";
import {
  stockShareByAge,
  classifyAssetClasses,
} from "@/lib/pure/simulation/stock-share";
import type { Db } from "@/lib/db";

/**
 * The household's data and engine payload for a request's profile
 * selection and snapshot. The payload is returned as built (null,
 * notConfigured or ready): each caller keeps its own early returns.
 */
export async function prepareProjectionRun(
  db: Db,
  request: { selection?: ProfileSelection; snapshotId?: number },
) {
  const profiles = engineProfileOptions(request.selection);
  const data = await fetchRetirementData(db, {
    snapshotId: request.snapshotId,
    contributionProfileId: profiles.contributionProfileId,
    salaryProfileId: profiles.salaryProfileId,
  });
  const payload = await buildEnginePayload(db, data, {
    ...profiles,
  });
  return { profiles, data, payload };
}

/**
 * The stock allocation (percent, one decimal) the Default preset's glide
 * path assumes at `currentAge` — the same stock share VPW sizes by
 * (lib/pure/simulation/stock-share.ts: a class is stocks when any of its buckets is).
 * Null when there's no glide path or no class is mapped to buckets, so the
 * PlanHealthCard skips the glide-path warning.
 */
export function computeCurrentStockAllocationPercent(
  data: Pick<
    Awaited<ReturnType<typeof fetchRetirementData>>,
    "defaultPreset" | "classBucketRows"
  >,
  currentAge: number,
): number | null {
  const share = stockShareByAge(
    data.defaultPreset.glidePath,
    classifyAssetClasses(data.classBucketRows),
    currentAge,
    currentAge,
  )?.[Math.floor(currentAge)];
  return share === undefined ? null : Math.round(share * 1000) / 10;
}
