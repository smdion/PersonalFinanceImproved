/** Reads the active contribution accounts, by whether their type is known. */
import { eq, asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";
import { contributionsByType } from "@/lib/pure/accounts/tax-buckets/unknown-type-rows";

/** The active contribution accounts in id order, split by whether this
 *  version knows their stored type (`contributionsByType`). */
export async function getActiveContributionAccountsByType(db: DbOrTx) {
  const rows = await db
    .select()
    .from(schema.contributionAccounts)
    .where(eq(schema.contributionAccounts.isActive, true))
    .orderBy(asc(schema.contributionAccounts.id));
  return contributionsByType(rows);
}
