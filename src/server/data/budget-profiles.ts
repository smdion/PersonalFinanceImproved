import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import { pickActiveBudgetProfile } from "@/lib/pure/budget/active-profile";

/**
 * The active budget profile — the only place that should query
 * `budget_profiles.is_active = true`. Returns undefined if none is active
 * (e.g. a crash mid-`setActiveProfile` before that mutation's transaction
 * fix, or before any profile has ever been created).
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
 * Resolve "the profile a mutation should target" — explicit `profileId` when
 * given (a client editing a profile it is viewing but hasn't made active),
 * else the active profile. The single place profile item/column mutations
 * (createItem, addColumn, removeColumn, renameColumn, updateColumnMonths,
 * reorderCategory)
 * should resolve their target profile — a bare `getActiveBudgetProfile(db)`
 * in one of those procedures silently redirects an edit made while viewing a
 * non-active profile onto the active one instead.
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
