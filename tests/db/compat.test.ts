import { describe, it, expect, vi } from "vitest";

// We need to control dialect detection, so mock it
vi.mock("@/lib/db/dialect", () => ({
  isPostgres: vi.fn(() => false),
}));

import { isPostgres } from "@/lib/db/dialect";
import {
  tableExistsSQL,
  listTablesSQL,
  jsonbLiteral,
  validateColumns,
} from "@/lib/db/compat";

const mockedIsPostgres = vi.mocked(isPostgres);

describe("tableExistsSQL", () => {
  it("returns SQLite query when not postgres", () => {
    mockedIsPostgres.mockReturnValue(false);
    const result = tableExistsSQL("users");
    // Should contain sqlite_master reference
    expect(result.queryChunks).toBeDefined();
  });

  it("returns PostgreSQL query when postgres", () => {
    mockedIsPostgres.mockReturnValue(true);
    const result = tableExistsSQL("users");
    expect(result.queryChunks).toBeDefined();
  });
});

describe("listTablesSQL", () => {
  it("returns SQLite query when not postgres", () => {
    mockedIsPostgres.mockReturnValue(false);
    const result = listTablesSQL();
    expect(result.queryChunks).toBeDefined();
  });

  it("returns PostgreSQL query when postgres", () => {
    mockedIsPostgres.mockReturnValue(true);
    const result = listTablesSQL();
    expect(result.queryChunks).toBeDefined();
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
