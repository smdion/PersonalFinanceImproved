/**
 * Harness for router tests on PostgreSQL. Import it before anything else
 * in the test file: it mocks what has no request context outside Next.js
 * and connects `@/lib/db` to TEST_DATABASE_URL. Not ./setup-mocks: that
 * swaps the db, dialect and schema modules for SQLite.
 *
 * The suites drop and rebuild the database's schemas, so TEST_DATABASE_URL
 * must name a throwaway database ending in `_test`. Without it they skip,
 * unless REQUIRE_TEST_DATABASE=true (CI) makes a missing URL fail instead.
 *
 * Imports no app module at load: the db module picks its dialect when it's
 * first imported, which must be after `pointAtTestDatabase()`.
 */
import { vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type pg from "pg";

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
  RBAC_ADMIN_GROUP_KEY: "rbac_admin_group",
  RBAC_SETTINGS_PREFIX: "rbac_group_",
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

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** True when there's no test database and CI didn't require one. */
export const skipWithoutPostgres =
  !TEST_DATABASE_URL && process.env.REQUIRE_TEST_DATABASE !== "true";

/** The test database's URL; throws unless it names a throwaway database
 *  (ending in `_test`), since the suites drop its schemas. */
export function requireThrowawayDatabase(): string {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  const name = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");
  if (!name.endsWith("_test"))
    throw new Error(
      `TEST_DATABASE_URL must name a throwaway database ending in _test (got "${name}"): this test drops its public schema`,
    );
  return TEST_DATABASE_URL;
}

/**
 * Points the app (DATABASE_URL) and the migrator's pre-migration backups
 * (LEDGR_BACKUP_DIR, a fresh temp directory) at the test database. The
 * returned `restore()` puts the environment back and removes the directory.
 */
export function pointAtTestDatabase(label: string): {
  url: string;
  backupDir: string;
  restore: () => void;
} {
  const saved = { ...process.env };
  const url = requireThrowawayDatabase();
  process.env.DATABASE_URL = url;
  // The db module validates the environment on import; a placeholder,
  // not a secret (no session is ever signed in these tests).
  process.env.NEXTAUTH_SECRET ??= `${label}-test-placeholder-secret-32+`;
  const backupDir = fs.mkdtempSync(path.join(tmpdir(), `ledgr-${label}-`));
  process.env.LEDGR_BACKUP_DIR = backupDir;
  return {
    url,
    backupDir,
    restore: () => {
      process.env = { ...saved };
      fs.rmSync(backupDir, { recursive: true, force: true });
    },
  };
}

/** Empties the database: drops the demo schemas and the migrator's
 *  `drizzle` schema, and rebuilds an empty public schema. */
export async function dropAllSchemas(admin: pg.Client): Promise<void> {
  const { rows } = await admin.query<{ nspname: string }>(
    "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'demo\\_%' OR nspname = 'drizzle'",
  );
  for (const { nspname } of rows)
    await admin.query(`DROP SCHEMA "${nspname}" CASCADE`);
  await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
}

/** Ends the app's connection pool (the mocked `@/lib/db`'s). */
export async function closeAppPool(): Promise<void> {
  const { pool } = await import("@/lib/db");
  await (pool as pg.Pool | null)?.end();
}
