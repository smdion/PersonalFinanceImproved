/**
 * Reference data re-applied outside the migrator (restore, import, reset,
 * demo build) reads the same seed file, split the same way.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { referenceTableNames, seedStatements } from "@/lib/db/reference-data";
import { REFERENCE_SEED_TABLES } from "../../db-migrate";

const seed = readFileSync("seed-reference-data.sql", "utf8");

describe("reference data", () => {
  it("splits the seed into its statements (inserts + corrections), values with semicolons intact", () => {
    const statements = seedStatements(seed);
    expect(statements).toHaveLength(
      seed.match(/^\s*(INSERT\s+INTO|UPDATE)\b/gim)!.length,
    );
    for (const s of statements) expect(s).toMatch(/^(INSERT\s+INTO|UPDATE)\b/i);
    // A value holding a semicolon stays inside its statement.
    expect(statements.some((s) => s.includes("(IRC 3102(f)); liability"))).toBe(
      true,
    );
  });

  it("names the same tables as the migrator's reconcile", () => {
    expect(referenceTableNames(seed).sort()).toEqual(
      [...REFERENCE_SEED_TABLES].sort(),
    );
  });
});
