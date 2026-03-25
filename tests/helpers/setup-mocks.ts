/**
 * Mock setup for helper integration tests.
 *
 * Similar to routers/setup-mocks.ts but lighter — only mocks modules
 * that helpers import transitively (schema, db, budget-api).
 */
import { vi } from "vitest";

// Mock the db module
vi.mock("@/lib/db", () => ({
  db: {},
  pool: null,
  isPostgres: () => false,
  isSQLite: () => true,
  getDialect: () => "sqlite",
}));

// Mock dialect
vi.mock("@/lib/db/dialect", () => ({
  getDialect: () => "sqlite",
  isPostgres: () => false,
  isSQLite: () => true,
}));

// Mock schema module — use SQLite schema
vi.mock("@/lib/db/schema", async () => {
  return await vi.importActual("@/lib/db/schema-sqlite");
});

// Mock budget-api (dynamic import in getEffectiveCash)
vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
}));
