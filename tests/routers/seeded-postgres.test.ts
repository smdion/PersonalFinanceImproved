/**
 * The router suite runs on SQLite; this runs a subset of it on PostgreSQL,
 * against a household on an install migrated from empty, so a query that
 * only works on one dialect (a numeric that comes back as a string, a
 * SQLite-only function, a transaction) fails here by name.
 *
 * For each demo household (invented data, seeded into `public` as a
 * self-hosted install holds it, not into a demo schema, from the same empty
 * tables a demo schema starts from): every page's main
 * read, a write through a transaction, then the backup round trip through
 * the real CLI scripts — `scripts/export-backup.ts`, a database migrated
 * from empty, `scripts/import-backup.ts` — must give back every row.
 *
 * Runs only when TEST_DATABASE_URL names a throwaway database (its name
 * must end in `_test`): the test drops and rebuilds its schemas. CI runs it
 * in the PostgreSQL job.
 */
// First: its mocks must be in place before any app module loads.
import {
  closeAppPool,
  dropAllSchemas,
  pointAtTestDatabase,
  skipWithoutPostgres,
} from "./setup-postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import pg from "pg";
import type { Session } from "next-auth";
import type { AppRouter } from "@/server/routers";
import { DEMO_PROFILES } from "@/lib/demo";
import { runMigrator } from "./fresh-install-cases";

type Caller = ReturnType<AppRouter["createCaller"]>;

const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");
const timeout = 300_000;

// Not imported from ./setup: that module loads the db module (as SQLite)
// before this file can point DATABASE_URL at PostgreSQL.
const adminSession: Session = {
  user: {
    id: "test-admin",
    name: "Test Admin",
    email: "admin@test.local",
    role: "admin",
    permissions: [],
  },
  expires: "2099-12-31T23:59:59.999Z",
};

/** Each page's main read, called as the page calls it on first load. */
const READS: [string, (caller: Caller) => Promise<unknown>][] = [
  ["settings.people.list", (c) => c.settings.people.list()],
  ["paycheck.computeSummary", (c) => c.paycheck.computeSummary()],
  ["contribution.computeSummary", (c) => c.contribution.computeSummary()],
  ["budget.listProfiles", (c) => c.budget.listProfiles()],
  ["budget.computeActiveSummary", (c) => c.budget.computeActiveSummary()],
  ["savings.computeSummary", (c) => c.savings.computeSummary()],
  ["networth.computeSummary", (c) => c.networth.computeSummary()],
  ["networth.listSnapshotTotals", (c) => c.networth.listSnapshotTotals()],
  [
    "networth.portfolioSnapshots.getLatest",
    (c) => c.networth.portfolioSnapshots.getLatest(),
  ],
  ["performance.computeSummary", (c) => c.performance.computeSummary()],
  ["historical.computeSummary", (c) => c.historical.computeSummary()],
  ["assets.computeSummary", (c) => c.assets.computeSummary()],
  ["mortgage.computeActiveSummary", (c) => c.mortgage.computeActiveSummary()],
  ["brokerage.computeSummary", (c) => c.brokerage.computeSummary()],
  ["debts.summary", (c) => c.debts.summary()],
  [
    "retirement.retirementSettings.list",
    (c) => c.retirement.retirementSettings.list(),
  ],
  [
    "investments.getHoldingsOverview",
    (c) => c.investments.getHoldingsOverview(),
  ],
  ["milestones.firstReached", (c) => c.milestones.firstReached()],
  ["projection.computeProjection", (c) => c.projection.computeProjection({})],
];

/** Paths to every NaN in a procedure's result: a figure no page can show,
 *  and the usual sign of a numeric column read as a string on one dialect. */
function nanPaths(value: unknown, at = "$"): string[] {
  if (typeof value === "number") return Number.isNaN(value) ? [at] : [];
  if (Array.isArray(value))
    return value.flatMap((item, index) => nanPaths(item, `${at}[${index}]`));
  if (value && typeof value === "object" && !(value instanceof Date))
    return Object.entries(value).flatMap(([key, item]) =>
      nanPaths(item, `${at}.${key}`),
    );
  return [];
}

/** Run a backup CLI script against the test database. The child doesn't
 *  inherit the runner's VITEST variables, as for the migrator. */
function runScript(script: string, args: string[]) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(childEnv))
    if (key.startsWith("VITEST")) delete childEnv[key];
  const result = spawnSync(TSX, [path.join("scripts", script), ...args], {
    cwd: process.cwd(),
    env: childEnv,
    encoding: "utf8",
    timeout: 180_000,
  });
  if (result.status !== 0)
    throw new Error(
      `${script} exited ${result.status}:\n${result.stderr}\n${result.stdout}`,
    );
}

/** A backup file's tables, each table's rows in a fixed order. */
function backupTables(file: string): Record<string, string[]> {
  const backup = JSON.parse(fs.readFileSync(file, "utf8")) as {
    tables: Record<string, unknown[]>;
  };
  return Object.fromEntries(
    Object.entries(backup.tables).map(([table, rows]) => [
      table,
      rows.map((row) => JSON.stringify(row)).sort(),
    ]),
  );
}

/**
 * The households this run seeds: all of them, or with SEEDED_SHARD="k/n"
 * (CI's PostgreSQL parts) every n-th one starting at the k-th.
 */
function seededSlugs(): string[] {
  const slugs = Object.keys(DEMO_PROFILES);
  const shard = process.env.SEEDED_SHARD;
  if (!shard) return slugs;
  const [part, parts] = shard.split("/").map(Number);
  if (!part || !parts || part > parts)
    throw new Error(
      `SEEDED_SHARD must be "k/n" with 1 ≤ k ≤ n, not "${shard}"`,
    );
  return slugs.filter((_, index) => index % parts === part - 1);
}

describe.skipIf(skipWithoutPostgres)("seeded routers on PostgreSQL", () => {
  let restoreEnv: () => void = () => {};
  let backupDir: string;
  let admin: pg.Client;

  beforeAll(async () => {
    const testDatabase = pointAtTestDatabase("seeded-pg");
    restoreEnv = testDatabase.restore;
    backupDir = testDatabase.backupDir;
    delete process.env.DEMO_ONLY;
    admin = new pg.Client({ connectionString: testDatabase.url });
    await admin.connect();
  });

  afterAll(async () => {
    await admin?.end();
    await closeAppPool();
    restoreEnv();
  });

  async function caller(): Promise<Caller> {
    const { appRouter } = await import("@/server/routers");
    const { createCallerFactory } = await import("@/server/trpc");
    const { db } = await import("@/lib/db");
    return createCallerFactory(appRouter)({
      db,
      session: adminSession,
      demoSchema: null,
    });
  }

  describe.each(seededSlugs())("%s", (slug) => {
    const profile = DEMO_PROFILES[slug]!;

    beforeAll(async () => {
      await dropAllSchemas(admin);
      runMigrator();
      // Seeded as demo.activateProfile seeds a demo schema: its tables start
      // empty (CREATE TABLE LIKE copies no rows), then the reference data,
      // then the household. seedProfile inserts its own active-profile
      // settings, which would collide with the first-run rows the migrator
      // writes into public (the "Current" profiles and their settings).
      const { DEMO_SHARED_TABLES } =
        await import("@/lib/db/demo-schema-marker");
      const { rows } = await admin.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT tablename = ANY($1::text[])",
        [DEMO_SHARED_TABLES],
      );
      await admin.query(
        `TRUNCATE ${rows.map((row) => `public."${row.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
      );
      const { db } = await import("@/lib/db");
      const { applyReferenceData } = await import("@/lib/db/reference-data");
      const { seedProfile } = await import("@/server/routers/demo");
      await applyReferenceData(db);
      await seedProfile(db, profile);
    }, timeout);

    it.each(READS)(
      "%s",
      async (_name, read) => {
        const result = await read(await caller());
        expect(nanPaths(result)).toEqual([]);
      },
      timeout,
    );

    it("settings.people.list returns the seeded household", async () => {
      const people = await (await caller()).settings.people.list();
      expect(people.map((person) => person.name).sort()).toEqual(
        profile.people.map((person) => person.name).sort(),
      );
    });

    it("budget.duplicateProfile and deleteProfile commit their transactions", async () => {
      const c = await caller();
      const before = await c.budget.listProfiles();
      const source = before[0];
      if (!source) return; // a household without a budget has nothing to copy
      const copy = await c.budget.duplicateProfile({
        sourceProfileId: source.id,
        name: "PostgreSQL copy",
      });
      expect(await c.budget.listProfiles()).toHaveLength(before.length + 1);
      await c.budget.deleteProfile({ id: copy.id });
      expect(await c.budget.listProfiles()).toHaveLength(before.length);
    });

    it(
      "backup round trip: export, a database migrated from empty, import, every row back",
      async () => {
        const exported = path.join(backupDir, `${slug}-exported.json`);
        const restored = path.join(backupDir, `${slug}-restored.json`);
        runScript("export-backup.ts", ["--out", exported]);
        const before = backupTables(exported);
        expect(before.people?.length).toBe(profile.people.length);

        await dropAllSchemas(admin);
        runMigrator();
        runScript("import-backup.ts", [exported]);
        runScript("export-backup.ts", ["--out", restored]);
        const after = backupTables(restored);

        expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
        // Counts first, per table, so a lost table reads as one line.
        const counts = (tables: Record<string, string[]>) =>
          Object.fromEntries(
            Object.entries(tables).map(([table, rows]) => [table, rows.length]),
          );
        expect(counts(after)).toEqual(counts(before));
        for (const table of Object.keys(before))
          expect(after[table], table).toEqual(before[table]);
      },
      timeout,
    );
  });
});
