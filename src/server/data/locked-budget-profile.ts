import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";
import { lockRow } from "@/server/data/lock-row";

/** The profile's row, locked for a read-merge-write in `tx` (its columns
 *  and every item's amounts); undefined when it is gone. */
export async function lockedBudgetProfile(
  tx: DbOrTx,
  id: number,
): Promise<typeof schema.budgetProfiles.$inferSelect | undefined> {
  await lockRow(tx, schema.budgetProfiles, id);
  const [profile] = await tx
    .select()
    .from(schema.budgetProfiles)
    .where(eq(schema.budgetProfiles.id, id));
  return profile;
}
