/** Deleting jobs together with their Salary Profile entries. */
import { asc, eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";
import { lockedRow } from "@/server/data/lock-row";

/** Deletes `jobIds` and their entries from every Salary Profile (each read under its lock,
 *  ascending) in one transaction (a savepoint inside a running one), so no profile keeps an
 *  entry for a job that is gone. Entries go by key, never parsed. */
export async function deleteJobsAndEntries(
  db: DbOrTx,
  jobIds: readonly number[],
): Promise<void> {
  if (jobIds.length === 0) return;
  const gone = new Set(jobIds.map(String));
  await db.transaction(async (tx) => {
    // Jobs first: a writer holding a job's key-share lock commits before the profiles are read.
    await tx.delete(schema.jobs).where(inArray(schema.jobs.id, [...jobIds]));
    const profiles = await tx
      .select({ id: schema.salaryProfiles.id })
      .from(schema.salaryProfiles)
      .orderBy(asc(schema.salaryProfiles.id));
    for (const { id } of profiles) {
      const profile = await lockedRow(tx, schema.salaryProfiles, id);
      if (!profile) continue;
      const entries = Object.entries(profile.salaries);
      const kept = entries.filter(([jobId]) => !gone.has(jobId));
      if (kept.length < entries.length)
        await tx
          .update(schema.salaryProfiles)
          .set({ salaries: Object.fromEntries(kept) })
          .where(eq(schema.salaryProfiles.id, id));
    }
  });
}
