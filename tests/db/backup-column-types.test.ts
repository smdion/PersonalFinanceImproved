/** The PostgreSQL pre-upgrade backup reads a `date` column as its stored
 *  text, so a backup written east of UTC keeps the day; every other type
 *  parses as node-pg's default does. */
import { describe, it, expect } from "vitest";
import pg from "pg";
import { backupColumnTypes } from "../../db-migrate";

const DATE = 1082;
const INT4 = 23;
const TIMESTAMPTZ = 1184;

describe("the pre-upgrade backup's column types", () => {
  const types = backupColumnTypes(pg.types);

  it("keeps a date as its YYYY-MM-DD text", () => {
    expect(types.getTypeParser(DATE, "text")("2026-01-15")).toBe("2026-01-15");
  });

  it("parses every other type as node-pg does", () => {
    for (const [oid, text] of [
      [INT4, "42"],
      [TIMESTAMPTZ, "2026-01-15 08:00:00+00"],
    ] as const)
      expect(types.getTypeParser(oid, "text")(text)).toEqual(
        pg.types.getTypeParser(oid, "text")(text),
      );
  });

  it("node-pg's default for a date would write the day before east of UTC", () => {
    const saved = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati";
    try {
      const parsed: unknown = pg.types.getTypeParser(
        DATE,
        "text",
      )("2026-01-15");
      expect(JSON.stringify(parsed)).toBe('"2026-01-14T10:00:00.000Z"');
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});
