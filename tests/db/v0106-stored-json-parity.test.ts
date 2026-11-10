/**
 * The stored-JSON tag's shapes at the journal head: each shape's invented
 * rows give the same rows through the restore step and through SQLite
 * (expectRestoreMatchesSqlite), and the whole converter registry run over
 * them twice writes nothing the second time (expectRegistryReplaySafe).
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";
import { SALARY_ENTRIES_CONVERTER } from "@/lib/db/migrate/v0106-salary-entries";
import { ACTIVE_FIELDS_CONVERTER } from "@/lib/db/migrate/v0106-active-fields";
import { PERFORMANCE_CATEGORY_CONVERTER } from "@/lib/db/migrate/v0106-performance-category";
import { RETIRED_LIMITS_CONVERTER } from "@/lib/db/migrate/v0106-retired-limits";
import {
  expectRegistryReplaySafe,
  expectRestoreMatchesSqlite,
} from "./converter-replay";
import {
  JOBS,
  PROFILES as SALARY_PROFILES,
  SNAPSHOT_PERSON,
} from "./salary-entries-cases";
import {
  ACCOUNTS,
  PROFILES as CONTRIBUTION_PROFILES,
} from "./active-fields-cases";
import { PERFORMANCE_ACCOUNTS, yearRows } from "./performance-category-cases";
import { LIMITS } from "./retired-limits-cases";

const REPO = process.cwd();

type Fixture = Record<string, Record<string, unknown>[]>;

/** The salary entries' cases it converts, as SQLite stores them (JSON
 *  text, a JSON null as the text "null"). */
/** The person and jobs the salary and deduction cases are for. */
const jobRows = (): Fixture => ({
  people: [{ ...SNAPSHOT_PERSON, date_of_birth: "1980-01-01" }],
  jobs: JOBS.map((j) => ({ ...j })),
});

const salaryRows = (): Fixture => ({
  ...jobRows(),
  salary_profiles: SALARY_PROFILES.map((c) => ({
    id: c.id,
    name: `Invented ${c.id}`,
    salaries: JSON.stringify(c.before),
  })),
});

/** The active fields' cases it converts, over their accounts. */
const activeFieldsRows = (): Fixture => ({
  contribution_accounts: ACCOUNTS.map((a) => ({ ...a })),
  contribution_profiles: CONTRIBUTION_PROFILES.map((c) => ({
    id: c.id,
    name: `Invented ${c.id}`,
    contribution_active_fields: JSON.stringify(c.before),
  })),
});

/** The account-year category cases, over their performance accounts. */
const performanceRows = (): Fixture => ({
  performance_accounts: PERFORMANCE_ACCOUNTS.map((a) => ({ ...a })),
  account_performance: yearRows(),
});

/** The retired-limits cases. */
const limitRows = (): Fixture => ({
  contribution_limits: LIMITS.map((r) => ({ ...r })),
});

/** Every shape's rows, for the registry at the head. */
const allRows = (): Fixture => ({
  ...salaryRows(),
  ...activeFieldsRows(),
  ...performanceRows(),
  ...limitRows(),
});

describe("the stored-JSON tag's shapes at the journal head", () => {
  let dir: string;
  let db: Database.Database;
  const env = { ...process.env };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-stored-json-parity-"));
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
    db = new Database(process.env.SQLITE_PATH);
  });
  afterEach(() => {
    db.close();
    process.chdir(REPO);
    process.env = { ...env };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Rows into `db` as they are (text as text, booleans as 1/0). */
  function insert(rows: Fixture) {
    for (const [table, list] of Object.entries(rows))
      for (const row of list) {
        const cols = Object.keys(row);
        db.prepare(
          `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        ).run(
          ...cols.map((c) => {
            const v = row[c];
            if (typeof v === "boolean") return v ? 1 : 0;
            return typeof v === "object" && v !== null ? JSON.stringify(v) : v;
          }),
        );
      }
  }

  it("salary entries: the restore step gives SQLite's rows", () => {
    expectRestoreMatchesSqlite(db, SALARY_ENTRIES_CONVERTER, salaryRows());
  });

  it("contribution active fields: the restore step gives SQLite's rows", () => {
    expectRestoreMatchesSqlite(db, ACTIVE_FIELDS_CONVERTER, activeFieldsRows());
  });

  it("account-year categories: the restore step gives SQLite's rows", () => {
    expectRestoreMatchesSqlite(
      db,
      PERFORMANCE_CATEGORY_CONVERTER,
      performanceRows(),
    );
  });

  it("retired limits: the restore step gives SQLite's rows", () => {
    expectRestoreMatchesSqlite(db, RETIRED_LIMITS_CONVERTER, limitRows());
  });

  it("the whole registry over every shape's rows writes nothing the second time", () => {
    insert(allRows());
    expectRegistryReplaySafe(db);
  });
});
