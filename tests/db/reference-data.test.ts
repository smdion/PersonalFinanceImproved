/**
 * Reference data comes from the tax-data file through one reconcile — the
 * migrator's copy is identical, it never touches a figure the household
 * changed, and it corrects installs still holding an older shipped value.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { openTestSqlite } from "../helpers/db-harness";
import { readTaxData } from "../helpers/tax-data";
import {
  reconcileReferenceRowsSync,
  sameReferenceValue,
  shippedReferenceRows,
  type TaxDataFile,
} from "@/lib/db/reference-reconcile-core";
import { REFERENCE_TABLES, toSql } from "@/lib/db/reference-data";
import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { REFERENCE_SEED_TABLES, V08_MIGRATION_HASHES } from "../../db-migrate";

type Db = ReturnType<typeof openTestSqlite>;

const reconcile = (db: Db, file: TaxDataFile = readTaxData()) =>
  reconcileReferenceRowsSync((text, params) => {
    const stmt = db.prepare(text);
    if (stmt.reader) return stmt.all(...params) as Record<string, unknown>[];
    stmt.run(...params);
    return [];
  }, file);

const limit = (db: Db, year: number, type: string) =>
  db
    .prepare(
      "SELECT value, origin, source_version, confirmed_at FROM contribution_limits WHERE tax_year = ? AND limit_type = ?",
    )
    .get(year, type) as {
    value: string;
    origin: string;
    source_version: number | null;
    confirmed_at: number | null;
  };

const setLimit = (
  db: Db,
  year: number,
  type: string,
  value: number,
  origin: string,
  confirmedAt: number | null = null,
) =>
  db
    .prepare(
      "UPDATE contribution_limits SET value = ?, origin = ?, confirmed_at = ?, source_version = NULL WHERE tax_year = ? AND limit_type = ?",
    )
    .run(String(value), origin, confirmedAt, year, type);

describe("the migrator's reconcile", () => {
  it("is a verbatim copy of reference-reconcile-core.ts", () => {
    const block = (file: string) => {
      const s = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      return s.slice(
        s.indexOf("// BEGIN reference-reconcile-core"),
        s.indexOf("// END reference-reconcile-core"),
      );
    };
    const src = block("src/lib/db/reference-reconcile-core.ts");
    expect(src.length).toBeGreaterThan(2000);
    expect(block("db-migrate.ts")).toBe(src);
  });

  it("writes the same tables as the app", () => {
    expect([...REFERENCE_SEED_TABLES].sort()).toEqual(
      [...REFERENCE_TABLES].sort(),
    );
    const written = new Set(
      shippedReferenceRows(readTaxData()).map((r) => r.table),
    );
    for (const t of written) expect(REFERENCE_TABLES).toContain(t);
  });
});

describe("reconcile", () => {
  it("a fresh database holds exactly the file, marked shipped", () => {
    const db = openTestSqlite();
    const file = readTaxData();
    for (const r of shippedReferenceRows(file)) {
      const where = r.keyCols.map((c) => `${c} = ?`).join(" AND ");
      const row = db
        .prepare(`SELECT * FROM ${r.table} WHERE ${where}`)
        .get(...r.keyVals.map((v) => (typeof v === "boolean" ? +v : v))) as
        Record<string, unknown> | undefined;
      expect(row, `${r.table} ${r.keyVals.join("/")}`).toBeDefined();
      expect(sameReferenceValue(row![r.valueCol], r.value, r.json)).toBe(true);
      expect(row!.origin).toBe("seed");
      expect(row!.source_version).toBe(file.dataVersion);
    }
  });

  it("running again changes nothing", () => {
    const db = openTestSqlite();
    expect(reconcile(db)).toEqual({ inserted: 0, updated: 0 });
  });

  it("an install still on a superseded figure is corrected (never classified before)", () => {
    const db = openTestSqlite();
    setLimit(db, 2025, "standard_deduction_mfj", 30000, "user"); // pre-OBBBA seed
    reconcile(db);
    expect(limit(db, 2025, "standard_deduction_mfj")).toMatchObject({
      origin: "seed",
    });
    expect(Number(limit(db, 2025, "standard_deduction_mfj").value)).toBe(31500);
  });

  it("an old withholding table (pre-R58) is corrected too", () => {
    const db = openTestSqlite();
    const file = readTaxData();
    const old =
      file.years["2025"]!.withholding.supersedes?.Single?.standard?.[0];
    expect(old).toBeDefined();
    db.prepare(
      "UPDATE tax_brackets SET brackets = ?, origin = 'user', source_version = NULL WHERE tax_year = 2025 AND filing_status = 'Single' AND w4_checkbox = 0",
    ).run(JSON.stringify(old));
    reconcile(db);
    const row = db
      .prepare(
        "SELECT brackets, origin FROM tax_brackets WHERE tax_year = 2025 AND filing_status = 'Single' AND w4_checkbox = 0",
      )
      .get() as { brackets: string; origin: string };
    expect(row.origin).toBe("seed");
    expect(
      sameReferenceValue(
        row.brackets,
        file.years["2025"]!.withholding.tables.Single!.standard,
        true,
      ),
    ).toBe(true);
  });

  it("a figure the household changed is never touched — even one equal to an old shipped value", () => {
    const db = openTestSqlite();
    setLimit(db, 2025, "standard_deduction_mfj", 30000, "user", 1_700_000_000);
    setLimit(db, 2026, "ira_limit", 9999, "user");
    reconcile(db);
    expect(Number(limit(db, 2025, "standard_deduction_mfj").value)).toBe(30000);
    expect(limit(db, 2026, "ira_limit")).toMatchObject({
      value: "9999",
      origin: "user",
    });
  });

  it("copy-then-release: a carried-forward figure takes the shipped value", () => {
    const db = openTestSqlite();
    setLimit(db, 2026, "ira_limit", 7000, "carried");
    reconcile(db);
    expect(limit(db, 2026, "ira_limit")).toMatchObject({ origin: "seed" });
    expect(Number(limit(db, 2026, "ira_limit").value)).toBe(7500);
  });

  it("a year the file doesn't have is never touched or removed", () => {
    const db = openTestSqlite();
    db.prepare(
      "INSERT INTO contribution_limits (tax_year, limit_type, value, origin) VALUES (2030, 'ira_limit', '9000', 'carried')",
    ).run();
    reconcile(db);
    expect(limit(db, 2030, "ira_limit")).toMatchObject({
      value: "9000",
      origin: "carried",
    });
  });

  it("a newer file updates shipped rows and tax_params; an older one never downgrades", () => {
    const db = openTestSqlite();
    const file = readTaxData();
    const newer: TaxDataFile = structuredClone(file);
    newer.dataVersion = file.dataVersion + 1;
    newer.years["2026"]!.limits.ira_limit!.value = 7600;
    newer.years["2026"]!.revision += 1;
    reconcile(db, newer);
    expect(Number(limit(db, 2026, "ira_limit").value)).toBe(7600);
    const rev = db
      .prepare("SELECT version FROM tax_params WHERE tax_year = 2026")
      .get() as { version: number };
    expect(rev.version).toBe(newer.years["2026"]!.revision);
    // Rolling back to the older image's file leaves the newer figure.
    reconcile(db, file);
    expect(Number(limit(db, 2026, "ira_limit").value)).toBe(7600);
  });

  it("refuses a file in a newer format", () => {
    const db = openTestSqlite();
    expect(() =>
      reconcile(db, { ...readTaxData(), formatVersion: 99 }),
    ).toThrow(/format 99/);
  });
});

describe("migration bookkeeping", () => {
  it("every PostgreSQL migration's file hash is registered (backups are labelled by it)", () => {
    const journal = JSON.parse(
      fs.readFileSync("drizzle/meta/_journal.json", "utf8"),
    ) as { entries: { tag: string }[] };
    const missing = journal.entries
      .map((e) => {
        const hash = createHash("sha256")
          .update(fs.readFileSync(`drizzle/${e.tag}.sql`))
          .digest("hex");
        return V08_MIGRATION_HASHES[hash] === e.tag ? null : e.tag;
      })
      .filter(Boolean);
    expect(missing).toEqual([]);
  });
});

describe("the app's statement adapter", () => {
  it("turns ? placeholders into ordered Postgres parameters", () => {
    const q = new PgDialect().sqlToQuery(
      toSql("UPDATE t SET a = ?, b = ? WHERE c = ? AND d = ?", [
        1,
        "x",
        true,
        4,
      ]),
    );
    expect(q.sql).toBe("UPDATE t SET a = $1, b = $2 WHERE c = $3 AND d = $4");
    expect(q.params).toEqual([1, "x", true, 4]);
  });
});
