/**
 * The money tag's shapes at the journal head: each shape's invented rows
 * give the same rows through the restore step and through SQLite
 * (expectRestoreMatchesSqlite), and the whole converter registry run over
 * them twice writes nothing the second time (expectRegistryReplaySafe).
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";
import { RETIREMENT_PEOPLE_CONVERTER } from "@/lib/db/migrate/v0106-retirement-people";
import {
  expectRegistryReplaySafe,
  expectRestoreMatchesSqlite,
} from "./converter-replay";
import { HELD, PEOPLE, PROFILES, SETTINGS } from "./retirement-people-cases";

const REPO = process.cwd();

type Fixture = Record<string, Record<string, unknown>[]>;

/** The per-person retirement rows' cases, as rows a database takes. */
const retirementRows = (): Fixture => ({
  people: PEOPLE.map((p) => ({
    ...p,
    date_of_birth: "1980-01-01",
  })),
  retirement_profiles: PROFILES.map((p) => ({ ...p })),
  retirement_settings: SETTINGS.map((s) => ({
    ...s,
    return_after_retirement: "0.05",
    annual_inflation: "0.03",
  })),
  retirement_profile_people: HELD.map((r) => ({ ...r })),
});

/** Every shape's rows, for the registry at the head. */
const allRows = (): Fixture => ({ ...retirementRows() });

describe("the money tag's shapes at the journal head", () => {
  let dir: string;
  let db: Database.Database;
  const env = { ...process.env };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-money-parity-"));
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

  /** Rows into `db` as they are (JSON as text, booleans as 1/0). */
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

  it("per-person retirement rows: the restore step gives SQLite's rows", () => {
    expectRestoreMatchesSqlite(
      db,
      RETIREMENT_PEOPLE_CONVERTER,
      retirementRows(),
    );
  });

  it("the whole registry over every shape's rows writes nothing the second time", () => {
    insert(allRows());
    expectRegistryReplaySafe(db);
  });
});
