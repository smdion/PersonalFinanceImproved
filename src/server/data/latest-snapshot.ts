/** The id of the latest portfolio snapshot, for the "latest only" guards. */

import { desc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";

/** The latest snapshot's id by date (dates are unique), or null for none. */
export async function getLatestSnapshotId(db: Db): Promise<number | null> {
  const [latest] = await db
    .select({ id: schema.portfolioSnapshots.id })
    .from(schema.portfolioSnapshots)
    .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
    .limit(1);
  return latest?.id ?? null;
}
