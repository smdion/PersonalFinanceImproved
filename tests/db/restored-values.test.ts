/**
 * A restored jsonb value is sent as JSON text cast to jsonb, so PostgreSQL
 * stores what the version read: a string that also reads as JSON stays a
 * string, false stays false. Other columns keep their old encoding.
 */
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { restoredValue } from "@/lib/db/backup/restored-values";

function query(value: unknown, jsonb: boolean) {
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
    expect(query(value, true)).toEqual({ sql: "$1::jsonb", params: [text] });
  });

  it("leaves null, and a value outside a jsonb column, as before", () => {
    expect(query(null, true).sql).toBe("NULL");
    expect(query("60000", false)).toEqual({ sql: "$1", params: ["60000"] });
    expect(query(true, false).sql).toBe("TRUE");
  });
});
