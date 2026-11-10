/**
 * The registry as a whole: every registered converter run at the journal
 * head over older-shaped rows, then again, writes nothing the second time
 * (expectRegistryReplaySafe); and 0016 then 0017 give the same rows
 * through the restore step and through SQLite (expectRestoreMatchesSqlite).
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";
import { MATCH_RATE_CONVERTER } from "@/lib/db/migrate/v0102-match-rate";
import { MATCH_VALUE_CONVERTER } from "@/lib/db/migrate/v0102-match-value";
import { ACTIVE_FIELDS_CONVERTER } from "@/lib/db/migrate/v0106-active-fields";
import { convertBackup } from "@/lib/db/migrate/migration-converters";
import { MigrationRefusal } from "@/lib/db/migrate/converter-refusal";
import { ACCOUNT_CASES, PROFILE_CASES } from "./match-rate-cases";
import {
  expectRegistryReplaySafe,
  expectRestoreMatchesSqlite,
} from "./converter-replay";

const REPO = process.cwd();

/** Rows as 0015 left them: a match type and value, no rate (profiles
 *  with a stored entry; the column is NOT NULL). */
const fixture = () => ({
  contribution_accounts: ACCOUNT_CASES.map((c) => ({
    id: c.id,
    account_type: "401k",
    tax_treatment: "pre_tax",
    sub_type: c.subType ?? null,
    employer_match_type: c.type,
    employer_match_value: c.value,
  })),
  contribution_profiles: PROFILE_CASES.filter(
    (c) => c.before !== null && c.before !== undefined,
  ).map((c, i) => ({
    id: 1000 + i,
    name: `Invented ${i}`,
    contribution_active_fields: structuredClone(c.before),
  })),
});

/** The fixture's profiles the stored-JSON tag takes after 0016 and 0017:
 *  the ones it refuses stop the start (tested with that tag). */
function takenByEveryTag() {
  const all = fixture();
  return {
    ...all,
    contribution_profiles: all.contribution_profiles.filter((p) => {
      const tables = structuredClone({ ...all, contribution_profiles: [p] });
      const list = [MATCH_RATE_CONVERTER, MATCH_VALUE_CONVERTER];
      convertBackup(tables, { t: list }, "t");
      try {
        convertBackup(tables, { t: ACTIVE_FIELDS_CONVERTER }, "t");
        return true;
      } catch (e) {
        if (e instanceof MigrationRefusal) return false;
        throw e;
      }
    }),
  };
}

describe("the converter registry at the journal head", () => {
  let dir: string;
  const env = { ...process.env };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-converter-registry-"));
    fs.cpSync(
      path.join(REPO, "drizzle-sqlite"),
      path.join(dir, "drizzle-sqlite"),
      { recursive: true },
    );
    for (const data of ["tax-data", "reference-data"])
      fs.symlinkSync(path.join(REPO, data), path.join(dir, data));
    process.env.SQLITE_PATH = path.join(dir, "ledgr.db");
    process.env.LEDGR_BACKUP_DIR = path.join(dir, "backups");
    process.chdir(dir);
    runSQLite();
  });
  afterEach(() => {
    process.chdir(REPO);
    process.env = { ...env };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("run twice over older-shaped rows, writes nothing the second time", () => {
    const db = new Database(process.env.SQLITE_PATH!);
    for (const [table, rows] of Object.entries(takenByEveryTag()))
      for (const row of rows) {
        const cols = Object.keys(row);
        db.prepare(
          `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        ).run(
          ...Object.values(row).map((v) =>
            typeof v === "object" && v !== null ? JSON.stringify(v) : v,
          ),
        );
      }
    expectRegistryReplaySafe(db);
    db.close();
  });

  it("0016 then 0017 give the same rows on restore and on SQLite", () => {
    const db = new Database(process.env.SQLITE_PATH!);
    expectRestoreMatchesSqlite(
      db,
      [MATCH_RATE_CONVERTER, MATCH_VALUE_CONVERTER],
      fixture(),
    );
    db.close();
  });
});
