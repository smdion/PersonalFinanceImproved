/**
 * Demo schema staleness stamp: the migrator and the app share one prefix and
 * stamp query (db-migrate.ts imports them), or every demo schema would look
 * stale or none would.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MIGRATION_STAMP_SUBQUERY as appStamp } from "@/lib/db/demo-schema-marker";

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
    expect(block).toMatch(/throw new Error/);
  });
});
