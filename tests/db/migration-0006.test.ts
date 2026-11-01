/**
 * Migration 0006 keeps existing households' projections: every
 * retirement_settings row that existed gets Social Security out of the
 * four existing portfolio-sized strategies' amounts; VPW's switch stays
 * empty. And a re-run never undoes a household's own choice.
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

const FOLDER = "drizzle-sqlite";
const tags = (
  JSON.parse(
    fs.readFileSync(path.join(FOLDER, "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] }
).entries.map((e) => e.tag);

function exec(db: Database.Database, tag: string) {
  const sql = fs.readFileSync(path.join(FOLDER, `${tag}.sql`), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint"))
    if (stmt.trim()) db.exec(stmt);
}

const SWITCHES =
  "cp_ss_in_amount, en_ss_in_amount, vd_ss_in_amount, rmd_ss_in_amount, vpw_ss_in_amount";

describe("migration 0006", () => {
  const at = tags.indexOf("0006_v095_milestones");

  function beforeMigration() {
    const db = new Database(":memory:");
    for (const tag of tags.slice(0, at)) exec(db, tag);
    db.prepare(
      "INSERT INTO people (id, name, date_of_birth) VALUES (1, 'Example Person', '1980-01-01')",
    ).run();
    db.prepare(
      `INSERT INTO retirement_settings (person_id, retirement_age, end_age, return_after_retirement, annual_inflation, salary_annual_increase)
       VALUES (1, 65, 95, '0.06', '0.03', '0.03')`,
    ).run();
    return db;
  }

  it("existing rows get the four switches on and VPW's empty", () => {
    const db = beforeMigration();
    exec(db, tags[at]!);
    expect(
      db.prepare(`SELECT ${SWITCHES} FROM retirement_settings`).get(),
    ).toEqual({
      cp_ss_in_amount: 1,
      en_ss_in_amount: 1,
      vd_ss_in_amount: 1,
      rmd_ss_in_amount: 1,
      vpw_ss_in_amount: null,
    });
  });

  it("re-running its backfill leaves a household's own choice alone", () => {
    const db = beforeMigration();
    exec(db, tags[at]!);
    db.prepare("UPDATE retirement_settings SET cp_ss_in_amount = 0").run();
    const backfill = fs
      .readFileSync(path.join(FOLDER, `${tags[at]}.sql`), "utf8")
      .split("--> statement-breakpoint")
      .find((s) => s.includes("UPDATE"))!;
    db.exec(backfill);
    expect(
      db.prepare("SELECT cp_ss_in_amount FROM retirement_settings").get(),
    ).toEqual({ cp_ss_in_amount: 0 });
  });
});
