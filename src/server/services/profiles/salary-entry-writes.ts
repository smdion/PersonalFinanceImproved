/** Writes of a Salary Profile's stored entries: each in one transaction, the profile read
 *  under its row lock (`lockedRow`), and no new entry for a job that doesn't exist. */
import { eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@/lib/db/schema";
import { isPostgres, type DbOrTx } from "@/lib/db";
import type { SalaryEntryMap } from "@/lib/pure/household/compensation";
import { checkSalaryEntries } from "@/lib/db/stored-salary-entries";
import { lockedRow } from "@/server/data/lock-row";

type SalaryProfileRow = typeof schema.salaryProfiles.$inferSelect;

/** The ids of the jobs that exist, as Salary Profile keys; `keyShare` (PostgreSQL) holds
 *  them until the transaction ends, so a checked job can't be deleted before it commits. */
async function jobKeys(
  tx: DbOrTx,
  keys: readonly string[],
  keyShare: boolean,
): Promise<Set<string>> {
  const ids = keys.map(Number).filter(Number.isSafeInteger);
  if (ids.length === 0) return new Set();
  const query = tx
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(inArray(schema.jobs.id, ids));
  const rows = await (keyShare && isPostgres()
    ? query.for("key share")
    : query);
  return new Set(rows.map((r) => String(r.id)));
}

/** The jobs that exist among `keys`, read without a lock. */
export function existingJobKeys(
  tx: DbOrTx,
  keys: readonly string[],
): Promise<Set<string>> {
  return jobKeys(tx, keys, false);
}

/** BAD_REQUEST naming each key whose job doesn't exist; the rest stay key-share locked.
 *  Called before any profile lock (lock order: job, then salary profile). */
export async function refuseEntriesWithoutJobs(
  tx: DbOrTx,
  keys: readonly string[],
): Promise<void> {
  const jobs = await jobKeys(tx, keys, true);
  const missing = keys.filter((k) => !jobs.has(k));
  if (missing.length > 0)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `No job ${missing.join(", ")}: a Salary Profile entry needs its job.`,
    });
}

/** Renames a Salary Profile or replaces its entries, under its lock; NOT_FOUND when gone. */
export function updateSalaryProfile(
  db: DbOrTx,
  id: number,
  updates: Partial<typeof schema.salaryProfiles.$inferInsert>,
): Promise<SalaryProfileRow> {
  return db.transaction(async (tx) => {
    if (updates.salaries)
      await refuseEntriesWithoutJobs(tx, Object.keys(updates.salaries));
    if (!(await lockedRow(tx, schema.salaryProfiles, id)))
      throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });
    const [row] = await tx
      .update(schema.salaryProfiles)
      .set(updates)
      .where(eq(schema.salaryProfiles.id, id))
      .returning();
    return row!;
  });
}

/** Reads the profile's entries under its lock and writes what `change` returns (null leaves
 *  them; it may throw to refuse). NOT_FOUND when the profile is gone; returns the row. */
export function mergeSalaryEntries(
  db: DbOrTx,
  profileId: number,
  change: (salaries: SalaryEntryMap) => SalaryEntryMap | null,
): Promise<SalaryProfileRow> {
  return db.transaction(async (tx) => {
    const row = await lockedRow(tx, schema.salaryProfiles, profileId);
    if (!row)
      throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });
    const next = change(checkSalaryEntries(row).salaries);
    if (next === null) return row;
    const [updated] = await tx
      .update(schema.salaryProfiles)
      .set({ salaries: next })
      .where(eq(schema.salaryProfiles.id, profileId))
      .returning();
    return updated!;
  });
}
