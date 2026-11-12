/**
 * Demo schema staleness stamp: the migrator and the app share one prefix and
 * stamp query (db-migrate.ts imports them), or every demo schema would look
 * stale or none would.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  MIGRATION_STAMP_SUBQUERY as appStamp,
  demoSchemaMarker,
  markerStampSql,
} from "@/lib/db/migrate/demo-schema-marker";

describe("demo schema marker", () => {
  it("stamps the last migration hash, not just the count (a squash resets the count)", () => {
    expect(appStamp).toMatch(/ORDER BY id DESC LIMIT 1/);
  });

  it("drops stale demo schemas on every start, fatally on failure", () => {
    const src = readFileSync("db-migrate.ts", "utf8");
    const block = src.slice(
      src.indexOf("Drop stale demo schemas"),
      src.indexOf("Write upgrade banner flag"),
    );
    // Not gated on a migration having run this start.
    expect(block).not.toMatch(/if \(backupPath\)/);
    expect(block).toMatch(/IS DISTINCT FROM/);
    // It compares the stamp part only: the seeded day doesn't make a schema stale.
    expect(block).toMatch(/markerStampSql\(/);
    expect(block).toMatch(/throw new Error/);
  });

  it("a marker is the stamp, then the seeded day, which the stamp part leaves out", () => {
    expect(demoSchemaMarker("21:ab12", "2026-11-11")).toBe(
      "ledgr-migrations:21:ab12 seeded:2026-11-11",
    );
    expect(markerStampSql("m")).toBe("split_part(m, ' seeded:', 1)");
  });
});
