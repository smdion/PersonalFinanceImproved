import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import { pickActiveBudgetProfile } from "@/lib/pure/budget/active-profile";

/**
 * The active budget profile; the only place that should query
 * `budget_profiles.is_active = true`. Undefined when no profile is active.
 */
export async function getActiveBudgetProfile(
  db: Db,
): Promise<typeof schema.budgetProfiles.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(schema.budgetProfiles)
    .where(eq(schema.budgetProfiles.isActive, true));
  return pickActiveBudgetProfile(rows);
}

/**
 * The profile a mutation should target: explicit `profileId` when given, else the
 * active one. Profile item/column mutations must use this, so an edit made while
 * viewing a non-active profile is not redirected onto the active one.
 */
export async function resolveTargetBudgetProfile(
  db: Db,
  profileId: number | null | undefined,
): Promise<typeof schema.budgetProfiles.$inferSelect | undefined> {
  if (profileId) {
    const rows = await db
      .select()
      .from(schema.budgetProfiles)
      .where(eq(schema.budgetProfiles.id, profileId));
    return rows[0];
  }
  return getActiveBudgetProfile(db);
}
