/** Writes of a Salary Profile's stored entries: each in one transaction, the profile read
 *  under its row lock (`lockedRow`). */
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";
import type { SalaryEntryMap } from "@/lib/pure/household/compensation";
import { checkSalaryEntries } from "@/lib/db/stored-salary-entries";
import { lockedRow } from "@/server/data/lock-row";

type SalaryProfileRow = typeof schema.salaryProfiles.$inferSelect;

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
