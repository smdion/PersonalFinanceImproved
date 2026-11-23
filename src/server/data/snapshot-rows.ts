import { asc, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";

/** A snapshot's rows by id, the order they were saved and the one
 *  `getLatestSnapshot` lists: a sum over them adds in one order on either
 *  database, where PostgreSQL's scan order drifts after an update. */
export async function getSnapshotRows(db: DbOrTx, snapshotId: number) {
  return db
    .select()
    .from(schema.portfolioAccounts)
    .where(eq(schema.portfolioAccounts.snapshotId, snapshotId))
    .orderBy(asc(schema.portfolioAccounts.id));
}
