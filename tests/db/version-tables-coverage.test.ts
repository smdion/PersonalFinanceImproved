/**
 * Every table in the schema must be accounted for by the state-version
 * registry — either included (VERSION_TABLES) or deliberately excluded
 * (EXCLUDED_TABLES). A table that is in neither is silently dropped from
 * pre-upgrade backups and state-version snapshots/restores.
 *
 * This has been the recurring failure mode across three schema squashes
 * (utility_service/utility_reading missed in the v0.7.0 squash;
 * account_basis / *_category_links missed in the v0.8.0 squash). The
 * check below makes it a build failure instead of a review miss.
 */
import { describe, it, expect } from "vitest";
import { getTableName } from "drizzle-orm";
import * as pgSchema from "@/lib/db/schema-pg";
import { VERSION_TABLE_NAMES, EXCLUDED_TABLES } from "@/lib/db/version-tables";

function allSchemaTableNames(): string[] {
  const names: string[] = [];
  for (const value of Object.values(pgSchema)) {
    try {
      const name = getTableName(value as never);
      if (name) names.push(name);
    } catch {
      // not a table
    }
  }
  return names.sort();
}

describe("state-version table registry coverage", () => {
  it("every schema table is either versioned or explicitly excluded", () => {
    const accounted = new Set([...VERSION_TABLE_NAMES, ...EXCLUDED_TABLES]);
    const unaccounted = allSchemaTableNames().filter((t) => !accounted.has(t));
    expect(unaccounted).toEqual([]);
  });

  it("VERSION_TABLES and EXCLUDED_TABLES do not overlap", () => {
    const versioned = new Set(VERSION_TABLE_NAMES);
    const overlap = EXCLUDED_TABLES.filter((t) => versioned.has(t));
    expect(overlap).toEqual([]);
  });

  it("every excluded table actually exists in the schema", () => {
    const schemaTables = new Set(allSchemaTableNames());
    const phantom = EXCLUDED_TABLES.filter((t) => !schemaTables.has(t));
    expect(phantom).toEqual([]);
  });
});
