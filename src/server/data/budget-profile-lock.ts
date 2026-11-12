import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";
import { lockedRow } from "@/server/data/lock-row";
import { resolveTargetBudgetProfile } from "@/server/data/budget-profiles";

/** The target profile (`profileId`, else the active one) read under its
 *  row lock in `tx`, so writes sized by its columns run one at a time;
 *  undefined when there is none. */
export async function lockedTargetBudgetProfile(
  tx: DbOrTx,
  profileId: number | undefined,
) {
  const target = await resolveTargetBudgetProfile(tx, profileId);
  return target && lockedRow(tx, schema.budgetProfiles, target.id);
}
