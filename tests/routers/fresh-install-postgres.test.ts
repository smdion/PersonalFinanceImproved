/**
 * A fresh install on PostgreSQL: each case drops the database's schemas,
 * runs the real migrator, then goes through the app's procedures as a first
 * run does (the cases are in ./fresh-install-cases, shared with SQLite).
 *
 * Runs only when TEST_DATABASE_URL names a throwaway database (its name
 * must end in `_test`): the test drops and rebuilds its public schema. CI
 * runs it against a PostgreSQL service with DEMO_ONLY unset, as a
 * self-hosted install runs.
 */
import { describe, beforeAll, afterAll, vi } from "vitest";

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
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import pg from "pg";
import { freshInstallCases, runMigrator } from "./fresh-install-cases";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function assertThrowaway(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test"))
    throw new Error(
      `TEST_DATABASE_URL must name a throwaway database ending in _test (got "${name}"): this test drops its public schema`,
    );
}

// CI sets REQUIRE_TEST_DATABASE so a missing URL fails instead of skipping.
const skip = !TEST_DATABASE_URL && process.env.REQUIRE_TEST_DATABASE !== "true";

describe.skipIf(skip)("fresh install (PostgreSQL)", () => {
  const env = { ...process.env };
  let backupDir: string;
  let admin: pg.Client;

  beforeAll(async () => {
    if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
    assertThrowaway(TEST_DATABASE_URL);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    // The db module validates the environment on import; a placeholder,
    // not a secret (no session is ever signed in this test).
    process.env.NEXTAUTH_SECRET ??= "fresh-install-test-placeholder-secret-32+";
    delete process.env.DEMO_ONLY;
    backupDir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-fresh-pg-"));
    process.env.LEDGR_BACKUP_DIR = backupDir;
    admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await admin.connect();
  });

  afterAll(async () => {
    await admin?.end();
    const { pool } = await import("@/lib/db");
    await (pool as pg.Pool | null)?.end();
    process.env = { ...env };
    if (backupDir) fs.rmSync(backupDir, { recursive: true, force: true });
  });

  freshInstallCases(async () => {
    const { rows } = await admin.query<{ nspname: string }>(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'demo\\_%' OR nspname = 'drizzle'",
    );
    for (const { nspname } of rows)
      await admin.query(`DROP SCHEMA "${nspname}" CASCADE`);
    await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    runMigrator();

    // Imported only after DATABASE_URL points at the test database: the db
    // module picks its dialect when it's first imported.
    const { appRouter } = await import("@/server/routers");
    const { createCallerFactory } = await import("@/server/trpc");
    const { db } = await import("@/lib/db");
    const callerFactory = createCallerFactory(appRouter);
    return {
      caller: (session) => callerFactory({ db, session, demoSchema: null }),
      count: async (table) => {
        const result = await admin.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public."${table}"`,
        );
        return result.rows[0]!.n;
      },
    };
  });
});
