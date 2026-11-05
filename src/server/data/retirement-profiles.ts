import { asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";
import { resolveRetirementProfileIdFrom } from "@/lib/pure/household/retirement-profile";

/** Query-issuing convenience wrapper for callers that haven't already
 *  loaded app_settings and retirement_profiles. */
export async function resolveRetirementProfileId(
  db: DbOrTx,
): Promise<number | null> {
  // One after the other: callers pass open transactions, and a
  // PostgreSQL client runs one query at a time.
  const appSettings = await db.select().from(schema.appSettings);
  const profiles = await db
    .select()
    .from(schema.retirementProfiles)
    .orderBy(asc(schema.retirementProfiles.id));
  return resolveRetirementProfileIdFrom(appSettings, profiles);
}
