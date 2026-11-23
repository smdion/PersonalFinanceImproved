/**
 * A version restore runs the data-converting tags a stored version is behind,
 * as a backup import does, shared by the SQLite and PostgreSQL files: a
 * version holding an empty table still gives that table to the converters
 * (the lump-sum-targets tag reads the empty snapshot table as none, not as
 * a missing one).
 *
 * Imports only types from the app (see ./backup-fence-cases).
 */
import { it, expect } from "vitest";
import { eq } from "drizzle-orm";
import type { FenceDb } from "./backup-fence-cases";
import pgJournal from "../../drizzle/meta/_journal.json";

const LUMP_SUM = {
  amount: 1000,
  targetAccount: "401k",
  taxType: "traditional",
  targetAccountName: "Invented 401k",
};

export function versionRestoreConverterCases(fresh: () => Promise<FenceDb>) {
  it("a restore from before the lump-sum-targets tag converts a household with no snapshot", async () => {
    const { db, done } = await fresh();
    try {
      const schema = await import("@/lib/db/schema");
      const { createVersion, restoreVersion } =
        await import("@/lib/db/backup/version-logic");
      const { LUMP_SUM_TARGETS_TAG } =
        await import("@/lib/db/migrate/v0111-lump-sum-targets");
      const tags = pgJournal.entries.map((e) => e.tag);
      const before = tags[tags.indexOf(LUMP_SUM_TARGETS_TAG) - 1]!;
      await db
        .insert(schema.people)
        .values({ name: "Invented Earner", dateOfBirth: "1985-06-15" });
      await db.insert(schema.performanceAccounts).values({
        institution: "Acme Funds",
        accountType: "401k",
        accountLabel: "Invented 401k",
        ownershipType: "individual",
        parentCategory: "Retirement",
      });
      await db
        .insert(schema.projectionOverrides)
        .values({ overrideType: "brokerage", overrides: [LUMP_SUM] });
      const version = await createVersion(db, {
        name: "before the tag",
        type: "manual",
        createdBy: "test",
      });
      await db
        .update(schema.stateVersions)
        .set({ schemaVersion: before })
        .where(eq(schema.stateVersions.id, version.id));

      await restoreVersion(db, version.id, { asAdmin: true, user: "Admin" });
      const [row] = await db.select().from(schema.projectionOverrides);
      expect(row!.overrides).toHaveLength(1);
      expect(row!.overrides[0]).toHaveProperty("targetPerformanceAccountId");
    } finally {
      await done();
    }
  });
}
