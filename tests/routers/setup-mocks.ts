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

// Mock the db module — we provide our own SQLite db via context.
// The mock db needs a minimal insert() chain for the change_log middleware
// in trpc.ts which uses the top-level db import (not ctx.db) to log mutations.
const noopChain = {
  values: () => noopChain,
  returning: () => noopChain,
  then: (resolve: (v: unknown) => void) => resolve([]),
  catch: () => noopChain,
};
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => noopChain,
    select: () => ({ from: () => noopChain }),
  },
  pool: null,
  isPostgres: () => false,
  isSQLite: () => true,
  getDialect: () => "sqlite",
}));

// Mock dialect to return sqlite
vi.mock("@/lib/db/dialect", () => ({
  getDialect: () => "sqlite",
  isPostgres: () => false,
  isSQLite: () => true,
}));

// Mock schema module — use the SQLite schema for test DB compatibility.
// The PG schema has `now()` defaults that don't work in SQLite.
vi.mock("@/lib/db/schema", async () => {
  return await vi.importActual("@/lib/db/schema-sqlite");
});

// Mock rate-limit — disable rate limiting in tests
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true, remaining: 999 }),
}));
