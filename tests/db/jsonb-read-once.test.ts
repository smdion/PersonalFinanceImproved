/**
 * A jsonb value reads back as it was stored, on both dialects. node-postgres
 * hands a jsonb column over already parsed (the stored string "42" arrives as
 * the JS string "42"); the PostgreSQL column must not parse it again. SQLite
 * stores JSON text and its column parses it once.
 */
import { describe, it, expect } from "vitest";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as pg from "@/lib/db/schema-pg";
import * as sqlite from "@/lib/db/schema-sqlite";

/** What node-postgres hands drizzle for each stored jsonb value. */
const FROM_DRIVER: [string, unknown][] = [
  ["a numeric string", "42"],
  ["a number (a string this bug read back and wrote again)", 42],
  ["the string true", "true"],
  ["the string null", "null"],
  ["a string holding an array", "[1,2]"],
  ["a plain string", "America/Chicago"],
  ["an object", { a: 1 }],
  ["an array", [1, "2"]],
  ["null", null],
];

describe("jsonb reads on PostgreSQL", () => {
  it.each(FROM_DRIVER)("keeps %s as the driver parsed it", (_, value) => {
    expect(pg.appSettings.value.mapFromDriverValue(value)).toEqual(value);
  });

  it("writes a string as a JSON string, so it reads back as one", () => {
    expect(pg.appSettings.value.mapToDriverValue("42")).toBe('"42"');
    expect(pg.appSettings.value.mapToDriverValue(42)).toBe("42");
  });

  it("every jsonb column in the schema reads a numeric string as a string", () => {
    const exported: unknown[] = Object.values(pg);
    const columns = exported
      .filter((t): t is PgTable => is(t, PgTable))
      .flatMap((t) => getTableConfig(t).columns)
      .filter((c) => c.getSQLType() === "jsonb");
    expect(columns.length).toBeGreaterThan(20);
    for (const column of columns)
      expect([column.name, column.mapFromDriverValue("42")]).toEqual([
        column.name,
        "42",
      ]);
  });
});

describe("jsonb reads on SQLite", () => {
  it("parses the stored JSON text once", () => {
    const value = sqlite.appSettings.value;
    expect(value.mapFromDriverValue('"42"')).toBe("42");
    expect(value.mapFromDriverValue("42")).toBe(42);
    expect(value.mapToDriverValue("42")).toBe('"42"');
  });
});
