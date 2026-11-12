/**
 * A restored jsonb value is sent as JSON text cast to jsonb, so PostgreSQL
 * stores what the version read: a string that also reads as JSON stays a
 * string, false stays false. Other columns keep their old encoding.
 */
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { missingJsonb, restoredValue } from "@/lib/db/backup/restored-values";

const NULLABLE = { notNull: false };
const NOT_NULL = { notNull: true };

function query(
  value: unknown,
  jsonb: { notNull: boolean; asText?: true } | undefined,
) {
  const { sql, params } = new PgDialect().sqlToQuery(
    restoredValue(value, jsonb),
  );
  return { sql, params };
}

describe("restoredValue", () => {
  it.each([
    ["60000", '"60000"'],
    ["false", '"false"'],
    ["2026-09-05T22:04:49.000Z", '"2026-09-05T22:04:49.000Z"'],
    [42, "42"],
    [false, "false"],
    [{ goals: [1, "2"] }, '{"goals":[1,"2"]}'],
  ])("sends the jsonb value %j as %s::jsonb", (value, text) => {
    expect(query(value, NULLABLE)).toEqual({
      sql: "$1::jsonb",
      params: [text],
    });
  });

  it("leaves null, and a value outside a jsonb column, as before", () => {
    expect(query(null, NULLABLE).sql).toBe("NULL");
    expect(query(null, undefined).sql).toBe("NULL");
    expect(query("60000", undefined)).toEqual({ sql: "$1", params: ["60000"] });
    expect(query(true, undefined).sql).toBe("TRUE");
  });

  it("writes a missing value in a NOT NULL jsonb column as JSON null", () => {
    expect(query(null, NOT_NULL)).toEqual({ sql: "'null'::jsonb", params: [] });
    expect(query(undefined, NOT_NULL).sql).toBe("'null'::jsonb");
    expect(missingJsonb(NOT_NULL)).toBe("'null'::jsonb");
    expect(missingJsonb(NULLABLE)).toBe("NULL");
  });

  it("writes a PostgreSQL source's parsed JSON as JSON text on SQLite", () => {
    const TEXT = { notNull: true, asText: true as const };
    expect(query("60000", TEXT)).toEqual({ sql: "$1", params: ['"60000"'] });
    expect(query(true, TEXT)).toEqual({ sql: "$1", params: ["true"] });
    expect(query(null, TEXT).sql).toBe("'null'");
    expect(query(null, { notNull: false, asText: true }).sql).toBe("NULL");
  });
});
