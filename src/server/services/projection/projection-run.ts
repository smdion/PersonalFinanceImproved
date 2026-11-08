/** A projection run's household data and engine payload. */

import { engineProfileOptions } from "@/lib/pure/household/profile-selection";
import type { ProfileSelection } from "@/lib/pure/household/profile-selection.schema";
import { buildEnginePayload } from "@/server/services/projection/engine-payload/build-engine-payload";
import { fetchRetirementData } from "@/server/services/projection/engine-payload/load";
import type { Db } from "@/lib/db";
import type { RequestScope } from "@/server/data/request-scope";

/**
 * The household's data and engine payload for a request's profile
 * selection and snapshot. The payload is returned as built (null,
 * notConfigured or ready): each caller keeps its own early returns.
 */
export async function prepareProjectionRun(
  { db, scope }: { db: Db; scope: RequestScope },
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
    asOf: scope.asOf,
  });
  return { profiles, data, payload };
}
