/** A projection run's household data and engine payload. */

import { engineProfileOptions } from "@/lib/pure/household/profile-selection";
import type { ProfileSelection } from "@/lib/pure/household/profile-selection.schema";
import {
  buildEnginePayload,
  fetchRetirementData,
} from "@/server/services/projection/engine-payload/build-engine-payload";
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
