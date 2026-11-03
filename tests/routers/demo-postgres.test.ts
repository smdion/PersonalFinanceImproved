/**
 * Demo profiles on PostgreSQL, end to end: the real migrator, a demo profile
 * set up through `demo.activateProfile`, then data calls through the real
 * procedure middleware with that demo active. Demo schemas exist only on
 * PostgreSQL, so the SQLite suite never reaches this path.
 *
 * Runs only when TEST_DATABASE_URL names a throwaway database (its name
 * must end in `_test`): the test drops and rebuilds its public schema. CI
 * runs it against a PostgreSQL service with DEMO_ONLY on, as the public
 * demo runs.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Not ./setup-mocks: it swaps the db, dialect and schema modules for
// SQLite. Only what has no request context outside Next.js is mocked here.
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockRejectedValue(new Error("No request context")),
  headers: vi.fn().mockRejectedValue(new Error("No request context")),
}));
vi.mock("next/server", () => ({
  NextResponse: { json: vi.fn(), redirect: vi.fn(), next: vi.fn() },
  NextRequest: vi.fn(),
}));
// Sessions come straight from the caller's context, as in setup-mocks.
vi.mock("@/server/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
  Permission: {},
  RBAC_ADMIN_GROUP_KEY: "rbac_admin_group",
  RBAC_SETTINGS_PREFIX: "rbac_group_",
  ALL_PERMISSIONS: [
    "scenario",
    "portfolio",
    "performance",
    "budget",
    "savings",
    "brokerage",
    "version",
    "contributionProfile",
    "sync",
  ],
}));
// The real connection, built as src/lib/db/index.ts builds it: that module
// loads its schema with a runtime require() of a .ts file, which only the
// app's bundler resolves.
vi.mock("@/lib/db", async () => {
  const { default: pgDriver } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@/lib/db/schema-pg");
  const { isPostgres } = await import("@/lib/db/dialect");
  const pool = new pgDriver.Pool({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  return { db: drizzle(pool, { schema }), pool, isPostgres };
});
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({
    success: true,
    remaining: 999,
    firstExceedance: false,
  })),
}));
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { cookies } from "next/headers";
import pg from "pg";
import type { Session } from "next-auth";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");
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

function assertThrowaway(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test"))
    throw new Error(
      `TEST_DATABASE_URL must name a throwaway database ending in _test (got "${name}"): this test drops its public schema`,
    );
}

// CI sets REQUIRE_TEST_DATABASE so a missing URL fails instead of skipping.
const skip = !TEST_DATABASE_URL && process.env.REQUIRE_TEST_DATABASE !== "true";

describe.skipIf(skip)("demo profiles on PostgreSQL", () => {
  const env = { ...process.env };
  let backupDir: string;
  let admin: pg.Client;
  let schemaName: string;

  /** A caller with `demoSchema` active. Imported only after DATABASE_URL
   *  points at the test database: the db module picks its dialect when it's
   *  first imported. */
  async function callerFor(demoSchema: string | null) {
    const { appRouter } = await import("@/server/routers");
    const { createCallerFactory } = await import("@/server/trpc");
    const { db } = await import("@/lib/db");
    return createCallerFactory(appRouter)({
      db,
      session: adminSession,
      demoSchema,
    });
  }

  beforeAll(async () => {
    if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
    assertThrowaway(TEST_DATABASE_URL);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    // The db module validates the environment on import; a placeholder,
    // not a secret (no session is ever signed in this test).
    process.env.NEXTAUTH_SECRET ??= "demo-postgres-test-placeholder-secret-32+";
    backupDir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-demo-pg-"));
    process.env.LEDGR_BACKUP_DIR = backupDir;

    admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await admin.connect();
    const { rows } = await admin.query<{ nspname: string }>(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'demo\\_%' OR nspname = 'drizzle'",
    );
    for (const { nspname } of rows)
      await admin.query(`DROP SCHEMA "${nspname}" CASCADE`);
    await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");

    // db-migrate.ts does nothing when VITEST is set (so tests can import
    // it): the child must not inherit the runner's VITEST variables.
    const migratorEnv: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(migratorEnv))
      if (key.startsWith("VITEST")) delete migratorEnv[key];
    const migrated = spawnSync(TSX, ["db-migrate.ts"], {
      cwd: process.cwd(),
      env: migratorEnv,
      encoding: "utf8",
      timeout: 180_000,
    });
    expect(migrated.status, migrated.stderr).toBe(0);

    // activateProfile sets the demo cookie; only `set` is called.
    // eslint-disable-next-line no-restricted-syntax -- a partial cookie store stands in for Next's request-scoped one
    vi.mocked(cookies).mockResolvedValue({ set: vi.fn() } as unknown as Awaited<
      ReturnType<typeof cookies>
    >);

    const caller = await callerFor(null);
    const { profiles } = await caller.demo.listProfiles();
    const activated = await caller.demo.activateProfile({
      slug: profiles[0]!.slug,
    });
    schemaName = activated.schemaName;
  }, 300_000);

  afterAll(async () => {
    await admin?.end();
    const { pool } = await import("@/lib/db");
    await (pool as pg.Pool | null)?.end();
    process.env = { ...env };
    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  it("serves data calls with a demo profile active", async () => {
    const people = await (await callerFor(schemaName)).settings.people.list();
    expect(people.length).toBeGreaterThan(0);
  });

  it("reads the demo household, not the install's", async () => {
    const { rows } = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.people",
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("shares install-wide tables with public instead of copying them", async () => {
    const { DEMO_SHARED_TABLES } = await import("@/lib/db/demo-schema-marker");
    const { rows } = await admin.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = $1 AND tablename = ANY($2::text[])",
      [schemaName, DEMO_SHARED_TABLES],
    );
    expect(rows).toEqual([]);
  });

  it("each profile's chooser savings rate is the Contribution page's rate", async () => {
    // Seeded exactly as a visitor's demo is, then computed as the page
    // computes it (computeSummary → householdSavings): projected, match
    // included, Portfolio money counted — the glossary's savings rate.
    const { DEMO_PROFILES } = await import("@/lib/demo");
    const { householdSavings } = await import("@/lib/pure/contributions");
    for (const profile of Object.values(DEMO_PROFILES)) {
      const { schemaName: demo } = await (
        await callerFor(null)
      ).demo.activateProfile({ slug: profile.slug });
      if (profile.keyStats.savingsRate === "N/A") {
        const summary = await (
          await callerFor(demo)
        ).contribution.computeSummary();
        expect(
          summary.people.filter((p) => p.salary > 0),
          profile.slug,
        ).toEqual([]);
        continue;
      }
      // The page asks for the active Contribution Profile by id; with no
      // profile nothing resolves (every contribution reads $0).
      const { rows: active } = await admin.query<{ value: unknown }>(
        `SELECT value FROM "${demo}".app_settings WHERE key = $1`,
        [SK_ACTIVE_CONTRIB_PROFILE_ID],
      );
      const contributionProfileId = Number(active[0]?.value);
      expect(Number.isInteger(contributionProfileId), profile.slug).toBe(true);
      const summary = await (
        await callerFor(demo)
      ).contribution.computeSummary({ contributionProfileId });
      const earners = summary.people.filter((p) => p.salary > 0);
      const { rate } = householdSavings(
        earners,
        summary.jointAccountTypes,
        "projected",
        { excludeMatch: false },
      );
      // Soft: one run reports every profile that disagrees.
      expect
        .soft(`${Math.round(rate * 100)}%`, profile.slug)
        .toBe(profile.keyStats.savingsRate);
    }
  }, 300_000);

  it("refuses a demo schema missing one of its own tables", async () => {
    await admin.query(`DROP TABLE "${schemaName}".people CASCADE`);
    await expect(
      (await callerFor(schemaName)).settings.people.list(),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
