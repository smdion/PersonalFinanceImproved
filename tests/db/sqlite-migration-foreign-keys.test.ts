/**
 * SQLite table recreates under the real migrator: foreign keys are off for
 * the migration's transaction (a file's own PRAGMA is a no-op inside one),
 * so recreating a parent keeps its children, and a migration that breaks a
 * reference rolls back. In a squash replay a recreate runs as a unit, and
 * not at all when the table has moved past it. A reference already broken
 * before the migration is logged, not blamed on it, even in a table the
 * migration rebuilds.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { runSQLite } from "../../db-migrate";

const REPO = process.cwd();
const TAG = "0016_test_recreate_people";

describe("SQLite table recreates in the real migrator", () => {
  let dir: string;
  const env = { ...process.env };
  const folder = () => path.join(dir, "drizzle-sqlite");
  const journalPath = () => path.join(folder(), "meta", "_journal.json");
  const open = () => new Database(process.env.SQLITE_PATH!);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-sqlite-fk-"));
    fs.cpSync(path.join(REPO, "drizzle-sqlite"), folder(), { recursive: true });
    for (const data of ["tax-data", "reference-data"])
      fs.symlinkSync(path.join(REPO, data), path.join(dir, data));
    process.env.SQLITE_PATH = path.join(dir, "ledgr.db");
    process.env.LEDGR_BACKUP_DIR = path.join(dir, "backups");
    delete process.env.LEDGR_SKIP_PREMIGRATION_BACKUP;
    process.chdir(dir);
    runSQLite();
    const db = open();
    db.exec(`
      INSERT INTO people (id, name, date_of_birth) VALUES (1, 'Invented Person', '1980-01-01');
      INSERT INTO historical_salaries (person_id, year, salary) VALUES (1, 2024, '50000');
      INSERT INTO jobs (person_id, employer_name, start_date) VALUES (1, 'Invented Co', '2020-01-01');
    `);
    db.close();
  });
  afterEach(() => {
    process.chdir(REPO);
    process.env = { ...env };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Add `sql` as the next journal entry, `TAG` (its snapshot the last
   *  one's). */
  function addMigration(sql: string): string {
    fs.writeFileSync(path.join(folder(), `${TAG}.sql`), sql);
    const journal = JSON.parse(fs.readFileSync(journalPath(), "utf8")) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const last = journal.entries.at(-1)!;
    journal.entries.push({
      ...last,
      idx: last.idx + 1,
      when: last.when + 1,
      tag: TAG,
    });
    fs.writeFileSync(journalPath(), JSON.stringify(journal));
    const meta = (i: number) =>
      path.join(
        folder(),
        "meta",
        `${String(i).padStart(4, "0")}_snapshot.json`,
      );
    fs.copyFileSync(meta(last.idx), meta(last.idx + 1));
    return sql;
  }
  /** A new migration that recreates `people` the way drizzle-kit does. */
  function addRecreate(copy: string): string {
    return addMigration(
      [
        "PRAGMA foreign_keys=OFF;",
        "CREATE TABLE `__new_people` (\n\t`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`name` text NOT NULL,\n\t`date_of_birth` text NOT NULL,\n\t`is_primary_user` integer DEFAULT false NOT NULL\n);",
        copy,
        "DROP TABLE `people`;",
        "ALTER TABLE `__new_people` RENAME TO `people`;",
        "PRAGMA foreign_keys=ON;",
      ].join("--> statement-breakpoint\n"),
    );
  }
  const COPY =
    'INSERT INTO `__new_people`("id", "name", "date_of_birth", "is_primary_user") SELECT "id", "name", "date_of_birth", "is_primary_user" FROM `people`;';
  const counts = () => {
    const db = open();
    const n = (t: string) =>
      (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    const r = {
      people: n("people"),
      salaries: n("historical_salaries"),
      jobs: n("jobs"),
      recorded: n("__drizzle_migrations"),
    };
    db.close();
    return r;
  };

  it("recreating a parent table keeps its children (cascade and restrict)", () => {
    addRecreate(COPY);
    runSQLite();
    expect(counts()).toEqual({ people: 1, salaries: 1, jobs: 1, recorded: 17 });
    const db = open();
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.close();
  });

  it("a recreate that breaks a reference rolls everything back", () => {
    addRecreate(COPY.replace(" FROM `people`;", " FROM `people` WHERE 0;"));
    expect(() => runSQLite()).toThrow(/break 2 foreign key reference/);
    expect(counts()).toEqual({ people: 1, salaries: 1, jobs: 1, recorded: 16 });
  });

  it("a replayed recreate whose copy fails is skipped whole: the table stays", () => {
    addRecreate(COPY);
    runSQLite();
    // The same file now copies a column that isn't there; its recorded hash
    // no longer matches, so the next start replays the journal.
    addRecreateBroken();
    runSQLite();
    expect(counts()).toEqual({ people: 1, salaries: 1, jobs: 1, recorded: 17 });
  });
  function addRecreateBroken() {
    const file = path.join(folder(), `${TAG}.sql`);
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace('SELECT "id", "name"', 'SELECT "id", "no_such_column"'),
    );
  }

  it("a squash replay keeps what migrations after a recreate added", () => {
    // 0005 recreates retirement_settings; 0006, 0008 and 0012 add columns.
    const db = open();
    const info = db.prepare("PRAGMA table_info(retirement_settings)").all() as {
      name: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }[];
    const required = info
      .filter((c) => c.notnull && c.dflt_value == null && !c.pk)
      .map((c) => c.name)
      .filter((n) => n !== "person_id");
    const cols = ["person_id", ...required, "gap_year_stop_saving", "vpw_cap"];
    const vals = ["1", ...required.map(() => "'1'"), "1", "'0.07'"];
    db.exec(
      `INSERT INTO retirement_settings (${cols.join(", ")}) VALUES (${vals.join(", ")})`,
    );
    db.exec(
      "UPDATE __drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM __drizzle_migrations)",
    );
    db.close();
    runSQLite();
    const after = open();
    expect(
      after
        .prepare(
          "SELECT gap_year_stop_saving, vpw_cap FROM retirement_settings",
        )
        .all(),
    ).toEqual([{ gap_year_stop_saving: 1, vpw_cap: "0.07" }]);
    expect(
      (after.prepare("SELECT count(*) AS n FROM jobs").get() as { n: number })
        .n,
    ).toBe(1);
    after.close();
  });

  describe("a recreate that drops one of a child's foreign keys", () => {
    // invented_child points at people, jobs and securities; its row's
    // person_id is already dangling before the migration. The recreate drops
    // the securities key, which renumbers the others in foreign_key_check.
    const CHILD = (fks: string) =>
      `(\n\t\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t\`person_id\` integer,\n\t\`job_id\` integer,\n\t\`security_id\` integer${fks}\n)`;
    const KEPT =
      ",\n\tFOREIGN KEY (`person_id`) REFERENCES `people`(`id`),\n\tFOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`)";
    function withDanglingChild() {
      const db = open();
      db.pragma("foreign_keys = OFF");
      db.exec(
        `CREATE TABLE \`invented_child\` ${CHILD(`${KEPT},\n\tFOREIGN KEY (\`security_id\`) REFERENCES \`securities\`(\`id\`)`)};`,
      );
      db.exec(
        "INSERT INTO invented_child (id, person_id, job_id) VALUES (1, 99, (SELECT id FROM jobs))",
      );
      expect(db.pragma("foreign_key_check")).toEqual([
        { table: "invented_child", rowid: 1, parent: "people", fkid: 2 },
      ]);
      db.close();
    }
    const recreate = (extra = "") =>
      addMigration(
        [
          "PRAGMA foreign_keys=OFF;",
          `CREATE TABLE \`__new_invented_child\` ${CHILD(KEPT)};`,
          'INSERT INTO `__new_invented_child`("id", "person_id", "job_id", "security_id") SELECT "id", "person_id", "job_id", "security_id" FROM `invented_child`;',
          "DROP TABLE `invented_child`;",
          "ALTER TABLE `__new_invented_child` RENAME TO `invented_child`;",
          ...(extra ? [extra] : []),
          "PRAGMA foreign_keys=ON;",
        ].join("--> statement-breakpoint\n"),
      );
    const events = (run: () => void) => {
      const spy = vi.spyOn(console, "log");
      try {
        run();
        return spy.mock.calls.map((c) => JSON.parse(String(c[0])).event);
      } finally {
        spy.mockRestore();
      }
    };

    it("a reference already broken on a kept key is logged, not blamed on the migration", () => {
      withDanglingChild();
      recreate();
      const logged = events(() => runSQLite());
      expect(logged).toContain("sqlite_foreign_keys_already_broken");
      expect(counts().recorded).toBe(17);
      const db = open();
      expect(db.pragma("foreign_key_check")).toEqual([
        { table: "invented_child", rowid: 1, parent: "people", fkid: 1 },
      ]);
      expect(
        db.prepare("SELECT id, person_id FROM invented_child").all(),
      ).toEqual([{ id: 1, person_id: 99 }]);
      db.close();
    });

    it("a reference the migration breaks on the same row is still refused", () => {
      withDanglingChild();
      recreate("DELETE FROM `jobs`;");
      expect(() => runSQLite()).toThrow(
        /break 1 foreign key reference.*invented_child row 1 → jobs/,
      );
      expect(counts()).toEqual({
        people: 1,
        salaries: 1,
        jobs: 1,
        recorded: 16,
      });
    });
  });

  it("a break the migration makes on a second key to the same parent is refused", () => {
    // invented_loan has two keys to invented_goal; from_goal_id already
    // dangles, and the migration breaks to_goal_id on the same row.
    const db = open();
    db.pragma("foreign_keys = OFF");
    db.exec(`
      CREATE TABLE invented_goal (id integer PRIMARY KEY);
      CREATE TABLE invented_loan (
        id integer PRIMARY KEY,
        from_goal_id integer REFERENCES invented_goal(id),
        to_goal_id integer REFERENCES invented_goal(id)
      );
      INSERT INTO invented_goal (id) VALUES (1);
      INSERT INTO invented_loan (id, from_goal_id, to_goal_id) VALUES (1, 99, 1);
    `);
    db.close();
    addMigration("DELETE FROM `invented_goal`;");
    expect(() => runSQLite()).toThrow(
      /break 1 foreign key reference.*invented_loan row 1 → invented_goal/,
    );
    expect(counts().recorded).toBe(16);
  });

  describe("a squash replay of 0015 on a 0014-shaped database", () => {
    /** The database at 0014 (0015 not applied), then a replay of the whole
     *  journal (a recorded hash that no longer matches). */
    function replayFrom0014(extra?: (db: Database.Database) => void) {
      for (const ext of ["", "-wal", "-shm"])
        fs.rmSync(`${process.env.SQLITE_PATH!}${ext}`, { force: true });
      const shipped = fs.readFileSync(journalPath(), "utf8");
      const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
      journal.entries = journal.entries.filter(
        (e) => e.tag !== "0015_v0102_dead_data",
      );
      fs.writeFileSync(journalPath(), JSON.stringify(journal));
      runSQLite();
      fs.writeFileSync(journalPath(), shipped);
      const db = open();
      db.exec(`
        INSERT INTO simplefin_accounts (id, external_account_id, org_name, account_name, last_balance)
          VALUES (3, 'ACT-INVENTED', 'Invented Brokerage', 'Invented IRA', '1000');
        INSERT INTO securities (id, name, kind) VALUES (7, 'Invented Fund', 'fund');
        INSERT INTO holding_observations (id, simplefin_account_id, security_id, as_of, shares, source)
          VALUES (1, 3, 7, '2026-10-30', '1', 'simplefin');
        UPDATE __drizzle_migrations SET hash = 'not-a-hash' WHERE id = 1;
      `);
      extra?.(db);
      db.close();
    }
    const holdings = () => {
      const db = open();
      const info = db
        .prepare("PRAGMA table_info(holding_observations)")
        .all() as { name: string; notnull: number }[];
      const rows = db.prepare("SELECT id FROM holding_observations").all();
      db.close();
      return { info, rows };
    };

    /** The events the migrator logged while `run` ran. */
    function events(run: () => void): string[] {
      const spy = vi.spyOn(console, "log");
      try {
        run();
        return spy.mock.calls.map((c) => JSON.parse(String(c[0])).event);
      } finally {
        spy.mockRestore();
      }
    }

    it("runs 0015's recreate: the dropped column goes, the link is NOT NULL", () => {
      replayFrom0014();
      const logged = events(() => runSQLite());
      expect(logged).toContain("sqlite_squash_upgrade_start");
      const { info, rows } = holdings();
      expect(info.map((c) => c.name)).not.toContain("performance_account_id");
      expect(info.find((c) => c.name === "simplefin_account_id")?.notnull).toBe(
        1,
      );
      expect(rows).toEqual([{ id: 1 }]);
    });

    it("a row the recreate can't copy stops the replay with nothing changed", () => {
      replayFrom0014((db) =>
        db.exec(`
          INSERT INTO performance_accounts (id, institution, account_type, account_label, parent_category, ownership_type)
            VALUES (5, 'Invented Bank', 'brokerage', 'Invented', 'Portfolio', 'individual');
          INSERT INTO holding_observations (id, performance_account_id, security_id, as_of, shares, source)
            VALUES (2, 5, 7, '2026-10-30', '1', 'manual');
        `),
      );
      const spy = vi.spyOn(console, "log");
      expect(() => runSQLite()).toThrow(/NOT NULL constraint failed/);
      expect(
        spy.mock.calls.map((c) => JSON.parse(String(c[0])).event),
      ).toContain("sqlite_squash_upgrade_start");
      spy.mockRestore();
      const { info, rows } = holdings();
      expect(info.map((c) => c.name)).toContain("performance_account_id");
      expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });
});
