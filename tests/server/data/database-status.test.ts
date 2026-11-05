/**
 * The dashboard layout's database check: null when the database answers and
 * the `people` table exists, otherwise the sentence the layout shows, on both
 * dialects (PostgreSQL through `execute`, SQLite through `all`).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const m = vi.hoisted(() => ({
  postgres: false,
  execute: vi.fn(),
  all: vi.fn(),
}));

vi.mock("@/lib/db/dialect", () => ({ isPostgres: () => m.postgres }));
vi.mock("@/lib/db", () => ({
  isPostgres: () => m.postgres,
  db: { execute: m.execute, all: m.all },
}));
vi.mock("@/lib/db/version-tables", () => ({ VERSION_TABLES: [] }));
vi.mock("@/lib/db/schema-pg", () => ({}));
vi.mock("@/lib/db/schema-sqlite", () => ({}));

import { databaseStatus } from "@/server/data/database-status";

const MISSING =
  "Database tables not found. Migrations may need to run. Please restart the application.";
const UNREACHABLE =
  "Unable to connect to the database. Please check your database configuration and ensure the database server is running.";

beforeEach(() => {
  m.execute.mockReset();
  m.all.mockReset();
});

describe("databaseStatus on PostgreSQL", () => {
  beforeEach(() => {
    m.postgres = true;
  });

  it("is null when the people table exists", async () => {
    m.execute
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }] })
      .mockResolvedValueOnce({ rows: [{ has_tables: true }] });
    expect(await databaseStatus()).toBeNull();
    expect(m.execute).toHaveBeenCalledTimes(2);
    expect(m.all).not.toHaveBeenCalled();
  });

  it("says the tables are missing when it doesn't", async () => {
    m.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ has_tables: false }] });
    expect(await databaseStatus()).toBe(MISSING);
  });

  it("says the tables are missing when the check returns no row", async () => {
    m.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    expect(await databaseStatus()).toBe(MISSING);
  });

  it("says the database is unreachable when a query throws", async () => {
    m.execute.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await databaseStatus()).toBe(UNREACHABLE);
  });
});

describe("databaseStatus on SQLite", () => {
  beforeEach(() => {
    m.postgres = false;
  });

  it("is null when the people table exists", async () => {
    m.all
      .mockReturnValueOnce([{ 1: 1 }])
      .mockReturnValueOnce([{ has_tables: 1 }]);
    expect(await databaseStatus()).toBeNull();
    expect(m.all).toHaveBeenCalledTimes(2);
    expect(m.execute).not.toHaveBeenCalled();
  });

  it("says the tables are missing when it doesn't", async () => {
    m.all.mockReturnValueOnce([]).mockReturnValueOnce([{ has_tables: 0 }]);
    expect(await databaseStatus()).toBe(MISSING);
  });

  it("says the database is unreachable when a query throws", async () => {
    m.all.mockImplementationOnce(() => {
      throw new Error("SQLITE_CANTOPEN");
    });
    expect(await databaseStatus()).toBe(UNREACHABLE);
  });
});
