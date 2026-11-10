/**
 * Every decimal column reads in one text form on both databases: the
 * PostgreSQL numeric (pg-decimal.ts) and SQLite's text for it
 * (sqlite-decimal.ts) give "300.00" back as "300".
 */
import { describe, it, expect } from "vitest";
import { getTableConfig as pgConfig, PgTable } from "drizzle-orm/pg-core";
import {
  getTableConfig as sqliteConfig,
  SQLiteTable,
} from "drizzle-orm/sqlite-core";
import { is } from "drizzle-orm";
import * as pg from "@/lib/db/schema-pg";
import * as sqlite from "@/lib/db/schema-sqlite";

const pgDecimals = Object.values<unknown>(pg)
  .filter((t) => is(t, PgTable))
  .flatMap((t) =>
    pgConfig(t)
      .columns.filter((c) => c.getSQLType().startsWith("numeric"))
      .map((c) => [`${pgConfig(t).name}.${c.name}`, c] as const),
  );
const sqliteDecimalNames = new Set(pgDecimals.map(([name]) => name));
const sqliteDecimals = Object.values<unknown>(sqlite)
  .filter((t) => is(t, SQLiteTable))
  .flatMap((t) =>
    sqliteConfig(t)
      .columns.map((c) => [`${sqliteConfig(t).name}.${c.name}`, c] as const)
      .filter(([name]) => sqliteDecimalNames.has(name)),
  );

describe("decimal columns", () => {
  it("covers every numeric column on both schemas", () => {
    expect(pgDecimals.length).toBeGreaterThan(90);
    expect(sqliteDecimals.map(([n]) => n).sort()).toEqual(
      pgDecimals.map(([n]) => n).sort(),
    );
  });

  it.each([...pgDecimals, ...sqliteDecimals])(
    "%s reads decimal text without trailing zeros",
    (_name, column) => {
      expect(column.mapFromDriverValue("300.00")).toBe("300");
      expect(column.mapFromDriverValue("0.500000")).toBe("0.5");
      expect(column.mapFromDriverValue("1234.5")).toBe("1234.5");
    },
  );
});
