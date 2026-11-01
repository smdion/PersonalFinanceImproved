/**
 * Migration 0007 scrubs credentials logged before v0.9.5 out of the change
 * log — the same keys `redactSecrets` keeps out of it from now on — and
 * leaves every other value, and a re-run, alone.
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { REDACTED, SECRET_INPUT_KEYS } from "@/lib/utils/redact-secrets";

const tag = "0007_v095_redact_change_log";

function exec(db: Database.Database, folder: string) {
  const sql = fs.readFileSync(path.join(folder, `${tag}.sql`), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint"))
    if (stmt.trim()) db.exec(stmt);
}

describe("migration 0007", () => {
  function logged(values: unknown[]) {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE change_log (id integer primary key, new_value text)");
    const ins = db.prepare("INSERT INTO change_log (new_value) VALUES (?)");
    for (const v of values) ins.run(v === null ? null : JSON.stringify(v));
    return db;
  }
  const read = (db: Database.Database) =>
    db
      .prepare("SELECT new_value FROM change_log ORDER BY id")
      .all()
      .map((r) => {
        const v = (r as { new_value: string | null }).new_value;
        return v === null ? null : JSON.parse(v);
      });

  it("replaces each credential and keeps the rest", () => {
    const db = logged([
      { service: "actual", serverUrl: "u", apiKey: "k" },
      { service: "ynab", accessToken: "t", budgetId: "b" },
      { setupToken: "s" },
      { id: 4, name: "keep" },
      null,
    ]);
    exec(db, "drizzle-sqlite");
    expect(read(db)).toEqual([
      { service: "actual", serverUrl: "u", apiKey: REDACTED },
      { service: "ynab", accessToken: REDACTED, budgetId: "b" },
      { setupToken: REDACTED },
      { id: 4, name: "keep" },
      null,
    ]);
    exec(db, "drizzle-sqlite");
    expect(read(db)[0]).toEqual({
      service: "actual",
      serverUrl: "u",
      apiKey: REDACTED,
    });
  });

  it("both dialects scrub exactly the keys redactSecrets does", () => {
    for (const folder of ["drizzle", "drizzle-sqlite"]) {
      const sql = fs.readFileSync(path.join(folder, `${tag}.sql`), "utf8");
      for (const key of SECRET_INPUT_KEYS) expect(sql).toContain(`${key}'`);
    }
  });
});

describe("migration 0008", () => {
  it("adds the IRMAA choice, in the budget by default, on both dialects", () => {
    for (const folder of ["drizzle", "drizzle-sqlite"]) {
      const sql = fs.readFileSync(
        path.join(folder, "0008_v095_irmaa_budget.sql"),
        "utf8",
      );
      expect(sql).toContain("irmaa_on_top_of_budget");
      expect(sql).toMatch(/DEFAULT false NOT NULL/);
    }
  });
});

describe("migration 0010", () => {
  it("adds market_closes, one row per ticker and day, on both dialects", () => {
    for (const folder of ["drizzle", "drizzle-sqlite"]) {
      const sql = fs.readFileSync(
        path.join(folder, "0010_v095_market_closes.sql"),
        "utf8",
      );
      expect(sql).toContain("market_closes_ticker_date_idx");
    }
  });
});

describe("migration 0009", () => {
  it("keys a feed's holdings by report, on both dialects", () => {
    for (const folder of ["drizzle", "drizzle-sqlite"]) {
      const sql = fs.readFileSync(
        path.join(folder, "0009_v095_holding_reports.sql"),
        "utf8",
      );
      expect(sql).toContain("holding_observations_simplefin_report_idx");
      expect(sql).toMatch(/"balance_date" IS NULL/);
    }
  });
});
