import { storedInteger } from "@/lib/utils/stored-integer";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { SK_BUDGET_ACTIVE_COLUMN } from "@/lib/constants/settings-keys";
import { resolveProfileSelection } from "@/server/services/profile-selection";
import type { Db } from "@/lib/db";
import { resolveLinkedBudgetItemAmounts } from "./linked-items";
import { computeBudgetAnnualTotal } from "@/lib/pure/budget/annual-total";
import { resolveTargetBudgetProfile } from "@/server/data/budget-profiles";

/**
 * Optional override of which budget profile/column to read — lets a caller ask
 * "what would annual expenses be under profile X, column Y" instead of always
 * reading the globally-active profile + `budget_active_column` setting.
 */
export type BudgetTargeting = {
  budgetProfileId?: number | null;
  budgetColumn?: number | null;
};

export async function getAnnualExpensesFromBudget(
  db: Db,
  asOf: Date,
  targeting?: BudgetTargeting,
): Promise<number> {
  const settings = await db.select().from(schema.appSettings);
  const settingsMap = new Map(
    settings.map((s: { key: string; value: unknown }) => [s.key, s.value]),
  );

  // Use the shared budget_active_column setting (same as budget page, savings page, dashboard)
  const column =
    targeting?.budgetColumn ??
    storedInteger(settingsMap.get(SK_BUDGET_ACTIVE_COLUMN), 0);

  const profile = await resolveTargetBudgetProfile(
    db,
    targeting?.budgetProfileId,
  );
  if (!profile) return 0;
  const items = await db
    .select()
    .from(schema.budgetItems)
    .where(eq(schema.budgetItems.profileId, profile.id));

  const resolvedItems = await resolveLinkedBudgetItemAmounts(
    { db, scope: { asOf } },
    items,
    profile.columnLabels.length,
    await resolveProfileSelection({ db }),
  );

  return computeBudgetAnnualTotal(resolvedItems, column, profile);
}
