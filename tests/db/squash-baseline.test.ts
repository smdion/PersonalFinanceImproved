/**
 * The v0.8.0 squashed baseline (0000_v8_initial_schema) must produce a
 * usable fresh database on its own — including the hand-edited profile
 * seed carried forward from 0008_kill_live_sentinel. Without that seed a
 * fresh install has no active Salary or Contribution profile and the
 * router layer falls over.
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

function migratedDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  const sql = fs.readFileSync(
    path.join(process.cwd(), "drizzle-sqlite", "0000_v8_initial_schema.sql"),
    "utf8",
  );
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const t = stmt.trim();
    if (t) db.exec(t);
  }
  return db;
}

describe("v0.8.0 squashed baseline (SQLite)", () => {
  it("creates every schema table in one migration", () => {
    const db = migratedDb();
    const n = db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
      )
      .get() as { n: number };
    expect(n.n).toBe(72);
  });

  it("seeds exactly one active Salary profile and one active Contribution profile", () => {
    const db = migratedDb();
    const sp = db
      .prepare("SELECT count(*) AS n FROM salary_profiles")
      .get() as { n: number };
    const cp = db
      .prepare("SELECT count(*) AS n FROM contribution_profiles")
      .get() as { n: number };
    const active = db
      .prepare(
        "SELECT key, value FROM app_settings WHERE key IN ('active_salary_profile_id', 'active_contrib_profile_id') ORDER BY key",
      )
      .all() as { key: string; value: string }[];
    expect(sp.n).toBe(1);
    expect(cp.n).toBe(1);
    expect(active.map((r) => r.key)).toEqual([
      "active_contrib_profile_id",
      "active_salary_profile_id",
    ]);
    // Each points at a real row id, not null/0.
    for (const r of active) {
      expect(r.value).not.toBeNull();
      expect(JSON.parse(r.value)).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps the partial unique index on jobs.is_speculative (one speculative job per person)", () => {
    const db = migratedDb();
    const idx = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='jobs' AND sql LIKE '%UNIQUE%' AND sql LIKE '%is_speculative%'",
      )
      .get() as { sql: string } | undefined;
    expect(idx?.sql).toBeTruthy();
    expect(idx!.sql).toMatch(/person_id/);
    expect(idx!.sql).toMatch(/WHERE\s+.*is_speculative/i);
  });

  it("re-applying the baseline is idempotent (squash-recovery replay leaves seed counts unchanged)", () => {
    const db = migratedDb();
    const sql = fs.readFileSync(
      path.join(process.cwd(), "drizzle-sqlite", "0000_v8_initial_schema.sql"),
      "utf8",
    );
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const t = stmt.trim();
      if (!t) continue;
      try {
        db.exec(t);
      } catch (err) {
        // CREATE TABLE / INDEX "already exists" is expected on replay
        if (!/already exists|duplicate/i.test((err as Error).message))
          throw err;
      }
    }
    const sp = db
      .prepare("SELECT count(*) AS n FROM salary_profiles")
      .get() as { n: number };
    const cp = db
      .prepare("SELECT count(*) AS n FROM contribution_profiles")
      .get() as { n: number };
    expect(sp.n).toBe(1);
    expect(cp.n).toBe(1);
  });
});
