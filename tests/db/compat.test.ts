import { describe, it, expect, vi } from "vitest";

// We need to control dialect detection, so mock it
vi.mock("@/lib/db/dialect", () => ({
  isPostgres: vi.fn(() => false),
}));

import { drizzle } from "drizzle-orm/better-sqlite3";
import { PgDialect } from "drizzle-orm/pg-core";
import { openTestSqlite } from "../helpers/db-harness";
import { isPostgres } from "@/lib/db/dialect";
import {
  tableExistsSQL,
  listTablesSQL,
  jsonbLiteral,
  validateColumns,
  tablesWithIdColumn,
} from "@/lib/db/compat";

const mockedIsPostgres = vi.mocked(isPostgres);

describe("tableExistsSQL", () => {
  it("SQLite: answers true for a real table and false for a missing one", () => {
    mockedIsPostgres.mockReturnValue(false);
    const db = drizzle(openTestSqlite());
    expect(db.get(tableExistsSQL("people"))).toEqual({ has_tables: 1 });
    expect(db.get(tableExistsSQL("no_such_table"))).toEqual({ has_tables: 0 });
  });

  it("PostgreSQL: asks information_schema with the name as a bound param", () => {
    mockedIsPostgres.mockReturnValue(true);
    const q = new PgDialect().sqlToQuery(tableExistsSQL("people"));
    expect(q.sql).toContain("information_schema.tables");
    expect(q.params).toEqual(["people"]);
  });
});

describe("listTablesSQL", () => {
  it("SQLite: lists app tables, sorted, without sqlite/drizzle internals", () => {
    mockedIsPostgres.mockReturnValue(false);
    const db = drizzle(openTestSqlite());
    const names = db
      .all<{ tablename: string }>(listTablesSQL())
      .map((r) => r.tablename);
    expect(names).toContain("people");
    expect(names).toEqual([...names].sort());
    expect(
      names.filter((n) => n.startsWith("sqlite_") || n.startsWith("__drizzle")),
    ).toEqual([]);
  });

  it("PostgreSQL: reads pg_tables for the public schema", () => {
    mockedIsPostgres.mockReturnValue(true);
    const q = new PgDialect().sqlToQuery(listTablesSQL());
    expect(q.sql).toMatch(/FROM pg_tables WHERE schemaname = 'public'/);
  });
});

describe("jsonbLiteral", () => {
  it("formats as plain JSON string for SQLite", () => {
    mockedIsPostgres.mockReturnValue(false);
    const result = jsonbLiteral({ key: "value" });
    expect(result).toBe(`'{"key":"value"}'`);
    expect(result).not.toContain("::jsonb");
  });

  it("formats with ::jsonb cast for PostgreSQL", () => {
    mockedIsPostgres.mockReturnValue(true);
    const result = jsonbLiteral({ key: "value" });
    expect(result).toContain("::jsonb");
  });

  it("escapes single quotes in JSON", () => {
    mockedIsPostgres.mockReturnValue(false);
    const result = jsonbLiteral({ name: "it's" });
    expect(result).toContain("it''s");
  });

  it("handles arrays", () => {
    mockedIsPostgres.mockReturnValue(false);
    const result = jsonbLiteral([1, 2, 3]);
    expect(result).toBe("'[1,2,3]'");
  });

  it("handles null", () => {
    mockedIsPostgres.mockReturnValue(false);
    const result = jsonbLiteral(null);
    expect(result).toBe("'null'");
  });
});

describe("validateColumns", () => {
  it("does not throw for a real table with only real column names", () => {
    mockedIsPostgres.mockReturnValue(false);
    expect(() => validateColumns("people", ["id", "name"])).not.toThrow();
  });

  it("throws for an unknown column on a real table", () => {
    mockedIsPostgres.mockReturnValue(false);
    expect(() =>
      validateColumns("people", ["id", "definitely_not_a_real_column"]),
    ).toThrow(/Invalid column/);
  });

  it("throws for an unknown table", () => {
    mockedIsPostgres.mockReturnValue(false);
    expect(() =>
      validateColumns("definitely_not_a_real_table", ["id"]),
    ).toThrow(/Unknown table/);
  });
});

describe("tablesWithIdColumn", () => {
  it("leaves out tables keyed by something other than an id", () => {
    mockedIsPostgres.mockReturnValue(false);
    expect(tablesWithIdColumn(["people", "asset_class_buckets"])).toEqual([
      "people",
    ]);
  });
});
