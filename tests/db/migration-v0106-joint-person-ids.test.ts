/**
 * The credentials tag's joint step through the real SQLite migrator: an
 * install at the tag before it gets every joint contribution account's
 * person cleared as a pending migration, and a later start changes
 * nothing; run again over its own output, and with the whole registry at
 * the head, it writes nothing; the restore step gives the rows SQLite
 * gives; an undecidable row refuses the start, naming its id and no name,
 * and nothing changes, the tag's credential and mapping steps included.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { runSQLite } from "../../db-migrate";
import { CREDENTIALS_TAG } from "@/lib/db/migrate/v0106-credentials";
import { JOINT_PERSON_IDS_CONVERTER } from "@/lib/db/migrate/v0106-joint-person-ids";
import { MigrationRefusal } from "@/lib/db/migrate/converter-refusal";
import {
  expectNoCellText,
  expectRegistryReplaySafe,
  expectRestoreMatchesSqlite,
  expectSqliteReplaySafe,
} from "./converter-replay";
import {
  ACCOUNT_CASES,
  JOBS,
  NAMES,
  PEOPLE,
  PROFILES,
  UNDECIDABLE,
} from "./joint-person-ids-cases";

const REPO = process.cwd();
const FOLDER = "drizzle-sqlite";

/** The cases' rows, parents first. */
const fixture = (extra: Record<string, unknown>[] = []) => ({
  people: PEOPLE.map((p) => ({ ...p })),
  jobs: JOBS.map((j) => ({ ...j })),
  contribution_accounts: [
    ...ACCOUNT_CASES.map((c): Record<string, unknown> => ({ ...c.row })),
    ...extra,
  ],
  contribution_profiles: PROFILES.map((p) => ({ ...p })),
});

describe("the joint step through the real migrator (SQLite)", () => {
  let dir: string;
  const env = { ...process.env };
  const journalPath = () => path.join(dir, FOLDER, "meta", "_journal.json");
  const open = () => new Database(process.env.SQLITE_PATH!);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-joint-"));
    fs.cpSync(path.join(REPO, FOLDER), path.join(dir, FOLDER), {
      recursive: true,
    });
    for (const data of ["tax-data", "reference-data"])
      fs.symlinkSync(path.join(REPO, data), path.join(dir, data));
    process.env.SQLITE_PATH = path.join(dir, "ledgr.db");
    process.env.LEDGR_BACKUP_DIR = path.join(dir, "backups");
    delete process.env.LEDGR_SKIP_PREMIGRATION_BACKUP;
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(REPO);
    process.env = { ...env };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function insert(db: Database.Database, tables: ReturnType<typeof fixture>) {
    for (const [table, rows] of Object.entries(tables))
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
  }

  /** An install migrated to just before the tag, holding the cases' rows;
   *  the journal is then the shipped one. */
  function installBefore(extra: Record<string, unknown>[] = []) {
    const shipped = fs.readFileSync(journalPath(), "utf8");
    const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag === CREDENTIALS_TAG);
    expect(at).toBeGreaterThan(0);
    journal.entries.splice(at);
    fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
    runSQLite();
    const db = open();
    insert(db, fixture(extra));
    db.close();
    fs.writeFileSync(journalPath(), shipped);
  }

  const personIds = () => {
    const db = open();
    const rows = db
      .prepare("SELECT person_id FROM contribution_accounts ORDER BY id")
      .all() as { person_id: number | null }[];
    db.close();
    return rows.map((r) => r.person_id);
  };

  it("clears each joint row's person as a pending migration, and a later start changes nothing", () => {
    installBefore();
    runSQLite();
    expect(personIds()).toEqual(ACCOUNT_CASES.map((c) => c.after));
    runSQLite();
    expect(personIds()).toEqual(ACCOUNT_CASES.map((c) => c.after));
  });

  it("run twice more over its own output, and with the whole registry, it writes nothing", () => {
    installBefore();
    runSQLite();
    const db = open();
    expectSqliteReplaySafe(db, [JOINT_PERSON_IDS_CONVERTER]);
    expectRegistryReplaySafe(db);
    db.close();
  });

  it("the restore step gives the rows SQLite gives", () => {
    runSQLite();
    const db = open();
    expectRestoreMatchesSqlite(db, [JOINT_PERSON_IDS_CONVERTER], fixture());
    db.close();
  });

  it("an undecidable row refuses the start, naming its id only, and nothing changes", () => {
    installBefore([{ ...UNDECIDABLE }]);
    // The tag's earlier steps would write these: they roll back with it.
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const connection = () => {
      const db = open();
      const row: unknown = db
        .prepare("SELECT config, account_mappings FROM api_connections")
        .get();
      db.close();
      return row;
    };
    const db = open();
    db.prepare(
      "INSERT INTO api_connections (id, service, config, account_mappings) VALUES (1, 'ynab', ?, ?)",
    ).run(
      JSON.stringify({ accessToken: "invented-token" }),
      JSON.stringify([
        {
          remoteAccountId: "r1",
          syncDirection: "push",
          localName: "Invented",
          localId: "performance:7",
        },
      ]),
    );
    db.close();
    const connectionBefore = connection();
    const before = personIds();
    let refusal: unknown = null;
    try {
      runSQLite();
    } catch (e) {
      refusal = e;
    }
    expect(refusal).toBeInstanceOf(MigrationRefusal);
    const message = (refusal as Error).message;
    expect(message).toContain(`rows: contribution_accounts ${UNDECIDABLE.id})`);
    expect(message).toContain("Nothing was changed.");
    expectNoCellText([message], { people: NAMES.map((name) => ({ name })) });
    expect(personIds()).toEqual(before);
    expect(connection()).toEqual(connectionBefore);
  });
});
