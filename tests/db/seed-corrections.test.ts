/**
 * The seed's corrections section (seed-reference-data.sql) fixes a value an
 * earlier seed got wrong when the migrate re-runs it — but only where the
 * row still holds the exact old figure, never an admin's own edit.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { openTestSqlite } from "../helpers/db-harness";

const seed = fs.readFileSync(
  path.resolve(__dirname, "../../seed-reference-data.sql"),
  "utf-8",
);

function mfj2025(db: ReturnType<typeof openTestSqlite>): number {
  const row = db
    .prepare(
      "SELECT value FROM contribution_limits WHERE tax_year = 2025 AND limit_type = 'standard_deduction_mfj'",
    )
    .get() as { value: number };
  return Number(row.value);
}
const setMfj2025 = (db: ReturnType<typeof openTestSqlite>, v: number) =>
  db
    .prepare(
      "UPDATE contribution_limits SET value = ? WHERE tax_year = 2025 AND limit_type = 'standard_deduction_mfj'",
    )
    .run(v);

describe("seed corrections", () => {
  it("an install still on the old figure is corrected on the next migrate", () => {
    const db = openTestSqlite();
    setMfj2025(db, 30000); // seeded before the fix
    db.exec(seed); // what db-migrate does on every deploy
    expect(mfj2025(db)).toBe(31500);
  });

  it("an admin's own edit is left alone", () => {
    const db = openTestSqlite();
    setMfj2025(db, 30500);
    db.exec(seed);
    expect(mfj2025(db)).toBe(30500);
  });
});
