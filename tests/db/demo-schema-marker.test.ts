/**
 * Demo schema staleness stamp: the migrator (built standalone) and the app
 * must agree on the prefix and the stamp query, or every demo schema would look stale or none
 * would.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEMO_SCHEMA_MARKER_PREFIX as appPrefix,
  MIGRATION_STAMP_SUBQUERY as appStamp,
} from "@/lib/db/demo-schema-marker";
import {
  DEMO_SCHEMA_MARKER_PREFIX as migratorPrefix,
  MIGRATION_STAMP_SUBQUERY as migratorStamp,
} from "../../db-migrate";

describe("demo schema marker", () => {
  it("is the same in the app and the migrator", () => {
    expect(migratorPrefix).toBe(appPrefix);
    expect(migratorStamp).toBe(appStamp);
  });

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
