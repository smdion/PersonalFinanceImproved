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
    expect(reconcile(db)).toEqual({ inserted: 0, updated: 0, changes: [] });
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

  it("a year started early gets a figure added in this release, carried forward", () => {
    // "+ Year 2027" before a release that adds a new required figure: 2027
    // has the household's own rows but not the new one.
    const db = openTestSqlite();
    db.prepare(
      "INSERT INTO contribution_limits (tax_year, limit_type, value, origin) VALUES (2027, 'ira_limit', '8000', 'user')",
    ).run();
    reconcile(db);
    expect(limit(db, 2027, "qcd_annual_limit")).toMatchObject({
      origin: "carried",
      confirmed_at: null,
    });
    expect(Number(limit(db, 2027, "qcd_annual_limit").value)).toBe(111000);
    // Its own rows stand; running again adds nothing more.
    expect(limit(db, 2027, "ira_limit")).toMatchObject({
      value: "8000",
      origin: "user",
    });
    const count = () =>
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM contribution_limits WHERE tax_year = 2027",
          )
          .get() as { n: number }
      ).n;
    const before = count();
    reconcile(db);
    expect(count()).toBe(before);
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

describe("community mode (an approved community update)", () => {
  const community = (db: Db, file: TaxDataFile) =>
    reconcileReferenceRowsSync(
      (text, params) => {
        const stmt = db.prepare(text);
        if (stmt.reader)
          return stmt.all(...params) as Record<string, unknown>[];
        stmt.run(...params);
        return [];
      },
      file,
      "community",
    );
  /** The shipped file one version on, with one figure changed. */
  const update = (change: (f: TaxDataFile) => void) => {
    const f = JSON.parse(JSON.stringify(readTaxData())) as TaxDataFile;
    f.dataVersion += 1;
    change(f);
    return f;
  };

  it("writes and lists only the figures whose value changes, as community", () => {
    const db = openTestSqlite();
    reconcile(db);
    const f = update((f) => {
      f.years["2026"]!.limits.ira_limit!.value = 7600;
    });
    const r = community(db, f);
    expect(r.changes).toEqual([
      {
        table: "contribution_limits",
        key: "2026|ira_limit",
        kind: "update",
        from: expect.anything(),
        to: 7600,
      },
    ]);
    expect(limit(db, 2026, "ira_limit")).toMatchObject({
      origin: "community",
      source_version: f.dataVersion,
    });
    // An unchanged figure keeps its shipped marking.
    expect(limit(db, 2026, "ss_wage_base")).toMatchObject({ origin: "seed" });
  });

  it("never reclassifies the household's rows, even one matching a superseded value", () => {
    const db = openTestSqlite();
    reconcile(db);
    // A pre-tracking household edit equal to a value the update supersedes.
    setLimit(db, 2026, "ira_limit", 7000, "user");
    const f = update((f) => {
      f.years["2026"]!.limits.ira_limit!.supersedes = [7000];
      f.years["2026"]!.limits.ira_limit!.value = 7600;
    });
    expect(community(db, f).changes).toEqual([]);
    expect(limit(db, 2026, "ira_limit")).toMatchObject({
      value: "7000",
      origin: "user",
    });
  });

  it("a newer shipped file wins over an older community update, never the reverse", () => {
    const db = openTestSqlite();
    reconcile(db);
    const shipped = readTaxData();
    const c = update((f) => {
      f.years["2026"]!.limits.ira_limit!.value = 7600;
    });
    community(db, c);
    // The same (older) shipped file on the next start: no downgrade.
    reconcile(db, shipped);
    expect(Number(limit(db, 2026, "ira_limit").value)).toBe(7600);
    // A release with a higher dataVersion: its figure wins.
    const newer = JSON.parse(JSON.stringify(shipped)) as TaxDataFile;
    newer.dataVersion = c.dataVersion + 1;
    newer.years["2026"]!.limits.ira_limit!.value = 7700;
    reconcile(db, newer);
    expect(limit(db, 2026, "ira_limit")).toMatchObject({ origin: "seed" });
    expect(Number(limit(db, 2026, "ira_limit").value)).toBe(7700);
  });

  it("a preview (writes skipped) lists exactly what applying changes", () => {
    const db = openTestSqlite();
    reconcile(db);
    const f = update((f) => {
      f.years["2026"]!.limits.ira_limit!.value = 7600;
      f.years["2026"]!.limits.ss_wage_base!.value = 190000;
    });
    const preview = reconcileReferenceRowsSync(
      (text, params) =>
        /^\s*SELECT/i.test(text)
          ? (db.prepare(text).all(...params) as Record<string, unknown>[])
          : [],
      f,
      "community",
    );
    expect(Number(limit(db, 2026, "ira_limit").value)).toBe(7500);
    expect(community(db, f).changes).toEqual(preview.changes);
    expect(preview.changes).toHaveLength(2);
  });
});
