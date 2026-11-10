/**
 * A backup's closed-set values on import and restore, shared by the SQLite
 * and PostgreSQL fence files: an unknown value in a column with a default
 * takes it, with a note; one in a column without refuses the whole import
 * or restore, and nothing is written. Each file supplies `fresh()`.
 *
 * Imports only types from the app (see ./backup-fence-cases).
 */
import { it, expect } from "vitest";
import type { FenceDb } from "./backup-fence-cases";

type Db = FenceDb["db"];
type Backup = { tables: Record<string, Record<string, unknown>[]> };

const admin = { asAdmin: true };

async function app() {
  const schema = await import("@/lib/db/schema");
  const versions = await import("@/lib/db/backup/version-logic");
  const { ClosedSetRefusal } =
    await import("@/lib/db/backup/closed-set-columns");
  return { schema, ClosedSetRefusal, ...versions };
}

/** An invented household: one person, their retirement settings, a savings
 *  goal and a 401(k). */
async function household(db: Db) {
  const { schema } = await app();
  const [person] = await db
    .insert(schema.people)
    .values({ name: "Robin", dateOfBirth: "1985-06-15" })
    .returning();
  await db.insert(schema.retirementSettings).values({
    personId: person!.id,
    retirementAge: 62,
    endAge: 92,
    returnAfterRetirement: "0.05",
    annualInflation: "0.025",
    salaryAnnualIncrease: "0.03",
    withdrawalStrategy: "guyton_klinger",
  });
  await db
    .insert(schema.savingsGoals)
    .values({ name: "Roof", targetMode: "ongoing" });
  await db.insert(schema.performanceAccounts).values({
    institution: "Acme Funds",
    accountType: "401k",
    accountLabel: "Robin 401k",
    ownershipType: "individual",
    parentCategory: "Retirement",
  });
}

/** What the household holds now, for an all-or-nothing check. */
async function stored(db: Db) {
  const { schema } = await app();
  return {
    settings: (await db.select().from(schema.retirementSettings)).map(
      (r) => r.withdrawalStrategy,
    ),
    goals: (await db.select().from(schema.savingsGoals)).map((g) => [
      g.name,
      g.targetMode,
    ]),
    accounts: (await db.select().from(schema.performanceAccounts)).map(
      (a) => a.accountType,
    ),
  };
}

function setAll(backup: Backup, table: string, column: string, value: unknown) {
  for (const row of backup.tables[table]!) row[column] = value;
}

export function closedSetImportCases(fresh: () => Promise<FenceDb>) {
  it("an import takes a column's default for a value Ledgr doesn't have, and notes it", async () => {
    const { db, done } = await fresh();
    try {
      const { exportBackup, importBackup } = await app();
      await household(db);
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db)),
      ) as Backup;
      setAll(
        backup,
        "retirement_settings",
        "withdrawal_strategy",
        "retired_strategy",
      );
      setAll(backup, "savings_goals", "target_mode", "Ongoing");

      const result = await importBackup(db, backup as never, admin);
      // In the backup's table order.
      expect(result.valueNotes).toEqual([
        {
          table: "savings_goals",
          column: "target_mode",
          value: "Ongoing",
          rows: 1,
          defaultedTo: "fixed",
        },
        {
          table: "retirement_settings",
          column: "withdrawal_strategy",
          value: "retired_strategy",
          rows: 1,
          defaultedTo: "fixed",
        },
      ]);
      expect(await stored(db)).toEqual({
        settings: ["fixed"],
        goals: [["Roof", "fixed"]],
        accounts: ["401k"],
      });
    } finally {
      await done();
    }
  });

  it("an import with an unknown account type is refused, and nothing is written", async () => {
    const { db, done } = await fresh();
    try {
      const { exportBackup, importBackup, ClosedSetRefusal } = await app();
      await household(db);
      const before = await stored(db);
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db)),
      ) as Backup;
      setAll(backup, "performance_accounts", "account_type", "solo401k");
      setAll(
        backup,
        "retirement_settings",
        "withdrawal_strategy",
        "retired_strategy",
      );
      setAll(backup, "savings_goals", "name", "Changed by the backup");

      const refused = importBackup(db, backup as never, admin);
      await expect(refused).rejects.toBeInstanceOf(ClosedSetRefusal);
      await expect(refused).rejects.toThrow(
        'performance_accounts.account_type = "solo401k" (1 row)',
      );
      expect(await stored(db)).toEqual(before);
    } finally {
      await done();
    }
  });

  it("a restore of a version holding an unknown value takes the default, with a note", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, createVersion, restoreVersion } = await app();
      await household(db);
      const version = await createVersion(db, {
        name: "with a retired strategy",
        type: "manual",
        createdBy: "test",
      });
      await setVersionValue(
        db,
        schema,
        version.id,
        "retirement_settings",
        "withdrawal_strategy",
        "retired_strategy",
      );

      const result = await restoreVersion(db, version.id, admin);
      expect(result.valueNotes).toEqual([
        {
          table: "retirement_settings",
          column: "withdrawal_strategy",
          value: "retired_strategy",
          rows: 1,
          defaultedTo: "fixed",
        },
      ]);
      expect((await stored(db)).settings).toEqual(["fixed"]);
    } finally {
      await done();
    }
  });

  it("a restore of a version holding an unknown account type is refused, and today's data stays", async () => {
    const { db, done } = await fresh();
    try {
      const { schema, createVersion, restoreVersion, ClosedSetRefusal } =
        await app();
      await household(db);
      const version = await createVersion(db, {
        name: "with an unknown account type",
        type: "manual",
        createdBy: "test",
      });
      await setVersionValue(
        db,
        schema,
        version.id,
        "performance_accounts",
        "account_type",
        "solo401k",
      );
      await db.update(schema.savingsGoals).set({ name: "Today's goal" });
      const before = await stored(db);

      await expect(
        restoreVersion(db, version.id, admin),
      ).rejects.toBeInstanceOf(ClosedSetRefusal);
      expect(await stored(db)).toEqual(before);
    } finally {
      await done();
    }
  });
}

/** Rewrites one column of a stored version's table data. */
async function setVersionValue(
  db: Db,
  schema: Awaited<ReturnType<typeof app>>["schema"],
  versionId: number,
  table: string,
  column: string,
  value: unknown,
) {
  const { and, eq } = await import("drizzle-orm");
  const where = and(
    eq(schema.stateVersionTables.versionId, versionId),
    eq(schema.stateVersionTables.tableName, table),
  );
  const [entry] = await db
    .select()
    .from(schema.stateVersionTables)
    .where(where);
  const rows = (entry!.data as Record<string, unknown>[]).map((r) => ({
    ...r,
    [column]: value,
  }));
  await db.update(schema.stateVersionTables).set({ data: rows }).where(where);
}

/** An invented snapshot holding one 401(k) row. */
async function snapshot(db: Db) {
  const { schema } = await app();
  const [snap] = await db
    .insert(schema.portfolioSnapshots)
    .values({ snapshotDate: "2026-06-30" })
    .returning();
  await db.insert(schema.portfolioAccounts).values({
    snapshotId: snap!.id,
    institution: "Acme Funds",
    taxType: "preTax",
    amount: "1000.00",
    accountType: "401k",
    parentCategory: "Retirement",
  });
}

/** The stored snapshot rows as the tax-bucket read takes them. */
async function snapshotRows(db: Db, accountType?: string) {
  const { schema } = await app();
  return (await db.select().from(schema.portfolioAccounts)).map((a) => ({
    institution: a.institution,
    taxType: a.taxType,
    // The read takes the stored string as a category; this one may not be.
    accountType: (accountType ?? a.accountType) as never,
    subType: a.subType,
    label: a.label,
    parentCategory: a.parentCategory,
    amount: Number(a.amount),
    ownerPersonId: a.ownerPersonId,
    performanceAccountId: a.performanceAccountId,
    displayName: null,
    accountLabel: null,
  }));
}

/** The account-category read (computeTaxBucketBreakdown) throws on a
 *  category the config doesn't know; the import check keeps one out. */
export function unknownAccountTypeCases(fresh: () => Promise<FenceDb>) {
  it("an import whose snapshot names an unknown account type is refused before the tax-bucket read can see it", async () => {
    const { db, done } = await fresh();
    try {
      const { exportBackup, importBackup, ClosedSetRefusal } = await app();
      const { computeTaxBucketBreakdown } =
        await import("@/lib/pure/accounts/tax-buckets/tax-buckets");
      await snapshot(db);
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db)),
      ) as Backup;
      setAll(backup, "portfolio_accounts", "account_type", "solo401k");

      await expect(
        importBackup(db, backup as never, admin),
      ).rejects.toBeInstanceOf(ClosedSetRefusal);
      const rows = await snapshotRows(db);
      expect(rows.map((r) => r.accountType)).toEqual(["401k"]);
      expect(
        computeTaxBucketBreakdown({ accounts: rows }, [], []).portfolioByTaxType
          .preTax,
      ).toBe(1000);
      // What the refusal keeps away: the read throws on the unknown type.
      const unknown = await snapshotRows(db, "solo401k");
      expect(() =>
        computeTaxBucketBreakdown({ accounts: unknown }, [], []),
      ).toThrow(TypeError);
    } finally {
      await done();
    }
  });
}

/** A backup whose rows point at a row it doesn't have: refused whole on
 *  both dialects (PostgreSQL inserts with triggers off, then checks every
 *  reference), and nothing is written. */
export function danglingReferenceCases(fresh: () => Promise<FenceDb>) {
  it("an import whose rows point at a missing person is refused, and nothing changes", async () => {
    const { db, done } = await fresh();
    try {
      const { exportBackup, importBackup } = await app();
      await household(db);
      const before = await stored(db);
      const backup = JSON.parse(
        JSON.stringify(await exportBackup(db)),
      ) as Backup;
      setAll(backup, "retirement_settings", "person_id", 999999);
      await expect(importBackup(db, backup as never, admin)).rejects.toThrow();
      expect(await stored(db)).toEqual(before);
    } finally {
      done();
    }
  });
}
