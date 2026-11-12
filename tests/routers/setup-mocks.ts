/**
 * Mock setup for router integration tests.
 *
 * Mocks Next.js server modules (next/headers, next/server, next-auth)
 * that can't run outside a Next.js request context.
 * Must be imported BEFORE any router/trpc imports.
 */
import { vi } from "vitest";

// Mock next/headers — used by trpc.ts for cookies/headers
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockRejectedValue(new Error("No request context")),
  headers: vi.fn().mockRejectedValue(new Error("No request context")),
}));

// Mock next/server — required by next-auth
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn(),
    redirect: vi.fn(),
    next: vi.fn(),
  },
  NextRequest: vi.fn(),
}));

// Mock the auth function — we provide sessions directly via context
vi.mock("@/server/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
  RBAC_ADMIN_GROUP_KEY: "rbac_admin_group",
  RBAC_SETTINGS_PREFIX: "rbac_group_",
}));

// Mock the db module — we provide our own SQLite db via context.
// The change_log middleware in trpc.ts (logMutation) writes through the
// top-level db import, not ctx.db, so the mocked `db` forwards to the db of
// the suite's latest createTestCaller (setTopLevelTestDb): an audit row a
// mutation writes, or should not write, is visible in the test's database.
// With no test db open it is a no-op insert chain.
const topLevelDb = vi.hoisted(() => {
  const noopChain: Record<string, unknown> = {
    values: () => noopChain,
    returning: () => noopChain,
    then: (resolve: (v: unknown) => void) => resolve([]),
    catch: () => noopChain,
  };
  const noopDb = {
    insert: () => noopChain,
    select: () => ({ from: () => noopChain }),
  };
  return {
    noopDb,
    current: null as object | null,
    pool: null as object | null,
  };
});

/** Point the mocked top-level `db` at a test database, and on PostgreSQL the
 *  mocked `pool` at its pool (a PostgreSQL import runs on its own client). */
export function setTopLevelTestDb(testDb: object, pool?: object): void {
  topLevelDb.current = testDb;
  topLevelDb.pool = pool ?? null;
}

/** Back to the no-op when `testDb` is the current one (it is closing). */
export function releaseTopLevelTestDb(testDb: object): void {
  if (topLevelDb.current !== testDb) return;
  topLevelDb.current = null;
  topLevelDb.pool = null;
}

// The router suite runs on SQLite, or on PostgreSQL when
// LEDGR_ROUTER_DIALECT=postgres (postgres-router-db.ts): the dialect, the
// schema and the top-level db's dialect follow it.
const onPostgres = vi.hoisted(
  () => process.env.LEDGR_ROUTER_DIALECT === "postgres",
);
const dialect = vi.hoisted(() =>
  process.env.LEDGR_ROUTER_DIALECT === "postgres"
    ? {
        getDialect: () => "postgresql" as const,
        isPostgres: (): boolean => true,
        isSQLite: (): boolean => false,
      }
    : {
        getDialect: () => "sqlite" as const,
        isPostgres: (): boolean => false,
        isSQLite: (): boolean => true,
      },
);

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_target, key) => {
        const target = (topLevelDb.current ?? topLevelDb.noopDb) as Record<
          PropertyKey,
          unknown
        >;
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    },
  ),
  // The caller's pool, read when the code reads it: null when no caller set one, as on SQLite.
  get pool() {
    return topLevelDb.pool;
  },
  ...dialect,
}));

vi.mock("@/lib/db/dialect", () => dialect);

// The schema of the dialect the suite runs on. The PG schema has `now()`
// defaults that don't work in SQLite.
vi.mock("@/lib/db/schema", async () =>
  onPostgres
    ? await vi.importActual("@/lib/db/schema-pg")
    : await vi.importActual("@/lib/db/schema-sqlite"),
);

// Mock rate-limit — disable rate limiting in tests. A vi.fn() (not a bare
// arrow function) so tests that specifically exercise rate-limit wiring
// (e.g. authenticatedRateLimitMiddleware's `internal` skip) can assert on
// whether/how often it was called — every other test just ignores that.
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({
    success: true,
    remaining: 999,
    firstExceedance: false,
  })),
}));
