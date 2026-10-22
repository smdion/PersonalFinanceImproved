/**
 * Backup Round-Trip Test
 *
 * Drives the real backup code in src/lib/db/version-logic.ts — the same
 * functions behind /api/versions/export, /api/versions/import and the
 * version router's create/restore — against the migrated + seeded test
 * SQLite database, and checks that data survives each path unchanged.
 *
 * This catches:
 *   - Tables missing from VERSION_TABLE_NAMES (data silently dropped)
 *   - Column/JSON encoding drift between export and import
 *   - Restore leaving rows behind (truncate) or renumbering ids (sequences)
 */
import "../routers/setup-mocks";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import {
  createTestCaller,
  seedStandardDataset,
  seedPerson,
} from "../routers/setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { VERSION_TABLE_NAMES } from "@/lib/db/version-tables";
import {
  createVersion,
  exportBackup,
  importBackup,
  restoreVersion,
  type BackupData,
} from "@/lib/db/version-logic";

type TestCtx = Awaited<ReturnType<typeof createTestCaller>>;

/** Every versioned table's rows, ordered by id where there is one. */
async function snapshotTables(db: TestCtx["rawDb"]) {
  const { tables } = await exportBackup(db);
  const byId = (a: unknown, b: unknown) =>
    Number((a as { id?: number }).id ?? 0) -
    Number((b as { id?: number }).id ?? 0);
  return Object.fromEntries(
    Object.entries(tables).map(([t, rows]) => [t, [...rows].sort(byId)]),
  );
}

async function seedHousehold(db: TestCtx["db"]) {
  seedStandardDataset(db);
  await seedPerson(db, "Second Person", "1992-03-01");
  // A structured JSON setting exercises jsonb encoding on the way through.
  db.insert(sqliteSchema.appSettings)
    .values({
      key: "milestone_custom_goals",
      value: [{ id: "g1", label: "Fixture goal", amount: 100000 }],
    })
    .run();
  // Holding history for one part of an account (sub_key) and its fund.
  const perf = db
    .select({ id: sqliteSchema.performanceAccounts.id })
    .from(sqliteSchema.performanceAccounts)
    .limit(1)
    .get()!.id;
  const fund = db
    .insert(sqliteSchema.securities)
    .values({ name: "Fixture Fund", ticker: "FXFND", kind: "mutual_fund" })
    .returning()
    .get().id;
  const period = db
    .insert(sqliteSchema.holdingPeriods)
    .values({
      performanceAccountId: perf,
      subKey: `${perf}_taxFree__1`,
      startDate: "2020-01-01",
      basis: "user",
    })
    .returning()
    .get().id;
  db.insert(sqliteSchema.holdingPeriodWeights)
    .values({ holdingPeriodId: period, securityId: fund, weight: "1" })
    .run();
}

describe("Backup Round-Trip (real version-logic)", () => {
  let a: TestCtx;
  let b: TestCtx;

  beforeEach(async () => {
    a = await createTestCaller();
    b = await createTestCaller();
    await seedHousehold(a.db);
  });

  afterEach(() => {
    a.cleanup();
    b.cleanup();
  });

  it("export covers every versioned table", async () => {
    const backup = await exportBackup(a.rawDb);
    expect(Object.keys(backup.tables).sort()).toEqual(
      [...VERSION_TABLE_NAMES].sort(),
    );
    expect(backup.sourceDialect).toBe("sqlite");
    expect(backup.tables.people).toHaveLength(2);
  });

  it("export → JSON → import into an empty database reproduces every table", async () => {
    const before = await snapshotTables(a.rawDb);
    const backup = JSON.parse(
      JSON.stringify(await exportBackup(a.rawDb)),
    ) as BackupData;

    const result = await importBackup(b.rawDb, backup);
    const nonEmpty = Object.values(before).filter((r) => r.length > 0);
    expect(result.restoredRows).toBe(
      nonEmpty.reduce((n, rows) => n + rows.length, 0),
    );
    expect(await snapshotTables(b.rawDb)).toEqual(before);
  });

  it("import brings back reference rows the backup predates (a newer tax year)", async () => {
    const backup = await exportBackup(a.rawDb);
    const years = (backup.tables.tax_params as { tax_year: number }[]).map(
      (r) => r.tax_year,
    );
    const newest = Math.max(...years);
    // A backup taken before the newest tax year was seeded.
    for (const table of ["contribution_limits", "tax_params"])
      backup.tables[table] = (
        backup.tables[table] as { tax_year: number }[]
      ).filter((r) => r.tax_year !== newest);

    await importBackup(b.rawDb, backup);
    const after = await exportBackup(b.rawDb);
    for (const table of ["contribution_limits", "tax_params"])
      expect(
        (after.tables[table] as { tax_year: number }[]).some(
          (r) => r.tax_year === newest,
        ),
        table,
      ).toBe(true);
  });

  it("import replaces existing data rather than merging into it", async () => {
    await seedPerson(b.db, "Stale Person", "1980-01-01");
    const backup = await exportBackup(a.rawDb);
    await importBackup(b.rawDb, backup);
    const people = await snapshotTables(b.rawDb).then((t) => t.people!);
    expect(people.map((p) => (p as { name: string }).name).sort()).toEqual([
      "Second Person",
      "Test Person",
    ]);
  });

  it("create version → change data → restore brings the snapshot back", async () => {
    const before = await snapshotTables(a.rawDb);
    const version = await createVersion(a.rawDb, {
      name: "before edit",
      type: "manual",
      createdBy: "test",
    });
    expect(version.totalRows).toBe(
      Object.values(before).reduce((n, rows) => n + rows.length, 0),
    );

    const d = a.db;
    d.run(sql`DELETE FROM jobs`);
    d.run(sql`UPDATE people SET name = 'Renamed'`);
    await seedPerson(d, "Added After", "2000-01-01");

    await restoreVersion(a.rawDb, version.id);
    expect(await snapshotTables(a.rawDb)).toEqual(before);
  });

  it("restore keeps id sequences ahead of restored rows", async () => {
    const version = await createVersion(a.rawDb, {
      name: "v",
      type: "manual",
      createdBy: "test",
    });
    await restoreVersion(a.rawDb, version.id);
    const maxId = Math.max(
      ...(await snapshotTables(a.rawDb)).people!.map(
        (p) => (p as { id: number }).id,
      ),
    );
    const newId = await seedPerson(a.db, "After Restore", "1995-01-01");
    expect(newId).toBeGreaterThan(maxId);
  });
});
