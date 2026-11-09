/** The active retirement profile's household settings row. */

import { asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import {
  pickProfileSettingsRow,
  resolveRetirementProfileIdFrom,
} from "@/lib/pure/household/retirement-profile";

/**
 * The settings row of the active retirement profile (unset or stale = the
 * lowest id), the primary person's within it (pickProfileSettingsRow).
 */
export async function loadActiveRetirementSettings(
  db: Db,
  appSettings: { key: string; value: unknown }[],
  primaryPersonId: number | null,
) {
  const [retSettings, retProfiles] = await Promise.all([
    db.select().from(schema.retirementSettings),
    db
      .select()
      .from(schema.retirementProfiles)
      .orderBy(asc(schema.retirementProfiles.id)),
  ]);
  return pickProfileSettingsRow(
    retSettings,
    resolveRetirementProfileIdFrom(appSettings, retProfiles),
    primaryPersonId,
  );
}
