/**
 * A row reads the same on both dialects: the PostgreSQL runner gives a
 * date as SQLite's "YYYY-MM-DD" text and a timestamp as ISO text, never a
 * Date; a boolean, which still differs by dialect, reads alike through
 * asBool.
 */
import { describe, it, expect } from "vitest";
import { asBool } from "@/lib/db/migrate/converter-rows";
import {
  runConverterPg,
  type ConverterTables,
  type DataConverter,
} from "@/lib/db/migrate/migration-converters";

describe("the PostgreSQL runner's rows", () => {
  it("gives dates and timestamps as text", async () => {
    const seen: ConverterTables[] = [];
    const reads: DataConverter = {
      tables: ["invented"],
      runs: "afterSql",
      convert: (t) => {
        seen.push(t);
        return { updates: [], notes: [] };
      },
    };
    const client = {
      query: async (sql: string) =>
        sql.startsWith("SELECT *")
          ? {
              rows: [
                {
                  id: 1,
                  day: new Date(2026, 0, 31),
                  at: new Date(Date.UTC(2026, 0, 31, 12, 30)),
                },
              ],
              fields: [
                { name: "id", dataTypeID: 23 },
                { name: "day", dataTypeID: 1082 },
                { name: "at", dataTypeID: 1184 },
              ],
            }
          : { rows: [{ present: true }], rowCount: 1 },
    };
    await runConverterPg(client, { t: reads }, "t", "afterSql");
    expect(seen[0]!["invented"]).toEqual([
      {
        id: 1,
        day: "2026-01-31",
        at: "2026-01-31T12:30:00.000Z",
      },
    ]);
  });
});

describe("asBool", () => {
  it.each([
    [true, true],
    [1, true],
    ["1", true],
    ["true", true],
    [false, false],
    [0, false],
    ["0", false],
    ["false", false],
    [null, null],
    ["yes", null],
    [2, null],
  ])("asBool(%j) is %j", (v, b) => {
    expect(asBool(v)).toBe(b);
  });
});
